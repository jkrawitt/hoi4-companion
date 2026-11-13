import { describe, expect, it } from 'vitest'
import type { EffectLine, Focus } from '../focus'
import { countryStateAt } from '../campaign/countryState'
import { schedulePlan } from '../plan/focusPlan'

const focus = (id: string, effects: EffectLine[], days = 70): Focus => ({
  id,
  name: id.toUpperCase(),
  days,
  prerequisites: [],
  mutuallyExclusive: [],
  x: 0,
  y: 0,
  effects,
})

const stat = (key: string) => ({ key, kind: 'percent' as const })
const modifier = (depth: number, key: string, value: string): EffectLine => ({
  depth,
  key,
  value,
  isModifier: true,
  stat: stat(key),
})

const start = new Date(Date.UTC(1936, 0, 1))
const day = (n: number) => new Date(start.getTime() + n * 86_400_000)

const stateAt = (focuses: Focus[], days: number) =>
  countryStateAt(
    schedulePlan(
      focuses.map((f) => f.id),
      Object.fromEntries(focuses.map((f) => [f.id, f])),
      { startDate: start, speedBonus: 0 },
    ),
    day(days),
    { tag: 'ROM' },
  )

const ideaFocus = (id: string, idea: string, mods: EffectLine[]) =>
  focus(id, [{ depth: 0, key: 'add_ideas', value: idea, valueName: idea }, ...mods])

describe('countryStateAt', () => {
  it('is empty before the first focus completes', () => {
    const s = stateAt([ideaFocus('a', 'idea_a', [modifier(1, 'x', '0.1')])], 69)
    expect(s.completed).toHaveLength(0)
    expect(s.next?.focus.id).toBe('a')
    expect(s.ideas).toEqual([])
    expect(s.modifierTotals).toEqual([])
  })

  it('adds ideas with their modifiers and sums them', () => {
    const s = stateAt(
      [
        ideaFocus('a', 'idea_a', [modifier(1, 'x', '0.1')]),
        ideaFocus('b', 'idea_b', [modifier(1, 'x', '0.05')]),
      ],
      140,
    )
    expect(s.ideas.map((i) => i.id)).toEqual(['idea_a', 'idea_b'])
    expect(s.ideas[0].modifiers[0].depth).toBe(0)
    expect(s.modifierTotals).toMatchObject([{ key: 'x', total: 0.15 }])
    expect(s.next).toBeUndefined()
  })

  it('removes an idea that a later focus removes', () => {
    const s = stateAt(
      [
        ideaFocus('a', 'idea_a', [modifier(1, 'x', '0.1')]),
        focus('b', [{ depth: 0, key: 'remove_ideas', value: 'idea_a' }]),
      ],
      140,
    )
    expect(s.ideas).toEqual([])
    expect(s.modifierTotals).toEqual([])
  })

  it('stops counting a timed idea once it runs out', () => {
    const timed = focus('a', [
      { depth: 0, key: 'add_timed_idea', value: 'idea_t', valueName: 'T', days: 30 },
      modifier(1, 'x', '0.1'),
    ])
    expect(stateAt([timed], 80).ideas).toHaveLength(1)
    expect(stateAt([timed], 101).ideas).toHaveLength(0)
  })

  it('sums one-off stat changes without counting idea modifiers twice', () => {
    const s = stateAt(
      [
        focus('a', [
          modifier(0, 'add_stability', '0.05'),
          { depth: 0, key: 'add_ideas', value: 'i', valueName: 'I' },
          modifier(1, 'x', '0.1'),
        ]),
        focus('b', [modifier(0, 'add_stability', '0.03')]),
      ],
      140,
    )
    expect(s.statChanges).toMatchObject([{ key: 'add_stability', total: 0.08 }])
  })

  it('sums popularity per ideology and tracks the ruling party', () => {
    const pop = (subject: string, value: string): EffectLine => ({
      ...modifier(0, 'add_popularity', value),
      subject,
      subjectName: subject,
    })
    const s = stateAt(
      [
        focus('a', [pop('fascism', '0.1'), pop('communism', '0.05')]),
        focus('b', [
          pop('fascism', '0.1'),
          { depth: 0, key: 'set_politics', value: 'fascism', valueName: 'Fascism' },
        ]),
      ],
      140,
    )
    expect(s.popularity).toMatchObject([
      { subject: 'fascism', total: 0.2 },
      { subject: 'communism', total: 0.05 },
    ])
    expect(s.rulingParty).toBe('Fascism')
  })

  it('lists conditional effects without applying them', () => {
    const s = stateAt(
      [
        focus('a', [
          { depth: 0, key: 'if', condition: 'x' },
          modifier(1, 'add_stability', '0.5'),
          modifier(0, 'add_political_power', '50'),
        ]),
      ],
      80,
    )
    expect(s.statChanges).toMatchObject([{ key: 'add_political_power', total: 50 }])
    expect(s.conditional).toHaveLength(1)
    expect(s.conditional[0].lines.map((l) => l.key)).toEqual(['if', 'add_stability'])
  })

  it('skips other countries and states but looks into hidden effects and its own scope', () => {
    const s = stateAt(
      [
        focus('a', [
          { depth: 0, key: 'SOV' },
          modifier(1, 'add_stability', '0.5'),
          { depth: 0, key: '46' },
          modifier(1, 'add_political_power', '50'),
          { depth: 0, key: 'hidden_effect' },
          modifier(1, 'army_experience', '10'),
          { depth: 0, key: 'ROM' },
          modifier(1, 'navy_experience', '5'),
        ]),
      ],
      80,
    )
    expect(s.statChanges.map((c) => c.key)).toEqual(['army_experience', 'navy_experience'])
  })

  it('names the leader from a character scope', () => {
    const s = stateAt(
      [
        focus('a', [
          { depth: 0, key: 'ROM_ion_antonescu', subjectName: 'Ion Antonescu' },
          { depth: 1, key: 'add_country_leader_role', value: 'promote' },
        ]),
      ],
      80,
    )
    expect(s.leader).toBe('Ion Antonescu')
  })
})
