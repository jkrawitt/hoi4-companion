import { describe, expect, it } from 'vitest'
import { addDays } from '../calendar'
import type { Check, EffectLine, Focus } from '../focus'
import { countryStateAt } from '../campaign/countryState'
import type { ConditionContext } from '../checks'
import { annotateConditions, resolveConditions } from '../campaign/conditions'
import { previewFocusEffects } from '../campaign/preview'
import { schedulePlan } from '../plan/focusPlan'

const focus = (id: string, effects: EffectLine[], prerequisites: string[][] = []): Focus => ({
  id,
  name: id.toUpperCase(),
  days: 70,
  prerequisites,
  mutuallyExclusive: [],
  x: 0,
  y: 0,
  effects,
})

const begin = new Date(Date.UTC(1936, 0, 1))

const header = (key: string, depth: number, check?: Check): EffectLine => ({
  depth,
  key,
  ...(check && { check, condition: 'x' }),
})
const leaf = (depth: number, key: string): EffectLine => ({ depth, key, value: '1' })
const idea = (id: string): Check => ({ type: 'idea', id })
const addIdea = (depth: number, id: string): EffectLine => ({
  depth,
  key: 'add_ideas',
  value: id,
  valueName: id,
})

const ctxWith = (have: string[]): ConditionContext => ({
  hasIdea: (id) => have.includes(id),
  hasFocus: () => false,
  government: () => undefined,
  leader: () => undefined,
  popularity: () => undefined,
  tag: 'ROM',
})

/** Each line as `key` with its mark: `+` applies, `-` skipped, nothing when unmarked. */
const marks = (lines: EffectLine[]) =>
  lines.map((l) => `${l.key}${l.branch === 'applies' ? '+' : l.branch === 'skipped' ? '-' : ''}`)

describe('annotateConditions', () => {
  it('marks an if with a following else', () => {
    const lines = [
      header('if', 0, idea('a')),
      leaf(1, 'x'),
      header('else', 0),
      leaf(1, 'y'),
      leaf(0, 'z'),
    ]
    expect(marks(annotateConditions(lines, ctxWith(['a'])))).toEqual([
      'if+',
      'x',
      'else-',
      'y-',
      'z',
    ])
    expect(marks(annotateConditions(lines, ctxWith([])))).toEqual(['if-', 'x-', 'else+', 'y', 'z'])
  })

  it('marks an else nested inside the if', () => {
    const lines = [
      header('if', 0, idea('a')),
      leaf(1, 'x'),
      header('else', 1),
      leaf(2, 'y'),
      leaf(0, 'z'),
    ]
    expect(marks(annotateConditions(lines, ctxWith(['a'])))).toEqual([
      'if+',
      'x',
      'else-',
      'y-',
      'z',
    ])
    expect(marks(annotateConditions(lines, ctxWith([])))).toEqual(['if-', 'x-', 'else+', 'y', 'z'])
  })

  it('marks the branch that applies in the middle of an else_if chain', () => {
    const lines = [
      header('if', 0, idea('a')),
      leaf(1, 'x'),
      header('else_if', 0, idea('b')),
      leaf(1, 'y'),
      header('else_if', 0, idea('c')),
      leaf(1, 'z'),
      header('else', 0),
      leaf(1, 'w'),
    ]
    expect(marks(annotateConditions(lines, ctxWith(['b', 'c'])))).toEqual([
      'if-',
      'x-',
      'else_if+',
      'y',
      'else_if-',
      'z-',
      'else-',
      'w-',
    ])
  })

  it('leaves the branches from an unsettled one on unmarked', () => {
    const lines = [
      header('if', 0, idea('a')),
      leaf(1, 'x'),
      header('else_if', 0, { type: 'unknown' }),
      leaf(1, 'y'),
      header('else', 0),
      leaf(1, 'z'),
    ]
    expect(marks(annotateConditions(lines, ctxWith([])))).toEqual([
      'if-',
      'x-',
      'else_if',
      'y',
      'else',
      'z',
    ])
    // Unsettled first: nothing is marked at all.
    const first = [
      header('if', 0, { type: 'unknown' }),
      leaf(1, 'x'),
      header('else', 0),
      leaf(1, 'y'),
    ]
    expect(marks(annotateConditions(first, ctxWith([])))).toEqual(['if', 'x', 'else', 'y'])
  })

  it('marks chains inside the applying branch, and keeps a skipped branch skipped', () => {
    const lines = [
      header('if', 0, idea('a')),
      header('if', 1, idea('b')),
      leaf(2, 'x'),
      header('else', 1),
      leaf(2, 'y'),
      header('else', 0),
      header('if', 1, idea('b')),
      leaf(2, 'z'),
    ]
    expect(marks(annotateConditions(lines, ctxWith(['a'])))).toEqual([
      'if+',
      'if-',
      'x-',
      'else+',
      'y',
      'else-',
      'if-',
      'z-',
    ])
  })

  it('does not settle a chain in another scope', () => {
    const own = [header('if', 0, idea('a')), leaf(1, 'x')]
    for (const scope of ['GER', 'every_other_country', '46', 'random_owned_state', 'FROM']) {
      const lines = [header(scope, 0), ...own.map((l) => ({ ...l, depth: l.depth + 1 }))]
      expect(marks(annotateConditions(lines, ctxWith(['a'])))).toEqual([scope, 'if', 'x'])
      expect(resolveConditions(lines, ctxWith(['a']))).toEqual(lines)
    }
    // The country's own scopes are settled.
    for (const scope of ['hidden_effect', 'ROM', 'ROOT']) {
      const lines = [header(scope, 0), ...own.map((l) => ({ ...l, depth: l.depth + 1 }))]
      expect(marks(annotateConditions(lines, ctxWith(['a'])))).toEqual([scope, 'if+', 'x'])
      expect(resolveConditions(lines, ctxWith(['a'])).map((l) => l.key)).toEqual([scope, 'x'])
    }
  })

  it('keeps exactly the lines resolveConditions keeps', () => {
    const shapes: EffectLine[][] = [
      [header('if', 0, idea('a')), leaf(1, 'x'), header('else', 0), leaf(1, 'y'), leaf(0, 'z')],
      [header('if', 0, idea('a')), leaf(1, 'x'), header('else', 1), leaf(2, 'y'), leaf(0, 'z')],
      [
        leaf(0, 'first'),
        header('if', 0, idea('a')),
        header('if', 1, idea('b')),
        leaf(2, 'x'),
        header('else_if', 1, idea('c')),
        leaf(2, 'y'),
        header('else', 0),
        leaf(1, 'w'),
        header('hidden_effect', 0),
        header('if', 1, idea('c')),
        leaf(2, 'h'),
      ],
    ]
    for (const lines of shapes) {
      for (const have of [[], ['a'], ['a', 'b'], ['a', 'c'], ['c']]) {
        const resolved = resolveConditions(lines, ctxWith(have))
        const kept = annotateConditions(lines, ctxWith(have))
          .filter(
            (l) => l.branch !== 'skipped' && !(l.key !== 'hidden_effect' && l.branch === 'applies'),
          )
          .map((l) => l.key)
        expect(resolved.map((l) => l.key)).toEqual(kept)
      }
    }
  })
})

describe('focusEffects of the country state', () => {
  const plan = (focuses: Focus[]) => {
    const byId = Object.fromEntries(focuses.map((f) => [f.id, f]))
    const ids = focuses.map((f) => f.id)
    const options = { startDate: begin, speedBonus: 0 }
    return { byId, ids, options, schedule: schedulePlan(ids, byId, options) }
  }

  const giver = focus('giver', [addIdea(0, 'spirit')])
  const check = focus(
    'check',
    [header('if', 0, idea('spirit')), leaf(1, 'x'), header('else', 0), leaf(1, 'y')],
    [['giver']],
  )

  it('carries the marks, based on an idea an earlier focus added', () => {
    const { schedule } = plan([giver, check])
    const state = countryStateAt(schedule, schedule.finish, { tag: 'ROM', startDate: begin })
    expect(marks(state.focusEffects.check)).toEqual(['if+', 'x', 'else-', 'y-'])
    expect(Object.keys(state.focusEffects).sort()).toEqual(['check', 'giver'])
    // Not completed by an earlier date, so not there yet.
    const early = countryStateAt(schedule, addDays(begin, 70), { tag: 'ROM', startDate: begin })
    expect(Object.keys(early.focusEffects)).toEqual(['giver'])
  })

  it('previews a focus that is not planned, with the prerequisites it needs', () => {
    const { byId, options } = plan([giver, check])
    const input = { focuses: byId, scheduleOptions: options, stateOptions: { tag: 'ROM' } }
    const preview = previewFocusEffects('check', { ...input, plan: [] })
    expect(preview?.added).toEqual(['giver'])
    expect(marks(preview!.effects)).toEqual(['if+', 'x', 'else-', 'y-'])
    // Without the prerequisite taking part there would be no idea: it is the else that applies.
    const lone = { ...byId, check: { ...check, prerequisites: [] } }
    const alone = previewFocusEffects('check', { ...input, focuses: lone, plan: [] })
    expect(alone?.added).toEqual([])
    expect(marks(alone!.effects)).toEqual(['if-', 'x-', 'else+', 'y'])
  })

  it('gives no preview for a focus exclusivity blocks', () => {
    const a = focus('a', [])
    const b = { ...focus('b', []), mutuallyExclusive: ['a'] }
    const { options } = plan([a, b])
    const input = {
      focuses: { a, b },
      scheduleOptions: options,
      stateOptions: { tag: 'ROM' },
    }
    expect(previewFocusEffects('b', { ...input, plan: ['a'] })).toBeUndefined()
  })
})
