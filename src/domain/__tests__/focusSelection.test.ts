import { describe, expect, it } from 'vitest'
import type { Focus } from '../focus'
import { isValidPlan, pathTo, removeWithDependents } from '../plan/focusSelection'

const f = (id: string, days: number, extra: Partial<Focus> = {}): Focus => ({
  id,
  name: id,
  days,
  prerequisites: [],
  mutuallyExclusive: [],
  x: 0,
  y: 0,
  ...extra,
})

// a -> b -> c ; d is an alternative to b (cheaper); e needs (b or d); x excludes a
const focuses: Record<string, Focus> = Object.fromEntries(
  [
    f('a', 70, { mutuallyExclusive: ['x'] }),
    f('b', 70, { prerequisites: [['a']] }),
    f('c', 70, { prerequisites: [['b']] }),
    f('d', 35, { prerequisites: [['a']] }),
    f('e', 70, { prerequisites: [['b', 'd']] }),
    f('x', 70),
  ].map((focus) => [focus.id, focus]),
)

describe('pathTo', () => {
  it('queues missing prerequisites first', () => {
    expect(pathTo('c', [], focuses)).toEqual(['a', 'b', 'c'])
    expect(pathTo('c', ['a'], focuses)).toEqual(['b', 'c'])
  })

  it('picks the cheapest option of an OR group, or reuses a planned one', () => {
    expect(pathTo('e', [], focuses)).toEqual(['a', 'd', 'e'])
    expect(pathTo('e', ['a', 'b'], focuses)).toEqual(['e'])
  })

  it('returns null when blocked by exclusivity, including through the path', () => {
    expect(pathTo('a', ['x'], focuses)).toBeNull()
    expect(pathTo('c', ['x'], focuses)).toBeNull()
  })

  it('returns an empty path for focuses already planned', () => {
    expect(pathTo('a', ['a'], focuses)).toEqual([])
  })
})

describe('removeWithDependents', () => {
  it('removes focuses that depended on the removed one', () => {
    expect(removeWithDependents('b', ['a', 'b', 'c', 'd'], focuses)).toEqual(['a', 'd'])
  })

  it('keeps focuses that still have another way in', () => {
    expect(removeWithDependents('b', ['a', 'b', 'd', 'e'], focuses)).toEqual(['a', 'd', 'e'])
  })
})

describe('isValidPlan', () => {
  it('checks order, exclusivity and duplicates', () => {
    expect(isValidPlan(['a', 'b'], focuses)).toBe(true)
    expect(isValidPlan(['b', 'a'], focuses)).toBe(false)
    expect(isValidPlan(['a', 'x'], focuses)).toBe(false)
    expect(isValidPlan(['a', 'a'], focuses)).toBe(false)
  })
})
