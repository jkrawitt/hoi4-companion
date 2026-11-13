import { describe, expect, it } from 'vitest'
import type { Technology } from '../research'
import { isValidResearchPlan, pathToTech, removeWithDependents } from '../plan/researchSelection'

const t = (id: string, cost: number, extra: Partial<Technology> = {}): Technology => ({
  id,
  name: id,
  cost,
  startYear: 1936,
  folders: [{ id: 'f', x: 0, y: 0 }],
  categories: [],
  prerequisites: [],
  exclusiveWith: [],
  researchable: true,
  modifiers: [],
  ...extra,
})

// a -> b -> c ; d is a cheaper alternative to b ; e needs (b or d) ; x excludes a ; s is a special project
const techs: Record<string, Technology> = Object.fromEntries(
  [
    t('a', 1, { exclusiveWith: ['x'] }),
    t('b', 2, { prerequisites: [['a']] }),
    t('c', 1, { prerequisites: [['b']] }),
    t('d', 1, { prerequisites: [['a']] }),
    t('e', 1, { prerequisites: [['b', 'd']] }),
    t('x', 1),
    t('s', 1, { researchable: false }),
    t('after_s', 1, { prerequisites: [['s']] }),
    t('both', 1, { prerequisites: [['a'], ['x']] }),
  ].map((tech) => [tech.id, tech]),
)
const q = (...ids: string[]) => ids.map((techId) => ({ techId }))

describe('pathToTech', () => {
  it('queues missing prerequisites first', () => {
    expect(pathToTech('c', [], techs)).toEqual(['a', 'b', 'c'])
    expect(pathToTech('c', q('a'), techs)).toEqual(['b', 'c'])
  })

  it('is empty for a tech that is already queued or known', () => {
    expect(pathToTech('b', q('a', 'b'), techs)).toEqual([])
    expect(pathToTech('a', [], techs, new Set(['a']))).toEqual([])
  })

  it('counts known techs as prerequisites', () => {
    expect(pathToTech('c', [], techs, new Set(['a', 'b']))).toEqual(['c'])
  })

  it('takes the cheapest option of an OR group', () => {
    expect(pathToTech('e', [], techs)).toEqual(['a', 'd', 'e'])
    expect(pathToTech('e', q('a', 'b'), techs)).toEqual(['e'])
  })

  it('returns null for a tech that excludes a queued or known one', () => {
    expect(pathToTech('x', q('a'), techs)).toBeNull()
    expect(pathToTech('a', q('x'), techs)).toBeNull()
    expect(pathToTech('a', [], techs, new Set(['x']))).toBeNull()
    expect(pathToTech('both', [], techs)).toBeNull()
  })

  it('returns null for techs that cannot be researched, or need one that cannot', () => {
    expect(pathToTech('s', [], techs)).toBeNull()
    expect(pathToTech('after_s', [], techs)).toBeNull()
    expect(pathToTech('after_s', [], techs, new Set(['s']))).toEqual(['after_s'])
    expect(pathToTech('missing', [], techs)).toBeNull()
  })
})

describe('removeWithDependents', () => {
  it('drops the tech and everything that loses its prerequisites', () => {
    expect(removeWithDependents('a', q('a', 'b', 'c', 'x'), techs)).toEqual(q('x'))
    expect(removeWithDependents('b', q('a', 'b', 'c', 'd', 'e'), techs)).toEqual(q('a', 'd', 'e'))
  })

  it('keeps a tech whose prerequisite is known', () => {
    expect(removeWithDependents('a', q('a', 'b'), techs, new Set(['a']))).toEqual(q('b'))
  })

  it('keeps the bonus chosen on the techs that stay', () => {
    const queue = [{ techId: 'a' }, { techId: 'x', bonus: { focusId: 'f', index: 0 } }]
    expect(removeWithDependents('a', queue, techs)).toEqual([queue[1]])
  })
})

describe('isValidResearchPlan', () => {
  it('accepts a queue in dependency order', () => {
    expect(isValidResearchPlan(q('a', 'b', 'c'), techs)).toBe(true)
    expect(isValidResearchPlan([], techs)).toBe(true)
  })

  it('rejects a tech before its prerequisite, repeats, exclusive pairs and unresearchable techs', () => {
    expect(isValidResearchPlan(q('b', 'a'), techs)).toBe(false)
    expect(isValidResearchPlan(q('a', 'a'), techs)).toBe(false)
    expect(isValidResearchPlan(q('a', 'x'), techs)).toBe(false)
    expect(isValidResearchPlan(q('s'), techs)).toBe(false)
    expect(isValidResearchPlan(q('nope'), techs)).toBe(false)
  })

  it('takes known techs as done', () => {
    expect(isValidResearchPlan(q('b'), techs, new Set(['a']))).toBe(true)
  })
})
