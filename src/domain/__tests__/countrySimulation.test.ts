import { describe, expect, it } from 'vitest'
import { addDays } from '../calendar'
import type { BalanceOfPower } from '../balanceOfPower'
import type { EffectLine, Focus } from '../focus'
import { accrueDrift } from '../campaign/drift'
import { applyReward } from '../campaign/applyReward'
import { newWorking } from '../campaign/working'
import type { Step } from '../campaign/applyReward'
import { changesWithoutEvents } from '../campaign/conditions'
import { countryStateAt, simulateCountry } from '../campaign/countryState'
import type { CountryStateOptions } from '../campaign/types'
import { schedulePlan } from '../plan/focusPlan'

const start = new Date(Date.UTC(1936, 0, 1))
const day = (n: number) => addDays(start, n)
const stat = (key: string) => ({ key, kind: 'percent' as const })
const modifier = (depth: number, key: string, value: string): EffectLine => ({
  depth,
  key,
  value,
  isModifier: true,
  stat: stat(key),
})
const pop = (subject: string, value: string): EffectLine => ({
  depth: 0,
  key: 'add_popularity',
  value,
  subject,
  subjectName: subject,
  stat: stat('add_popularity'),
})
const focus = (id: string, days: number, effects: EffectLine[]): Focus => ({
  id,
  name: id,
  days,
  prerequisites: [],
  mutuallyExclusive: [],
  x: 0,
  y: 0,
  effects,
})

const range = (id: string, min: number, max: number, mods: [string, string][]) => ({
  id,
  name: id,
  min,
  max,
  modifiers: mods.map(([key, value]) => modifier(0, key, value)),
})
/** The balance starts in `low` and drifts into `very-low`, whose modifiers carry a party drift. */
const bop: BalanceOfPower = {
  id: 'B',
  name: 'Trust',
  initial: 0,
  weekly: [
    {
      leader: 'FIN_a',
      modifier: 'bad',
      weekly: -0.01,
      when: { type: 'popularity', ideology: 'democratic', op: '>', than: 0.09 },
    },
  ],
  ranges: [
    range('mid', -0.1, 0.1, []),
    range('low', -0.6, -0.1, [['stability_factor', '-0.05']]),
    range('very-low', -1, -0.6, [['neutrality_drift', '0.3']]),
  ],
}

const startLines: EffectLine[] = [
  { depth: 0, key: 'set_power_balance' },
  { depth: 1, key: 'id', value: 'B' },
  { depth: 1, key: 'set_value', value: '-0.45' },
  pop('democratic', '0.5'),
  pop('fascism', '0.2'),
  pop('communism', '0.2'),
  pop('neutrality', '0.1'),
  { depth: 0, key: 'set_politics', value: 'democratic' },
  { depth: 0, key: 'promote_character', value: 'FIN_a' },
]

const focuses = [
  focus('a', 30, [
    { depth: 0, key: 'add_timed_idea', value: 'rally', valueName: 'Rally', days: 90 },
    modifier(1, 'fascism_drift', '0.1'),
    modifier(0, 'add_stability', '0.05'),
  ]),
  focus('b', 50, [
    { depth: 0, key: 'add_ideas', value: 'demagogue', valueName: 'Demagogue' },
    modifier(1, 'communism_drift', '0.1'),
    pop('communism', '0.03'),
  ]),
  focus('c', 20, [
    { depth: 0, key: 'add_research_slot', value: '1', isModifier: true, stat: stat('x') },
  ]),
]
const schedule = schedulePlan(['a', 'b', 'c'], Object.fromEntries(focuses.map((f) => [f.id, f])), {
  startDate: start,
  speedBonus: 0,
})
const options: CountryStateOptions = {
  tag: 'FIN',
  start: startLines,
  startDate: start,
  balanceOfPower: bop,
  adjustments: [
    {
      focus: {
        id: 'adjust:stability',
        name: 'seen',
        effects: [{ depth: 0, key: 'set_actual_stability', value: '0.6' }],
      },
      end: day(150),
    },
  ],
}
const purchase = (id: string, end: Date): Step => ({
  focus: {
    id,
    name: id,
    effects: [
      { depth: 0, key: 'add_ideas', value: id, valueName: id },
      modifier(1, 'fascism_drift', '0.2'),
    ],
  },
  end,
})
const extra = purchase('politics:0', day(40))

const sameState = (a: ReturnType<typeof countryStateAt>, b: ReturnType<typeof countryStateAt>) =>
  expect(a).toEqual(b)

describe('simulateCountry', () => {
  it('gives what countryStateAt gives, for dates asked in any order', () => {
    const withExtra = { ...options, extraSteps: [extra] }
    const sim = simulateCountry(schedule, withExtra)
    const dates = [0, 10, 400, 31, 31, 40, 39, 41, 100, 5, 150, 149, 151, 3000, 90, 91, 1000, 2]
    for (const n of dates) {
      sameState(sim.at(day(n)), countryStateAt(schedule, day(n), withExtra))
    }
  })

  it('crosses a balance range with a party drift', () => {
    // From -0.45 at 0.01 / 7 a day the balance enters `very-low` after about 105 days.
    const s = countryStateAt(schedule, day(300), options)
    expect(s.balanceChanges.length).toBeGreaterThan(0)
    expect(s.popularity.find((p) => p.subject === 'neutrality')!.total).toBeGreaterThan(0.1)
  })

  it('adds a step like an extra step, before and after its date', () => {
    const sim = simulateCountry(schedule, options)
    sim.at(day(2000))
    sim.addStep(extra)
    const withExtra = { ...options, extraSteps: [extra] }
    for (const n of [2000, 100, 39, 40, 41, 700, 10, 1000]) {
      sameState(sim.at(day(n)), countryStateAt(schedule, day(n), withExtra))
    }
    // A second step on a later day, after the first, as the political power planner makes them.
    const second = purchase('politics:1', day(200))
    sim.addStep(second)
    const both = { ...options, extraSteps: [extra, second] }
    for (const n of [250, 199, 200, 3000, 150, 201]) {
      sameState(sim.at(day(n)), countryStateAt(schedule, day(n), both))
    }
  })

  it('works without a start date by running each date from the beginning', () => {
    const noDate = { ...options, startDate: undefined }
    const sim = simulateCountry(schedule, noDate)
    for (const n of [50, 10, 200]) {
      sameState(sim.at(day(n)), countryStateAt(schedule, day(n), noDate))
    }
  })

  it('gives a date before the start the starting state', () => {
    const sim = simulateCountry(schedule, options)
    sim.at(day(500))
    const before = sim.at(new Date(Date.UTC(1935, 11, 1)))
    const first = sim.at(day(0))
    expect(before.popularity).toEqual(first.popularity)
    expect(before.balance).toBe(first.balance)
    expect(before.ideas.map((i) => i.id)).toEqual(first.ideas.map((i) => i.id))
  })

  it('does not change a state it gave earlier', () => {
    const sim = simulateCountry(schedule, options)
    const early = sim.at(day(100))
    const copy = structuredClone(early)
    sim.at(day(2000))
    sim.at(day(50))
    sim.addStep(extra)
    sim.at(day(3000))
    expect(early).toEqual(copy)
  })
})

describe('accrueDrift', () => {
  it('gives the same however the time is split', () => {
    const run = (cuts: number[]) => {
      const w = newWorking()
      applyReward(
        w,
        { focus: { id: 'start', name: 's', effects: startLines }, end: start },
        options,
      )
      applyReward(w, { focus: schedule.items[0].focus, end: schedule.items[0].end }, options)
      let from = start
      for (const n of [...cuts, 400]) {
        accrueDrift(w, from, day(n), options)
        from = day(n)
      }
      return {
        popularity: [...w.popularity.values()].map((p) => [p.subject, p.total]),
        balance: w.balance,
        changes: w.balanceChanges,
      }
    }
    const whole = run([])
    expect(whole.changes.length).toBeGreaterThan(0)
    expect(run([1, 2, 29])).toEqual(whole)
    // A cut on the day the range changes, and just either side of it.
    const crossing = whole.changes[0]
    const n = Math.round((crossing.getTime() - start.getTime()) / 86400000)
    for (const cut of [n - 1, n, n + 1]) expect(run([cut])).toEqual(whole)
  })
})

describe('changesWithoutEvents', () => {
  it('is true for what moves with the days', () => {
    expect(changesWithoutEvents({ type: 'popularity', ideology: 'x', op: '>', than: 0.3 })).toBe(
      true,
    )
    expect(changesWithoutEvents({ type: 'stat', key: 'stability', op: '>', than: 0.5 })).toBe(true)
    expect(changesWithoutEvents({ type: 'tech', id: 't' })).toBe(true)
    expect(changesWithoutEvents({ type: 'unknown', text: 'x' })).toBe(true)
  })

  it('is false for what only an event changes', () => {
    for (const check of [
      { type: 'idea', id: 'i' },
      { type: 'focus', id: 'f' },
      { type: 'government', id: 'g' },
      { type: 'leader', id: '1' },
      { type: 'tag', id: 'FIN' },
      { type: 'dlc', id: 'D' },
      { type: 'const', value: true },
      { type: 'war', atWar: true },
      { type: 'state', id: '1' },
      { type: 'flag', id: 'f' },
      { type: 'war_with', tag: 'SOV' },
      { type: 'factories', op: '>', than: 1 },
      { type: 'situation', key: 'subject', value: true },
      { type: 'major', value: true },
    ] as const) {
      expect(changesWithoutEvents(check)).toBe(false)
    }
  })

  it('looks through not, all and any', () => {
    const idea = { type: 'idea', id: 'i' } as const
    const stability = { type: 'stat', key: 'stability', op: '>', than: 0.5 } as const
    expect(changesWithoutEvents({ type: 'not', of: stability })).toBe(true)
    expect(changesWithoutEvents({ type: 'not', of: idea })).toBe(false)
    expect(changesWithoutEvents({ type: 'all', of: [idea, stability] })).toBe(true)
    expect(changesWithoutEvents({ type: 'any', of: [idea, idea] })).toBe(false)
  })
})
