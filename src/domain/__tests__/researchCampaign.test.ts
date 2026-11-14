import { describe, expect, it } from 'vitest'
import { addDays } from '../calendar'
import type { EffectLine, Focus } from '../focus'
import { countryStateAt } from '../campaign/countryState'
import { planResearch, researchStatusAt, techModifierTotals } from '../campaign/research'
import { schedulePlan } from '../plan/focusPlan'
import type { ResearchData, ResearchItem, Technology } from '../research'

const begin = new Date(Date.UTC(1936, 0, 1))
const day = (n: number) => addDays(begin, n)

const focus = (id: string, effects: EffectLine[]): Focus => ({
  id,
  name: id.toUpperCase(),
  days: 70,
  prerequisites: [],
  mutuallyExclusive: [],
  x: 0,
  y: 0,
  effects,
})

const number = (key: string) => ({ key, kind: 'number' as const })
const slot = (n: string): EffectLine => ({
  depth: 0,
  key: 'add_research_slot',
  value: n,
  isModifier: true,
  stat: number('add_research_slot'),
})
const speedIdea = (id: string, value: string, extra: Partial<EffectLine> = {}): EffectLine[] => [
  { depth: 0, key: 'add_timed_idea', value: id, valueName: id, ...extra },
  {
    depth: 1,
    key: 'research_speed_factor',
    value,
    isModifier: true,
    stat: number('research_speed_factor'),
  },
]
const unlock = (...targets: string[]): EffectLine => ({
  depth: 0,
  key: 'set_technology',
  research: { kind: 'unlock', targets },
})
const techBonus = (
  category: string,
  extra: Partial<NonNullable<EffectLine['research']>> = {},
): EffectLine => ({
  depth: 0,
  key: 'add_tech_bonus',
  research: {
    kind: 'tech_bonus',
    bonus: 1,
    uses: 1,
    targets: [category],
    targetKinds: ['category'],
    ...extra,
  },
})

const deeper = (line: EffectLine): EffectLine => ({ ...line, depth: line.depth + 1 })
/** `if has_tech air1 { <then> } else { <otherwise> }`. */
const ifHasAir1 = (then: EffectLine, otherwise: EffectLine): EffectLine[] => [
  { depth: 0, key: 'if', condition: 'has tech', check: { type: 'tech', id: 'air1' } },
  deeper(then),
  { depth: 0, key: 'else' },
  deeper(otherwise),
]

const start: EffectLine[] = [slot('3'), unlock('s1', 's2')]

const focusSchedule = (focuses: Focus[]) =>
  schedulePlan(
    focuses.map((f) => f.id),
    Object.fromEntries(focuses.map((f) => [f.id, f])),
    { startDate: begin, speedBonus: 0 },
  )

describe('the research environment of a country state', () => {
  const focuses = [
    focus('a', [
      slot('1'),
      ...speedIdea('quick', '0.1', { days: 100 }),
      techBonus('cat', { ahead: 2, uses: 2 }),
    ]),
    focus('b', [unlock('granted'), techBonus('other')]),
  ]
  const s = countryStateAt(focusSchedule(focuses), day(140), {
    tag: 'ROM',
    start,
    startDate: begin,
  })

  it('records the start techs and the slots with the dates they changed on', () => {
    expect(s.research.startTechs).toEqual(['s1', 's2'])
    expect(s.research.slots).toEqual([
      { date: begin, total: 3 },
      { date: day(70), total: 4 },
    ])
  })

  it('records the research speed, and when a timed idea runs out', () => {
    expect(s.research.speed).toEqual([
      { date: begin, factor: 0 },
      { date: day(70), factor: 0.1 },
      { date: day(140), factor: 0.1 },
      { date: day(170), factor: 0 },
    ])
  })

  it('records the techs a focus hands out, with its date', () => {
    expect(s.research.grants).toEqual([{ date: day(140), techIds: ['granted'] }])
  })

  it('numbers the bonuses of each focus and keeps what they say', () => {
    expect(s.research.bonuses).toMatchObject([
      {
        ref: { focusId: 'a', index: 0 },
        date: day(70),
        name: 'A',
        bonus: 1,
        uses: 2,
        ahead: 2,
        targets: ['cat'],
        targetKinds: ['category'],
      },
      { ref: { focusId: 'b', index: 0 }, date: day(140), uses: 1, ahead: 0 },
    ])
  })

  it('only covers the focuses done by the date', () => {
    const early = countryStateAt(focusSchedule(focuses), day(80), { start, startDate: begin })
    expect(early.research.bonuses).toHaveLength(1)
    expect(early.research.grants).toEqual([])
  })
})

describe('has_tech conditions', () => {
  const hasTechBranch = ifHasAir1(slot('1'), techBonus('light_fighter'))
  const focuses = [focus('a', hasTechBranch)]
  const after = day(70)

  it('stay conditional without an answer', () => {
    const s = countryStateAt(focusSchedule(focuses), after, { start, startDate: begin })
    expect(s.conditional.map((c) => c.lines[0].key)).toEqual(['if', 'else'])
    expect(s.research.bonuses).toEqual([])
  })

  it('are settled by hasTech: the branch that applies counts', () => {
    const no = countryStateAt(focusSchedule(focuses), after, {
      start,
      startDate: begin,
      hasTech: () => false,
    })
    expect(no.research.bonuses).toHaveLength(1)
    expect(no.conditional).toEqual([])
    const yes = countryStateAt(focusSchedule(focuses), after, {
      start,
      startDate: begin,
      hasTech: () => true,
    })
    expect(yes.research.bonuses).toEqual([])
    expect(yes.research.slots.at(-1)?.total).toBe(4)
  })

  it('ask about the date the focus completes', () => {
    const dates: Date[] = []
    countryStateAt(focusSchedule(focuses), after, {
      start,
      startDate: begin,
      hasTech: (_id, date) => (dates.push(date), undefined),
    })
    expect(dates).toEqual([day(70)])
  })
})

const tech = (id: string, extra: Partial<Technology> = {}): Technology => ({
  id,
  name: id,
  cost: 1,
  startYear: 1936,
  folders: [{ id: 'f', x: 0, y: 0 }],
  categories: [],
  prerequisites: [],
  exclusiveWith: [],
  researchable: true,
  modifiers: [],
  ...extra,
})
const data: ResearchData = {
  techs: [tech('air1', { categories: ['light_fighter'] }), tech('s1'), tech('s2'), tech('other')],
  folders: [{ id: 'f', name: 'F' }],
  defines: { baseCost: 110, aheadPenalty: 2, minSpeed: 0.1 },
}

describe('planResearch', () => {
  const focuses = [focus('a', ifHasAir1(slot('1'), techBonus('light_fighter', { bonus: 1 })))]
  const plan = (queue: ResearchItem[], until = day(3000)) =>
    planResearch({
      focusSchedule: focusSchedule(focuses),
      options: { start, startDate: begin },
      queue,
      data,
      startDate: begin,
      until,
    })

  it('gives the bonus only when the tech was not researched before the focus completes', () => {
    // air1 takes 110 days on a slot, so it is not done when the focus completes on day 70...
    const slow = plan([{ techId: 'air1' }])
    expect(slow.schedule.items[0].end).toEqual(day(110))
    expect(slow.environment.bonuses).toHaveLength(1)
    expect(slow.hasTech?.('air1', day(70))).toBe(false)
    expect(slow.hasTech?.('air1', day(110))).toBe(true)
    expect(slow.hasTech?.('unknown', day(110))).toBeUndefined()
  })

  it('lets the focus see a tech that is already researched', () => {
    const quick = planResearch({
      focusSchedule: focusSchedule(focuses.map((f) => ({ ...f, days: 200 }))),
      options: { start, startDate: begin },
      queue: [{ techId: 'air1' }],
      data,
      startDate: begin,
      until: day(3000),
    })
    // The focus completes on day 200, after air1 (day 110): the other branch, a slot, applies.
    expect(quick.environment.bonuses).toEqual([])
    expect(quick.environment.slots.at(-1)?.total).toBe(4)
  })

  it('uses a bonus the focus gave on a tech in the queue', () => {
    const planned = plan([
      { techId: 'other' },
      { techId: 'air1', bonus: { focusId: 'a', index: 0 } },
    ])
    // `other` takes slot 0 and air1 slot 1 from day 0, before the focus gives the bonus.
    expect(planned.schedule.items[1].issues).toEqual([{ kind: 'bonus-unavailable' }])
  })

  it('answers nothing without tech data', () => {
    const planned = planResearch({
      focusSchedule: focusSchedule(focuses),
      options: { start, startDate: begin },
      queue: [{ techId: 'air1' }],
      startDate: begin,
      until: day(100),
    })
    expect(planned.hasTech).toBeUndefined()
    expect(planned.schedule.items).toEqual([])
  })
})

describe('researchStatusAt', () => {
  const focuses = [focus('a', [slot('1'), techBonus('light_fighter', { uses: 2 })])]
  const planned = planResearch({
    focusSchedule: focusSchedule(focuses),
    options: { start, startDate: begin },
    queue: [{ techId: 'air1' }, { techId: 'other' }],
    data,
    startDate: begin,
    until: day(3000),
  })

  it('counts the slots, finished and running techs and the bonuses not spent', () => {
    const status = researchStatusAt(planned.schedule, planned.environment, day(100))
    expect(status.slots).toBe(4)
    expect(status.finished).toEqual([])
    expect(status.inProgress.map((i) => i.techId)).toEqual(['air1', 'other'])
    expect(status.unusedBonuses.map((b) => b.left)).toEqual([2])
    const later = researchStatusAt(planned.schedule, planned.environment, day(200))
    expect(later.finished.map((i) => i.techId)).toEqual(['air1', 'other'])
    expect(later.inProgress).toEqual([])
  })

  it('does not count what a bonus was spent on', () => {
    const used = planResearch({
      focusSchedule: focusSchedule(
        [focus('a', [techBonus('light_fighter', { uses: 1 })])].map((f) => ({ ...f, days: 1 })),
      ),
      options: { start, startDate: begin },
      queue: [{ techId: 'other' }, { techId: 'air1', bonus: { focusId: 'a', index: 0 } }],
      data,
      startDate: begin,
      until: day(3000),
    })
    expect(used.schedule.items[1].bonusUsed).toBeUndefined()
    expect(researchStatusAt(used.schedule, used.environment, day(200)).unusedBonuses).toHaveLength(
      1,
    )
  })
})

describe('techModifierTotals', () => {
  const stat = (key: string, label: string) => ({ key, label, kind: 'percent' as const })
  const modifier = (key: string, value: string, label: string): EffectLine => ({
    depth: 0,
    key,
    value,
    isModifier: true,
    stat: stat(key, label),
  })
  const tech = (id: string, modifiers: EffectLine[]): Technology => ({
    id,
    name: id,
    cost: 1,
    startYear: 1936,
    folders: [],
    categories: [],
    prerequisites: [],
    exclusiveWith: [],
    researchable: true,
    modifiers,
  })
  const techs = [
    tech('a', [modifier('industry', '0.1', 'Industry'), modifier('speed', '0.05', 'Speed')]),
    tech('b', [modifier('industry', '0.1', 'Industry')]),
    tech('c', [modifier('industry', '0.2', 'Industry')]),
    tech('d', []),
  ]

  it('sums the stats of the techs the country has, per stat', () => {
    const totals = techModifierTotals(techs, new Set(['a', 'b', 'd']))
    expect(totals.map((t) => [t.key, t.total])).toEqual([
      ['industry', 0.2],
      ['speed', 0.05],
    ])
  })

  it('leaves out techs the country does not have, and stats that cancel out', () => {
    expect(techModifierTotals(techs, new Set())).toEqual([])
    const cancelling = [
      tech('x', [modifier('k', '0.1', 'K')]),
      tech('y', [modifier('k', '-0.1', 'K')]),
    ]
    expect(techModifierTotals(cancelling, new Set(['x', 'y']))).toEqual([])
  })

  it('sorts by the stats` names', () => {
    const totals = techModifierTotals(techs, new Set(['a']))
    expect(totals.map((t) => t.stat.label)).toEqual(['Industry', 'Speed'])
  })
})
