import { describe, expect, it } from 'vitest'
import type { Focus } from '../focus'
import { schedulePlan } from '../focusPlan'

const focus = (id: string, days: number, extra: Partial<Focus> = {}): Focus => ({
  id,
  name: id.toUpperCase(),
  days,
  prerequisites: [],
  mutuallyExclusive: [],
  x: 0,
  y: 0,
  ...extra,
})

const focuses: Record<string, Focus> = {
  a: focus('a', 70),
  b: focus('b', 35, { prerequisites: [['a']] }),
  c: focus('c', 35, { prerequisites: [['a', 'x']], mutuallyExclusive: ['d'] }),
  d: focus('d', 35, { mutuallyExclusive: ['c'] }),
}

const options = { startDate: new Date(Date.UTC(1936, 0, 1)), speedBonus: 0 }

describe('schedulePlan', () => {
  it('schedules focuses back to back', () => {
    const s = schedulePlan(['a', 'b'], focuses, options)
    expect(s.totalDays).toBe(105)
    expect(s.items[1].start).toEqual(s.items[0].end)
    expect(s.finish.toISOString().slice(0, 10)).toBe('1936-04-15')
  })

  it('applies the speed bonus as a divisor', () => {
    const s = schedulePlan(['a'], focuses, { ...options, speedBonus: 0.4 })
    expect(s.totalDays).toBeCloseTo(50)
  })

  it('returns the start date for an empty plan', () => {
    const s = schedulePlan([], focuses, options)
    expect(s.finish).toEqual(options.startDate)
    expect(s.totalDays).toBe(0)
  })

  it('flags missing prerequisites but still schedules the focus', () => {
    const s = schedulePlan(['b', 'a'], focuses, options)
    expect(s.items[0].issues).toEqual([
      { kind: 'missing-prerequisite', focusId: 'b', oneOf: ['a'] },
    ])
    expect(s.items).toHaveLength(2)
  })

  it('checks OR prerequisites, exclusivity and duplicates', () => {
    expect(schedulePlan(['c'], focuses, options).items[0].issues).toEqual([
      { kind: 'missing-prerequisite', focusId: 'c', oneOf: ['a', 'x'] },
    ])
    expect(schedulePlan(['a', 'c', 'd'], focuses, options).items[2].issues).toEqual([
      { kind: 'mutually-exclusive', focusId: 'd', conflictsWith: 'c' },
    ])
    expect(schedulePlan(['a', 'a'], focuses, options).items[1].issues[0].kind).toBe('duplicate')
  })
})
