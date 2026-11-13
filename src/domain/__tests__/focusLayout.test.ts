import { describe, expect, it } from 'vitest'
import type { Focus } from '../focus'
import { layoutFocuses } from '../plan/focusLayout'

const f = (id: string, x: number, y: number, relativeTo?: string): Focus => ({
  id,
  name: id,
  days: 70,
  prerequisites: [],
  mutuallyExclusive: [],
  x,
  y,
  relativeTo,
})

describe('layoutFocuses', () => {
  it('resolves chains of relative positions regardless of order', () => {
    const pos = layoutFocuses([f('c', 1, 1, 'b'), f('b', -2, 1, 'a'), f('a', 3, 0)])
    expect(pos.b.x - pos.a.x).toBe(-2)
    expect(pos.c.x - pos.b.x).toBe(1)
    expect(pos.c.y).toBe(2)
  })

  it('shifts positions so the minimum is the origin', () => {
    const pos = layoutFocuses([f('a', -3, -1), f('b', 2, 4)])
    expect(pos.a).toEqual({ x: 0, y: 0 })
    expect(pos.b).toEqual({ x: 5, y: 5 })
  })

  it('tolerates missing and circular references', () => {
    const pos = layoutFocuses([f('a', 0, 0, 'b'), f('b', 1, 1, 'a'), f('c', 2, 2, 'nope')])
    expect(Object.keys(pos)).toHaveLength(3)
    expect(Object.values(pos).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })
})
