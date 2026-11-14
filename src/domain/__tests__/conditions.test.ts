import { describe, expect, it } from 'vitest'
import { addDays } from '../calendar'
import type { Check, EffectLine, Focus } from '../focus'
import { countryStateAt } from '../campaign/countryState'
import { evaluateCheck, resolveConditions } from '../campaign/conditions'
import { schedulePlan } from '../plan/focusPlan'

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

const begin = new Date(Date.UTC(1936, 0, 1))

const stateOf = (focuses: Focus[], start: EffectLine[] = []) =>
  countryStateAt(
    schedulePlan(
      focuses.map((f) => f.id),
      Object.fromEntries(focuses.map((f) => [f.id, f])),
      { startDate: begin, speedBonus: 0 },
    ),
    addDays(begin, 70 * focuses.length),
    { tag: 'ROM', start, startDate: begin },
  )

const header = (key: string, depth: number, check?: Check): EffectLine => ({
  depth,
  key,
  ...(check && { check, condition: 'x' }),
})
const politics = (depth: number, value: string): EffectLine => ({
  depth,
  key: 'set_politics',
  value,
  valueName: value,
})
const popularity = (ideology: string, value: string): EffectLine => ({
  depth: 0,
  key: 'add_popularity',
  value,
  subject: ideology,
  isModifier: true,
  stat: { key: 'add_popularity', kind: 'percent' },
})

describe('evaluateCheck', () => {
  const ctx = {
    hasIdea: (id: string) => id === 'have',
    hasFocus: () => false,
    government: () => undefined,
    leader: () => ({ character: 'X' }),
    popularity: (i: string) => (i === 'a' ? 0.5 : undefined),
  }
  it('answers what it knows and is undefined otherwise', () => {
    expect(evaluateCheck({ type: 'idea', id: 'have' }, ctx)).toBe(true)
    expect(evaluateCheck({ type: 'government', id: 'x' }, ctx)).toBeUndefined()
    expect(evaluateCheck({ type: 'tech', id: 'x' }, ctx)).toBeUndefined()
    const known: Check = { type: 'idea', id: 'have' }
    const unknown: Check = { type: 'unknown' }
    // A decisive term settles `all` and `any` even beside an unknown one.
    expect(evaluateCheck({ type: 'all', of: [{ type: 'not', of: known }, unknown] }, ctx)).toBe(
      false,
    )
    expect(evaluateCheck({ type: 'any', of: [known, unknown] }, ctx)).toBe(true)
    expect(evaluateCheck({ type: 'all', of: [known, unknown] }, ctx)).toBeUndefined()
    expect(evaluateCheck({ type: 'popularity', ideology: 'a', op: '>=', than: 0.5 }, ctx)).toBe(
      true,
    )
    expect(
      evaluateCheck({ type: 'popularity', ideology: 'a', op: '>', than: 'b' }, ctx),
    ).toBeUndefined()
  })
})

describe('conditions on the country state', () => {
  it('applies a branch guarded by a completed focus', () => {
    const guarded = focus('b', [
      header('if', 0, { type: 'focus', id: 'a' }),
      politics(1, 'communism'),
    ])
    expect(stateOf([focus('a', []), guarded]).rulingParty).toBe('communism')
    const without = stateOf([guarded])
    expect(without.rulingParty).toBeUndefined()
    expect(without.conditional).toEqual([])
  })

  it('picks the ruling party from the popularity at the start, through else_if branches', () => {
    const pick = focus('pick', [
      header('if', 0, { type: 'popularity', ideology: 'democratic', op: '>', than: 'communism' }),
      politics(1, 'democratic'),
      header('else_if', 0, {
        type: 'popularity',
        ideology: 'communism',
        op: '>',
        than: 'democratic',
      }),
      politics(1, 'communism'),
    ])
    const start = [popularity('democratic', '0.2'), popularity('communism', '0.3')]
    const s = stateOf([pick], start)
    expect(s.rulingParty).toBe('communism')
    expect(s.conditional).toEqual([])
    // A later change in popularity flips it.
    const swing = focus('swing', [popularity('democratic', '0.2')])
    expect(stateOf([swing, pick], start).rulingParty).toBe('democratic')
  })

  it('applies a government check against the ruling party set before it', () => {
    const rule = focus('rule', [politics(0, 'fascism')])
    const check = focus('c', [
      header('if', 0, { type: 'government', id: 'fascism' }),
      { depth: 1, key: 'add_ideas', value: 'f', valueName: 'F' },
      header('else', 1),
      { depth: 2, key: 'add_ideas', value: 'other', valueName: 'Other' },
    ])
    expect(stateOf([rule, check]).ideas.map((i) => i.id)).toEqual(['f'])
    // With no ruling party known yet, the answer is unknown and the block stays listed.
    const unknown = stateOf([check])
    expect(unknown.ideas).toEqual([])
    expect(unknown.conditional).toHaveLength(1)
  })

  it('leaves a chain from the first unanswered branch on, as a plain if', () => {
    const lines: EffectLine[] = [
      header('if', 0, { type: 'idea', id: 'missing' }),
      { depth: 1, key: 'a', value: '1' },
      header('else_if', 0, { type: 'unknown' }),
      { depth: 1, key: 'b', value: '2' },
      header('else', 0),
      { depth: 1, key: 'c', value: '3' },
    ]
    const out = resolveConditions(lines, {
      hasIdea: () => false,
      hasFocus: () => false,
      government: () => undefined,
      leader: () => undefined,
      popularity: () => undefined,
    })
    expect(out.map((l) => `${l.depth}${l.key}`)).toEqual(['0if', '1b', '0else', '1c'])
  })

  it('answers has_country_leader from who leads, and forgets it on retire', () => {
    const guarded = (id: string) =>
      focus('g', [
        header('if', 0, { type: 'leader', id }),
        { depth: 1, key: 'add_ideas', value: 'hit', valueName: 'Hit' },
      ])
    const promoted: EffectLine[] = [
      { depth: 0, key: 'promote_character', value: 'ROM_tatarescu', subject: 'conservatism' },
    ]
    // A character leads, so a legacy id (550) is not them: nothing applies and nothing is listed.
    const no = stateOf([guarded('550')], promoted)
    expect(no.ideas).toEqual([])
    expect(no.conditional).toEqual([])
    const made = focus('m', [
      { depth: 0, key: 'create_country_leader', value: 'Carol II', leaderId: '550' },
    ])
    expect(stateOf([made, guarded('550')]).ideas.map((i) => i.id)).toEqual(['hit'])
    // Unknown with no leader at all, and again after the leader is retired.
    expect(stateOf([guarded('550')]).conditional).toHaveLength(1)
    const retire = focus('r', [{ depth: 0, key: 'retire_country_leader', value: 'yes' }])
    expect(stateOf([made, retire, guarded('550')]).conditional).toHaveLength(1)
    // By character, a character leader matches only their own id.
    const byCharacter = focus('c', [
      header('if', 0, { type: 'leader', character: 'ROM_tatarescu' }),
      { depth: 1, key: 'add_ideas', value: 'hit', valueName: 'Hit' },
    ])
    expect(stateOf([byCharacter], promoted).ideas.map((i) => i.id)).toEqual(['hit'])
  })
})
