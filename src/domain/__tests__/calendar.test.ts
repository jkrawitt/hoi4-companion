import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, fromGameDay, gameDay } from '../calendar'

const date = (text: string) => new Date(`${text}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)

describe('the game calendar', () => {
  it('has no 29 February: a factory 282 days from 1 January 1936 is done on 10 October', () => {
    expect(iso(addDays(date('1936-01-01'), 282))).toBe('1936-10-10')
    expect(iso(addDays(date('1936-02-28'), 1))).toBe('1936-03-01')
  })

  it('counts 365 days in every year', () => {
    expect(daysBetween(date('1936-01-01'), date('1937-01-01'))).toBe(365)
    expect(daysBetween(date('1936-01-01'), date('1940-01-01'))).toBe(4 * 365)
    expect(daysBetween(date('1936-03-01'), date('1936-02-28'))).toBe(-1)
  })

  it('keeps a fraction of a day as time of day, both ways', () => {
    const half = addDays(date('1936-01-01'), 52.5)
    expect(half.toISOString()).toBe('1936-02-22T12:00:00.000Z')
    expect(daysBetween(date('1936-01-01'), half)).toBe(52.5)
    expect(fromGameDay(gameDay(half))).toEqual(half)
  })

  it('treats a real 29 February as 1 March', () => {
    expect(gameDay(date('1936-02-29'))).toBe(gameDay(date('1936-03-01')))
  })
})
