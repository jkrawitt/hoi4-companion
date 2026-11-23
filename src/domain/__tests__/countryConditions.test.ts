import { describe, expect, it } from 'vitest'
import { addDays } from '../calendar'
import { START_ID, type Check, type EffectLine, type Focus } from '../focus'
import { applyReward, newWorking, type Step } from '../campaign/applyReward'
import { evaluateCheck } from '../campaign/conditions'
import { countryConditions, factsOfState, factsOfWorking } from '../campaign/countryConditions'
import { countryStateAt } from '../campaign/countryState'
import type { CountryStateOptions } from '../campaign/types'
import { schedulePlan } from '../plan/focusPlan'

const begin = new Date(Date.UTC(1936, 0, 1))
const focus = (id: string, effects: EffectLine[]): Focus => ({
  id,
  name: id,
  days: 7,
  prerequisites: [],
  mutuallyExclusive: [],
  x: 0,
  y: 0,
  effects,
})
const line = (key: string, value: string, extra: Partial<EffectLine> = {}): EffectLine => ({
  depth: 0,
  key,
  value,
  ...extra,
})
const modifier = (key: string, value: string): EffectLine => ({
  depth: 0,
  key,
  value,
  isModifier: true,
  stat: { key, kind: 'percent' as const },
})
const startLines: EffectLine[] = [
  modifier('add_stability', '0.6'),
  modifier('add_war_support', '0.3'),
  line('set_politics', 'neutrality'),
  line('add_popularity', '0.6', { subject: 'neutrality' }),
  line('add_popularity', '0.4', { subject: 'fascism' }),
]
const options: CountryStateOptions = {
  tag: 'ROM',
  start: startLines,
  startDate: begin,
  ownedDlc: { Owned: true },
  ownedStates: [46],
  hasTech: (id) => id === 'tech',
}

const checks: Check[] = [
  { type: 'idea', id: 'idea' },
  { type: 'idea', id: 'other' },
  { type: 'focus', id: 'a' },
  { type: 'focus', id: 'zzz' },
  { type: 'government', id: 'democratic' },
  { type: 'government', id: 'neutrality' },
  { type: 'leader', id: '550' },
  { type: 'leader', character: 'x' },
  { type: 'popularity', ideology: 'neutrality', op: '>', than: 0.5 },
  { type: 'popularity', ideology: 'communism', op: '>', than: 0.01 },
  { type: 'stat', key: 'stability', op: '>', than: 0.5 },
  { type: 'stat', key: 'war_support', op: '>', than: 0.5 },
  { type: 'flag', id: 'F' },
  { type: 'flag', id: 'G' },
  { type: 'flag', id: 'never' },
  { type: 'state', id: '46' },
  { type: 'state', id: '47' },
  { type: 'war', atWar: true },
  { type: 'war_with', tag: 'SOV' },
  { type: 'war_with', tag: 'GER' },
  { type: 'tech', id: 'tech' },
  { type: 'tech', id: 'other' },
  { type: 'dlc', id: 'Owned' },
  { type: 'dlc', id: 'Other' },
  { type: 'tag', id: 'ROM' },
  { type: 'tag', id: 'HUN' },
]

const rewards = (retire: boolean): Focus[] => [
  focus('a', [
    line('add_ideas', 'idea', { valueName: 'idea' }),
    line('set_country_flag', 'F', { bookkeeping: true }),
    line('set_country_flag', 'G', { bookkeeping: true }),
    line('clr_country_flag', 'G', { bookkeeping: true }),
    line('create_country_leader', 'Carol', { subject: 'despotism', leaderId: '550' }),
  ]),
  focus('b', retire ? [line('retire_country_leader', 'yes')] : []),
]

/** The country both ways: the working state after running the rewards, and the state handed out. */
const both = (retire: boolean, enemies?: string[]) => {
  const focuses = rewards(retire)
  const schedule = schedulePlan(['a', 'b'], Object.fromEntries(focuses.map((f) => [f.id, f])), {
    startDate: begin,
    speedBonus: 0,
  })
  const last = schedule.items[schedule.items.length - 1].end
  const war: Step[] = enemies
    ? [
        {
          focus: {
            id: 'war',
            name: 'war',
            effects: [line('set_enemies', enemies.join(' ') || 'none')],
          },
          end: last,
        },
      ]
    : []
  const w = newWorking()
  const steps: Step[] = [
    { focus: { id: START_ID, name: 'Game start', effects: startLines }, end: begin },
    ...schedule.items,
    ...war,
  ]
  for (const step of steps) applyReward(w, step, options)
  const state = countryStateAt(schedule, last, { ...options, adjustments: war })
  return { w, state, last }
}

describe('countryConditions', () => {
  for (const [name, retire, enemies] of [
    ['a country with a leader at peace', false, undefined],
    ['a country whose leader retired', true, undefined],
    ['a country at war', false, ['SOV']],
    ['a country back at peace', true, []],
  ] as const) {
    it(`answers the same from the working state and the state handed out: ${name}`, () => {
      const { w, state, last } = both(retire, enemies)
      const fromWorking = countryConditions(factsOfWorking(w, options, last), options)
      const fromState = countryConditions(factsOfState(state), options)
      for (const check of checks) {
        expect(evaluateCheck(check, fromState), JSON.stringify(check)).toBe(
          evaluateCheck(check, fromWorking),
        )
      }
    })
  }

  it('answers flags, the leader, wars and states', () => {
    const { state } = both(false, ['SOV'])
    const ctx = countryConditions(factsOfState(state), options)
    expect(evaluateCheck({ type: 'flag', id: 'F' }, ctx)).toBe(true)
    expect(evaluateCheck({ type: 'flag', id: 'G' }, ctx)).toBe(false)
    expect(evaluateCheck({ type: 'flag', id: 'never' }, ctx)).toBeUndefined()
    expect(evaluateCheck({ type: 'flag', id: 'constructor' }, ctx)).toBeUndefined()
    expect(evaluateCheck({ type: 'leader', id: '550' }, ctx)).toBe(true)
    expect(evaluateCheck({ type: 'war_with', tag: 'SOV' }, ctx)).toBe(true)
    expect(evaluateCheck({ type: 'war_with', tag: 'GER' }, ctx)).toBe(false)
    expect(evaluateCheck({ type: 'state', id: '46' }, ctx)).toBe(true)
    expect(evaluateCheck({ type: 'state', id: '47' }, ctx)).toBeUndefined()
  })

  it('knows no leader after a retirement until a successor is picked', () => {
    const { state } = both(true)
    expect(state.leader?.id).toBe('550')
    expect(state.leaderIdentity).toBeUndefined()
    const ctx = countryConditions(factsOfState(state), options)
    expect(evaluateCheck({ type: 'leader', id: '550' }, ctx)).toBeUndefined()
  })

  it('leaves war unknown before the first entry, or at peace when peace is assumed', () => {
    const { state } = both(false)
    const asked = countryConditions(factsOfState(state), options)
    expect(evaluateCheck({ type: 'war', atWar: true }, asked)).toBeUndefined()
    expect(evaluateCheck({ type: 'war_with', tag: 'SOV' }, asked)).toBeUndefined()
    const peace = countryConditions(factsOfState(state), options, { assumePeace: true })
    expect(evaluateCheck({ type: 'war', atWar: true }, peace)).toBe(false)
    expect(evaluateCheck({ type: 'war_with', tag: 'SOV' }, peace)).toBe(false)
  })

  it('takes a war entered by the player over assumePeace', () => {
    const { state } = both(false, ['SOV'])
    const peace = countryConditions(factsOfState(state), options, { assumePeace: true })
    expect(evaluateCheck({ type: 'war', atWar: true }, peace)).toBe(true)
    expect(evaluateCheck({ type: 'war_with', tag: 'SOV' }, peace)).toBe(true)
  })

  it('answers popularity and stats only once the start is known', () => {
    const schedule = schedulePlan([], {}, { startDate: begin, speedBonus: 0 })
    const bare = countryStateAt(schedule, addDays(begin, 10), { tag: 'ROM' })
    const ctx = countryConditions(factsOfState(bare), { tag: 'ROM' })
    expect(evaluateCheck({ type: 'stat', key: 'stability', op: '>', than: 0 }, ctx)).toBeUndefined()
    expect(
      evaluateCheck({ type: 'popularity', ideology: 'x', op: '>', than: 0 }, ctx),
    ).toBeUndefined()
  })

  it('passes the extras on', () => {
    const { state } = both(false)
    const ctx = countryConditions(factsOfState(state), options, {
      factories: () => 5,
      isMajor: () => true,
    })
    expect(evaluateCheck({ type: 'factories', op: '<', than: 10 }, ctx)).toBe(true)
    expect(evaluateCheck({ type: 'major', value: true }, ctx)).toBe(true)
  })
})
