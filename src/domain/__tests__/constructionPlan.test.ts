import { describe, expect, it } from 'vitest'
import {
  civCapPerProject,
  infraSpeedFactor,
  isPowered,
  scheduleConstruction,
} from '../plan/constructionPlan'
import {
  DEFAULT_DEFINES,
  type ConstructionEnvironment,
  type ConstructionFactors,
  type ConstructionItem,
  type ProductionData,
  type StateData,
} from '../production'

const begin = new Date(Date.UTC(1936, 0, 1))
const day = (n: number) => new Date(begin.getTime() + n * 86_400_000)

const stateOf = (
  id: number,
  buildings: Record<string, number>,
  extra: Partial<StateData> = {},
) => ({
  id,
  name: `State ${id}`,
  category: 'city',
  buildings,
  resources: {},
  manpower: 0,
  ...extra,
})

const building = (id: string, extra = {}) => ({
  id,
  name: id,
  cost: 1000,
  stateMax: 20,
  sharesSlots: true,
  infraEffect: false,
  ...extra,
})

/** One big state with 20 civilian factories; 1000 points a level keeps the numbers small. */
const production = (extra: Partial<ProductionData> = {}): ProductionData => ({
  states: [stateOf(1, { industrial_complex: 20 })],
  categorySlots: { city: 40, tiny: 2 },
  sharedSlotBuildings: ['industrial_complex', 'arms_factory'],
  buildings: [
    building('industrial_complex'),
    building('arms_factory'),
    building('infrastructure', { cost: 600, stateMax: 5, sharesSlots: false, infraEffect: false }),
    building('air_base', { sharesSlots: false, infraEffect: true }),
  ],
  defines: { ...DEFAULT_DEFINES, minConsumerFactories: 0, minConsumerPercent: 0 },
  ...extra,
})

const factors = (extra: Partial<ConstructionFactors> = {}): ConstructionFactors => ({
  date: begin,
  buildingsSpeed: 0,
  buildingSpeed: {},
  poweredSpeed: 0,
  slotFactor: 0,
  consumerExpected: 0,
  consumerFactor: 0,
  stability: 0.5,
  energyGain: 0,
  energyConsumption: 0,
  ...extra,
})

const env = (extra: Partial<ConstructionEnvironment> = {}): ConstructionEnvironment => ({
  factors: [factors()],
  events: [],
  focusBuilds: [],
  ...extra,
})

const run = (queue: ConstructionItem[], prod = production(), environment = env(), years = 5) =>
  scheduleConstruction(queue, prod, environment, {
    startDate: begin,
    until: day(365 * years),
  })

const item = (building: string, levels = 1, state = 1): ConstructionItem => ({
  building,
  state,
  levels,
})

describe('scheduleConstruction', () => {
  it('gives a project at most the civs of the cap, at the powered speed', () => {
    const { items } = run([item('arms_factory')])
    // 20 spare civs, capped at 15, 5 points each: 75 a day, 1000 points -> 14 days.
    expect(civCapPerProject(DEFAULT_DEFINES)).toBe(15)
    expect(items[0].levels).toHaveLength(1)
    expect(items[0].levels[0]).toMatchObject({ civs: 15, days: 14 })
    expect(items[0].levels[0].start).toEqual(begin)
    expect(items[0].levels[0].end).toEqual(day(14))
  })

  it('shares the spare civs in queue order', () => {
    const { items } = run([item('arms_factory'), item('arms_factory')])
    // The first takes 15, the second the other 5 (25 a day for 14 days = 350), then 15 once the
    // first is done: 650 more at 75 a day is 9 days.
    expect(items[0].levels[0].days).toBe(14)
    expect(items[1].levels[0].days).toBe(23)
  })

  it('lets a finished civilian factory join and raises the consumer goods', () => {
    const prod = production({ states: [stateOf(1, { industrial_complex: 10 })] })
    const levels = (expected: number) =>
      run(
        [item('industrial_complex', 2)],
        prod,
        env({ factors: [factors({ consumerExpected: expected })] }),
      ).items[0].levels
    // 10 civs, none on consumer goods: 50 a day -> 20 days, then 11 civs: 55 a day -> 19 days.
    expect(levels(0).map((l) => l.days)).toEqual([20, 19])
    // 35%, rounded down: 3 goods of 10 civs, 7 spare -> 35 a day -> 29 days; then 3 of 11
    // (3.85), 8 spare -> 25 days.
    expect(levels(0.35).map((l) => l.days)).toEqual([29, 25])
    // 50%: 5 of 10 and 5 of 11 (5.5): 5 spare -> 40 days, then 6 spare -> 34 days.
    expect(levels(0.5).map((l) => l.days)).toEqual([40, 34])
  })

  it('waits for a free slot without holding up the items behind it', () => {
    const prod = production({
      states: [
        stateOf(1, { industrial_complex: 20 }),
        stateOf(2, { arms_factory: 2 }, { category: 'tiny' }),
      ],
    })
    const { items } = run([item('arms_factory', 1, 2), item('arms_factory', 1, 1)], prod)
    expect(items[0].levels).toEqual([])
    expect(items[0].issues).toEqual(['no-slots'])
    expect(items[1].levels).toHaveLength(1)
  })

  it('starts the level once slots appear, and counts a level in progress as using one', () => {
    const prod = production({
      states: [
        stateOf(1, { industrial_complex: 20 }),
        stateOf(2, { arms_factory: 2 }, { category: 'tiny' }),
      ],
    })
    const slotEvent = { date: day(10), state: 2, built: {}, slots: 1, resources: {} }
    const { items } = run(
      [item('arms_factory', 1, 2), item('arms_factory', 1, 2)],
      prod,
      env({ events: [slotEvent] }),
    )
    // One free slot from day 10: the first level takes it, the second waits for good.
    expect(items[0].levels[0].start).toEqual(day(10))
    expect(items[0].issues).toEqual([])
    expect(items[1].levels).toEqual([])
    expect(items[1].issues).toEqual(['no-slots'])
  })

  it('does not build past the most levels a state holds', () => {
    const prod = production({ states: [stateOf(1, { industrial_complex: 20, infrastructure: 4 })] })
    const { items } = run([item('infrastructure', 2)], prod)
    expect(items[0].levels).toHaveLength(1)
    expect(items[0].issues).toEqual(['state-max'])
  })

  it('builds faster in a state with better infrastructure', () => {
    const prod = production({
      states: [stateOf(1, { industrial_complex: 20 }), stateOf(2, { infrastructure: 5 })],
    })
    const days = (state: number) => run([item('air_base', 1, state)], prod).items[0].levels[0].days
    // 75 a day -> 14 days; with the bonus at level 5 (x2) 150 a day -> 7 days.
    expect(days(1)).toBe(14)
    expect(days(2)).toBe(7)
    expect(infraSpeedFactor(0, DEFAULT_DEFINES)).toBe(1)
    expect(infraSpeedFactor(5, DEFAULT_DEFINES)).toBe(2)
    expect(infraSpeedFactor(9, DEFAULT_DEFINES)).toBe(2)
  })

  it('goes slower when the country has too little energy', () => {
    const days = (energyGain: number) =>
      run([item('arms_factory')], production(), env({ factors: [factors({ energyGain })] }))
        .items[0].levels[0].days
    expect(days(0)).toBe(14)
    // No energy at all: 4 points a civ, 60 a day -> 17 days.
    expect(days(-1)).toBe(17)
  })

  it('changes speed when the modifiers change', () => {
    const { items } = run(
      [item('arms_factory')],
      production(),
      env({
        factors: [
          factors({ buildingSpeed: { arms_factory: -0.3 } }),
          factors({ date: day(7), buildingsSpeed: 0.5 }),
        ],
      }),
    )
    // 7 days at 15 x 5 x 0.7 = 52.5 -> 367.5, then 15 x 5 x 1.5 = 112.5 a day: 632.5 -> 6 days.
    expect(items[0].levels[0].days).toBe(13)
  })

  it('lets the builds of focuses join the end of the queue on their date', () => {
    const { items } = run(
      [item('arms_factory')],
      production(),
      env({
        focusBuilds: [
          { date: day(5), focusName: 'Industry', guessed: true, item: item('arms_factory') },
        ],
      }),
    )
    expect(items.map((i) => i.source)).toEqual(['queue', 'focus'])
    expect(items[1]).toMatchObject({ focusName: 'Industry', guessed: true, joined: day(5) })
    // It starts the day it joins, on the 5 civs the first project leaves over.
    expect(items[1].levels[0].start).toEqual(day(5))
    expect(items[0].levels[0].days).toBe(14)
  })

  it('lists every level finished, with the date it counts from', () => {
    const result = run([item('arms_factory', 2)])
    expect(result.built.map((b) => [b.building, b.state])).toEqual([
      ['arms_factory', 1],
      ['arms_factory', 1],
    ])
    expect(result.built[0].date).toEqual(day(14))
    expect(result.finish).toEqual(result.built[1].date)
  })

  it('flags items that name something unknown', () => {
    const { items } = run([item('nope'), item('arms_factory', 1, 99)])
    expect(items.map((i) => i.issues)).toEqual([['unknown-building'], ['unknown-state']])
  })
})

describe('isPowered', () => {
  it('compares the energy made with the energy used', () => {
    const none = { energyGain: 0, energyConsumption: 0 }
    const fine = isPowered(10, 5, { ...none, energyConsumption: -0.3 }, DEFAULT_DEFINES)
    // 10 + 5 coal x 9 = 55 made; 10 factories x 0.25 x (1 + 0.0225 x 10) x 0.7 used.
    expect(fine.produced).toBe(55)
    expect(fine.used).toBeCloseTo(10 * 0.25 * 1.225 * 0.7)
    expect(fine.powered).toBe(true)
    expect(isPowered(100, 0, none, DEFAULT_DEFINES).powered).toBe(false)
  })

  it('caps the energy a factory needs', () => {
    expect(
      isPowered(10000, 1000, { energyGain: 0, energyConsumption: 0 }, DEFAULT_DEFINES).used,
    ).toBe(66000)
  })
})
