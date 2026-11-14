import { describe, expect, it } from 'vitest'
import { addDays } from '../calendar'
import { constructionFactors, planConstruction } from '../campaign/construction'
import { industryAt } from '../campaign/industry'
import type { ActiveIdea, ConstructionBatch, CountryState } from '../campaign/types'
import type { EffectLine } from '../focus'
import { DEFAULT_DEFINES, type ProductionData } from '../production'
import type { ResearchSchedule, ScheduledResearch, Technology } from '../research'

const begin = new Date(Date.UTC(1936, 0, 1))
const day = (n: number) => addDays(begin, n)

const line = (key: string, value: number): EffectLine =>
  ({
    depth: 0,
    key,
    value: String(value),
    isModifier: true,
    stat: { key, kind: 'number' },
  }) as EffectLine

const idea = (id: string, modifiers: EffectLine[]): ActiveIdea => ({
  id,
  name: id,
  focusId: 'f',
  focusName: 'F',
  since: begin,
  modifiers,
})

const tech = (id: string, modifiers: EffectLine[]): Technology =>
  ({ id, name: id, modifiers }) as unknown as Technology

const researchDone = (when: Record<string, Date>): ResearchSchedule => ({
  items: Object.entries(when).map(
    ([techId, end], index) => ({ index, techId, slot: 0, end }) as unknown as ScheduledResearch,
  ),
  unscheduled: [],
  researchedBy: (date) =>
    new Set(
      Object.entries(when)
        .filter(([, end]) => end <= date)
        .map(([id]) => id),
    ),
})

const production: ProductionData = {
  states: [
    {
      id: 1,
      name: 'A',
      category: 'city',
      buildings: { industrial_complex: 10 },
      resources: { coal: 5 },
      manpower: 0,
    },
  ],
  categorySlots: { city: 40 },
  sharedSlotBuildings: ['industrial_complex', 'arms_factory'],
  buildings: [
    {
      id: 'industrial_complex',
      name: 'Civilian factory',
      cost: 1000,
      stateMax: 20,
      sharesSlots: true,
      infraEffect: false,
    },
    {
      id: 'arms_factory',
      name: 'Military factory',
      cost: 1000,
      stateMax: 20,
      sharesSlots: true,
      infraEffect: false,
    },
  ],
  defines: { ...DEFAULT_DEFINES, minConsumerFactories: 0, minConsumerPercent: 0 },
}

const bld = (type: string, level: number, instant: boolean) => ({
  type,
  name: type,
  level,
  instant,
})

const batch = (date: Date, extra: Partial<ConstructionBatch>): ConstructionBatch => ({
  focusId: 'f',
  focusName: 'Industry',
  date,
  random: false,
  buildings: [],
  slots: 0,
  resources: [],
  ...extra,
})

const finalState = (
  snapshots: CountryState['snapshots'],
  construction: ConstructionBatch[],
  date = day(100),
): CountryState =>
  ({
    date,
    modifierTotals: [],
    statChanges: [],
    popularity: [],
    buildings: [],
    buildingSlots: 0,
    construction,
    snapshots,
  }) as unknown as CountryState

describe('constructionFactors', () => {
  it('follows the ideas, their expiry and the technologies researched', () => {
    const timed = {
      ...idea('rush', [line('production_speed_buildings_factor', 0.2)]),
      until: day(40),
    }
    const snapshots = [
      { date: begin, ideas: [timed], traits: [], stabilityBase: 0.6, rulingPopularity: 0.6 },
      {
        date: day(20),
        ideas: [timed, idea('slots', [line('global_building_slots_factor', 0.1)])],
        traits: [],
        stabilityBase: 0.6,
        rulingPopularity: 0.6,
      },
    ]
    const techs = [
      tech('gears', [
        line('production_speed_buildings_factor', 0.1),
        line('production_speed_arms_factory_factor', 0.05),
      ]),
    ]
    const result = constructionFactors(
      { snapshots },
      researchDone({ gears: day(30) }),
      techs,
      begin,
      [day(30)],
      DEFAULT_DEFINES,
    )
    expect(result.map((f) => f.date)).toEqual([begin, day(20), day(30), day(40)])
    expect(result.map((f) => f.buildingsSpeed)).toEqual([0.2, 0.2, 0.2 + 0.1, 0.1])
    expect(result.map((f) => f.slotFactor)).toEqual([0, 0.1, 0.1, 0.1])
    expect(result[2].buildingSpeed).toEqual({ arms_factory: 0.05 })
    // 60% stability plus 15% of the ruling party's 60%: 69%.
    expect(result[0].stability).toBeCloseTo(0.69)
  })
})

describe('planConstruction', () => {
  const batches = [
    batch(begin, { state: 1, buildings: [bld('industrial_complex', 5, true)] }),
    batch(day(10), { state: 1, buildings: [bld('arms_factory', 1, false)] }),
  ]
  const planned = (queue = [{ building: 'arms_factory', state: 1, levels: 1 }]) =>
    planConstruction({
      production,
      finalState: finalState(
        [{ date: begin, ideas: [], traits: [], stabilityBase: 0, rulingPopularity: 0 }],
        batches,
      ),
      research: researchDone({}),
      techs: [],
      queue,
      startDate: begin,
      until: day(2000),
    })

  it('turns the plan into instant builds and the builds focuses queue', () => {
    const { environment } = planned()
    expect(environment.events.map((e) => [e.state, e.built])).toEqual([
      [1, { industrial_complex: 5 }],
      [1, {}],
    ])
    expect(environment.focusBuilds).toMatchObject([
      {
        date: day(10),
        focusName: 'Industry',
        item: { building: 'arms_factory', state: 1, levels: 1 },
      },
    ])
  })

  it('schedules the queue ahead of the builds of focuses, with the instant factories counted', () => {
    const { schedule } = planned()
    expect(schedule.items.map((i) => i.source)).toEqual(['queue', 'focus'])
    // 15 civs now (the 5 instant ones joined), spare 15, capped at 15: 75 a day -> 14 days.
    expect(schedule.items[0].levels[0].days).toBe(14)
    // The focus build starts on day 10 with no civs left: it waits for the first to finish.
    expect(schedule.items[1].levels[0].start).toEqual(day(14))
  })

  it('shows the finished levels in the industry of a later date', () => {
    const { schedule } = planned()
    const at = (date: Date) =>
      industryAt(
        production,
        { ...finalState([], [batches[0]], date), buildings: [], construction: [batches[0]] },
        [],
        schedule.built,
      )
    const before = at(day(13))
    const after = at(day(60))
    const count = (industry: ReturnType<typeof at>, type: string) =>
      industry.factories.find((f) => f.type === type)?.count
    expect(count(before, 'arms_factory')).toBe(0)
    expect(count(after, 'arms_factory')).toBe(2)
    expect(after.states[0].used).toBe(before.states[0].used + 2)
    expect(after.states[0].mil).toBe(2)
  })
})
