import { describe, expect, it } from 'vitest'
import { buildTimeline, type TimelineInput } from '../campaign/timeline'
import { addDays } from '../calendar'
import type { Focus } from '../focus'

const d0 = new Date(Date.UTC(1936, 0, 1))
const focus = (id: string) => ({ id, name: id.toUpperCase() }) as unknown as Focus
const ahead = { years: 0, ignored: 0, penalty: 0 }

const base = (): TimelineInput => ({
  focusSchedule: {
    items: [
      { focus: focus('a'), start: d0, end: addDays(d0, 70), durationDays: 70, issues: [] },
      {
        focus: focus('b'),
        start: addDays(d0, 70),
        end: addDays(d0, 140),
        durationDays: 70,
        issues: [],
      },
    ],
    finish: addDays(d0, 140),
    totalDays: 140,
  },
  techs: { t1: { id: 't1', name: 'Tech One' }, t2: { id: 't2', name: 'Tech Two' } } as never,
  research: {
    items: [
      {
        index: 0,
        techId: 't1',
        slot: 0,
        start: d0,
        end: addDays(d0, 100),
        days: 100,
        ahead,
        issues: [],
      },
      {
        index: 1,
        techId: 't2',
        slot: 0,
        start: addDays(d0, 100),
        end: addDays(d0, 200),
        days: 100,
        ahead,
        issues: [],
      },
      { index: 2, techId: 'old', slot: -1, start: d0, end: d0, days: 0, ahead, issues: [] },
    ],
    unscheduled: [],
    researchedBy: () => new Set(),
  },
  options: [{ id: 'law', name: 'Law' } as never],
})

describe('buildTimeline', () => {
  it('puts a focus end and the next start on the same day', () => {
    const { days } = buildTimeline(base())
    const day = days.find((x) => x.day === days[0].day + 70)!
    expect(day.done[0].text).toContain('A completed')
    expect(day.todo.map((e) => e.text)).toContain('Start focus B')
  })

  it('pairs research completion with the next start and skips known techs', () => {
    const { days } = buildTimeline(base())
    const day = days.find((x) => x.day === days[0].day + 100)!
    expect(day.done[0].text).toBe('Tech One researched (slot 1)')
    expect(day.todo[0].text).toBe('Research Tech Two in slot 1')
    expect(JSON.stringify(days)).not.toContain('old')
  })

  it('lists construction levels and marks focus builds automatic', () => {
    const input = base()
    const level = { start: d0, end: addDays(d0, 50), days: 50, civs: 6 }
    input.construction = {
      items: [
        {
          index: 0,
          source: 'queue',
          item: { building: 'x', state: 1, levels: 2 },
          joined: d0,
          levels: [level],
          issues: [],
        },
        {
          index: 0,
          source: 'focus',
          focusName: 'A',
          item: { building: 'x', state: 1, levels: 1 },
          joined: d0,
          levels: [level],
          issues: [],
        },
      ],
      built: [],
      finish: addDays(d0, 50),
    }
    const { days } = buildTimeline(input)
    const first = days[0].todo.filter((e) => e.kind === 'construction')
    expect(first[0].text).toBe('Build x in State 1 (1/2, 6 civs)')
    expect(first[0].automatic).toBe(false)
    expect(first[1].automatic).toBe(true)
    expect(first[1].detail).toBe('from A')
    const end = days.find((x) => x.day === days[0].day + 50)!
    expect(end.done[0].text).toBe('x level 1/2 built in State 1')
  })

  it('lists purchases with their cost', () => {
    const input = base()
    input.politics = {
      items: [
        {
          index: 0,
          optionId: 'law',
          dismiss: false,
          date: addDays(d0, 5),
          cost: 150,
          balanceAfter: 3,
          issues: [],
        },
      ],
      unscheduled: [],
      balanceAt: () => 0,
      gainAt: () => 0,
    }
    const { days } = buildTimeline(input)
    const day = days.find((x) => x.day === days[0].day + 5)!
    expect(day.todo[0].text).toBe('Buy Law (150 PP)')
  })

  it('sorts days and orders kinds within a day', () => {
    const { days } = buildTimeline(base())
    expect(days.map((x) => x.day)).toEqual([...days.map((x) => x.day)].sort((a, b) => a - b))
    expect(days[0].todo.map((e) => e.kind)).toEqual(['focus', 'research'])
  })

  it('gives every action an id that does not depend on its date', () => {
    const ids = (input: TimelineInput) =>
      buildTimeline(input).days.flatMap((x) => x.todo.map((e) => e.id))
    const first = ids(base())
    expect(new Set(first).size).toBe(first.length)
    expect(first).toContain('focus:a')
    expect(first).toContain('research:t1')

    // A faster plan moves every date but keeps the ids, so checked-off actions stay checked.
    const faster = base()
    faster.focusSchedule.items[1].start = addDays(d0, 50)
    expect(ids(faster).sort()).toEqual([...first].sort())
  })
})
