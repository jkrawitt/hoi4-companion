import { describe, expect, it } from 'vitest'
import { addDays, daysBetween } from '../calendar'
import {
  emptyEnvironment,
  type ResearchBonus,
  type ResearchEnvironment,
  type ResearchItem,
  type Technology,
} from '../research'
import {
  aheadOfTime,
  availableBonuses,
  categoryBonusAt,
  bonusMatches,
  earliestFreeSlot,
  scheduleResearch,
} from '../plan/researchPlan'

const start = new Date(Date.UTC(1936, 0, 1))
const day = (n: number) => addDays(start, n)
const defines = { baseCost: 110, aheadPenalty: 2, minSpeed: 0.1 }

const tech = (id: string, extra: Partial<Technology> = {}): Technology => ({
  id,
  name: id,
  cost: 1,
  startYear: 1936,
  folders: [{ id: 'f', x: 0, y: 0 }],
  categories: [],
  prerequisites: [],
  exclusiveWith: [],
  researchable: true,
  modifiers: [],
  ...extra,
})
const techsOf = (...list: Technology[]) => Object.fromEntries(list.map((t) => [t.id, t]))

const env = (extra: Partial<ResearchEnvironment> = {}): ResearchEnvironment => ({
  ...emptyEnvironment(),
  slots: [{ date: start, total: 1 }],
  ...extra,
})

const q = (...ids: string[]): ResearchItem[] => ids.map((techId) => ({ techId }))

const run = (
  queue: ResearchItem[],
  techs: Record<string, Technology>,
  environment = env(),
  opts: { startDate?: Date; until?: Date } = {},
) =>
  scheduleResearch(queue, techs, environment, {
    startDate: opts.startDate ?? start,
    until: opts.until ?? day(5000),
    defines,
  })

const span = (s: ReturnType<typeof run>) =>
  s.items.map((i) => [i.techId, i.slot, daysBetween(start, i.start), i.days])

const bonus = (extra: Partial<ResearchBonus> = {}): ResearchBonus => ({
  ref: { focusId: 'focus', index: 0 },
  date: start,
  name: 'Focus',
  bonus: 1,
  uses: 1,
  ahead: 0,
  targets: ['cat'],
  targetKinds: ['category'],
  ...extra,
})

describe('scheduleResearch', () => {
  it('takes base cost x tech cost days for a tech at normal speed', () => {
    const s = run(q('a'), techsOf(tech('a', { cost: 1.5 })))
    expect(span(s)).toEqual([['a', 0, 0, 165]])
    expect(s.items[0].end).toEqual(day(165))
  })

  it('runs the queue one after another on one slot', () => {
    expect(span(run(q('a', 'b'), techsOf(tech('a'), tech('b'))))).toEqual([
      ['a', 0, 0, 110],
      ['b', 0, 110, 110],
    ])
  })

  it('spreads the queue over several slots, lowest slot first', () => {
    const s = run(
      q('a', 'b', 'c'),
      techsOf(tech('a'), tech('b'), tech('c')),
      env({ slots: [{ date: start, total: 2 }] }),
    )
    expect(span(s)).toEqual([
      ['a', 0, 0, 110],
      ['b', 1, 0, 110],
      ['c', 0, 110, 110],
    ])
  })

  it('starts a slot that a focus adds in the middle of the plan on the day it arrives', () => {
    const s = run(
      q('a', 'b'),
      techsOf(tech('a'), tech('b')),
      env({
        slots: [
          { date: start, total: 1 },
          { date: day(50), total: 2 },
        ],
      }),
    )
    expect(span(s)).toEqual([
      ['a', 0, 0, 110],
      ['b', 1, 50, 110],
    ])
  })

  it('does not let a tech that waits for a prerequisite hold up the ones behind it', () => {
    const techs = techsOf(
      tech('child', { prerequisites: [['parent']] }),
      tech('parent'),
      tech('other'),
    )
    expect(span(run(q('child', 'parent', 'other'), techs))).toEqual([
      ['child', 0, 110, 110],
      ['parent', 0, 0, 110],
      ['other', 0, 220, 110],
    ])
    expect(
      span(run(q('child', 'parent', 'other'), techs, env({ slots: [{ date: start, total: 2 }] }))),
    ).toEqual([
      ['child', 0, 110, 110],
      ['parent', 0, 0, 110],
      ['other', 1, 0, 110],
    ])
  })

  it('needs one tech of each prerequisite group', () => {
    const techs = techsOf(
      tech('a'),
      tech('b'),
      tech('c', { prerequisites: [['a', 'b'], ['d']] }),
      tech('d'),
    )
    const s = run(q('c', 'b', 'd'), techs, env({ slots: [{ date: start, total: 3 }] }))
    expect(span(s).find((x) => x[0] === 'c')).toEqual(['c', 0, 110, 110])
  })

  it('counts start techs and handed-out techs towards prerequisites', () => {
    const techs = techsOf(
      tech('a'),
      tech('b', { prerequisites: [['a']] }),
      tech('c', { prerequisites: [['x']] }),
      tech('x'),
    )
    expect(span(run(q('b'), techs, env({ startTechs: ['a'] })))).toEqual([['b', 0, 0, 110]])
    const granted = run(q('x', 'c'), techs, env({ grants: [{ date: day(30), techIds: ['x'] }] }))
    expect(span(granted)).toEqual([
      ['x', -1, 30, 0],
      ['c', 0, 30, 110],
    ])
    expect(granted.items[0].issues).toEqual([{ kind: 'already-researched' }])
  })

  it('never researches a tech two excluded techs share: the first queued wins', () => {
    const techs = techsOf(tech('a', { exclusiveWith: ['b'] }), tech('b', { exclusiveWith: ['a'] }))
    const s = run(q('a', 'b'), techs, env({ slots: [{ date: start, total: 2 }] }))
    expect(span(s)).toEqual([['a', 0, 0, 110]])
    expect(s.unscheduled).toEqual([{ index: 1, techId: 'b', reason: 'xor-blocked' }])
  })

  it('applies research speed, from the date it changes', () => {
    expect(
      span(run(q('a'), techsOf(tech('a')), env({ speed: [{ date: start, factor: 1 }] }))),
    ).toEqual([['a', 0, 0, 55]])
    // 20 days at speed 1 (20/110 done), then 0.1: 90/110 left at 1.1/110 a day.
    const s = run(q('a'), techsOf(tech('a')), env({ speed: [{ date: day(20), factor: 0.1 }] }))
    expect(s.items[0].days).toBe(20 + Math.ceil((90 / 110 - 0) / (1.1 / 110) - 1e-6))
  })

  it('never goes below the minimum speed', () => {
    const s = run(q('a'), techsOf(tech('a')), env({ speed: [{ date: start, factor: -5 }] }))
    expect(s.items[0].days).toBe(1100)
  })

  describe('researching ahead of time', () => {
    const early = new Date(Date.UTC(1935, 0, 1))
    const options = { startDate: early }
    const slots = { slots: [{ date: early, total: 1 }] }

    it('slows a tech that is ahead of its year down', () => {
      const s = run(q('a'), techsOf(tech('a')), env(slots), options)
      expect(s.items[0].days).toBeGreaterThan(110 * 1.5)
      expect(s.items[0].days).toBeLessThan(110 * 3)
    })

    it('charges nothing in or after the tech`s year', () => {
      expect(
        run(q('a'), techsOf(tech('a', { startYear: 1935 })), env(slots), options).items[0].days,
      ).toBe(110)
    })

    it('ignores the years a bonus says to ignore', () => {
      const environment = env({ ...slots, bonuses: [bonus({ ahead: 2, bonus: 0, date: early })] })
      const s = run(
        [{ techId: 'a', bonus: { focusId: 'focus', index: 0 } }],
        techsOf(tech('a', { categories: ['cat'] })),
        environment,
        options,
      )
      expect(s.items[0].days).toBe(110)
    })

    it('records the penalty on the day the tech started', () => {
      const s = run(q('a'), techsOf(tech('a')), env(slots), options)
      expect(s.items[0].ahead.years).toBeCloseTo(1, 2)
      expect(s.items[0].ahead.penalty).toBeCloseTo(3, 2)
      expect(s.items[0].ahead.ignored).toBe(0)
    })

    it('records what a bonus ignores, and no penalty when it covers the lot', () => {
      const environment = env({ ...slots, bonuses: [bonus({ ahead: 2, bonus: 0, date: early })] })
      const s = run(
        [{ techId: 'a', bonus: { focusId: 'focus', index: 0 } }],
        techsOf(tech('a', { categories: ['cat'] })),
        environment,
        options,
      )
      expect(s.items[0].ahead).toMatchObject({ ignored: 2, penalty: 1 })
      expect(s.items[0].ahead.years).toBeCloseTo(1, 2)
    })

    it('records nothing for a tech that is not early', () => {
      const s = run(q('a'), techsOf(tech('a', { startYear: 1935 })), env(slots), options)
      expect(s.items[0].ahead).toEqual({ years: 0, ignored: 0, penalty: 1 })
    })
  })

  describe('earliestFreeSlot', () => {
    it('is the start with nothing queued', () => {
      const s = run([], techsOf())
      expect(earliestFreeSlot(s, env(), start)).toEqual(start)
    })

    it('is when the first slot to finish is free', () => {
      const environment = env({ slots: [{ date: start, total: 2 }] })
      const s = run(
        q('a', 'b'),
        techsOf(tech('a', { cost: 1 }), tech('b', { cost: 2 })),
        environment,
      )
      const [a] = s.items
      expect(earliestFreeSlot(s, environment, start)).toEqual(a.end)
    })

    it('is the start while a slot has nothing in it', () => {
      const environment = env({ slots: [{ date: start, total: 2 }] })
      const s = run(q('a'), techsOf(tech('a')), environment)
      expect(earliestFreeSlot(s, environment, start)).toEqual(start)
    })

    it('is not before a slot that a focus adds exists', () => {
      const added = day(400)
      const environment = env({
        slots: [
          { date: start, total: 1 },
          { date: added, total: 2 },
        ],
      })
      // The first slot is busy for 550 days, and the added one has nothing in it.
      const s = run(q('a'), techsOf(tech('a', { cost: 5 })), environment)
      expect(s.items[0].end.getTime()).toBeGreaterThan(added.getTime())
      expect(earliestFreeSlot(s, environment, start)).toEqual(added)
    })

    it('is undefined without a slot', () => {
      expect(earliestFreeSlot({ items: [] }, { slots: [] }, start)).toBeUndefined()
    })
  })

  describe('aheadOfTime', () => {
    it('adds the penalty for each year before January 1st of the start year', () => {
      const ahead = aheadOfTime({ startYear: 1938 }, new Date(Date.UTC(1936, 0, 1)), 0, defines)
      expect(ahead.years).toBeCloseTo(2, 1)
      expect(ahead.penalty).toBeCloseTo(5, 1)
    })

    it('takes off the years a bonus ignores, but never goes below 1', () => {
      const date = new Date(Date.UTC(1936, 0, 1))
      expect(aheadOfTime({ startYear: 1938 }, date, 1, defines).penalty).toBeCloseTo(3, 1)
      expect(aheadOfTime({ startYear: 1938 }, date, 5, defines).penalty).toBe(1)
    })

    it('is nothing from the start year on', () => {
      const ahead = aheadOfTime({ startYear: 1936 }, new Date(Date.UTC(1937, 5, 1)), 0, defines)
      expect(ahead).toEqual({ years: 0, ignored: 0, penalty: 1 })
    })
  })

  describe('bonuses', () => {
    const chosen = { focusId: 'focus', index: 0 }
    const withBonus = (...ids: string[]): ResearchItem[] =>
      ids.map((techId) => ({ techId, bonus: chosen }))
    const catTech = (id: string) => tech(id, { categories: ['cat'] })

    it('adds the bonus to the speed of the tech it was chosen for', () => {
      const s = run(withBonus('a'), techsOf(catTech('a')), env({ bonuses: [bonus()] }))
      expect(s.items[0]).toMatchObject({ days: 55, bonusUsed: chosen, issues: [] })
    })

    it('can be aimed at a technology instead of a category', () => {
      const b = bonus({ targets: ['a'], targetKinds: ['technology'] })
      const s = run(
        withBonus('a', 'b'),
        techsOf(tech('a'), tech('b')),
        env({ bonuses: [b], slots: [{ date: start, total: 2 }] }),
      )
      expect(s.items.map((i) => [i.techId, i.days, i.issues.length])).toEqual([
        ['a', 55, 0],
        ['b', 110, 1],
      ])
    })

    it('is not used by a tech it does not apply to', () => {
      const s = run(
        withBonus('a'),
        techsOf(tech('a', { categories: ['other'] })),
        env({ bonuses: [bonus()] }),
      )
      expect(s.items[0]).toMatchObject({ days: 110, bonusUsed: undefined })
      expect(s.items[0].issues).toEqual([{ kind: 'bonus-unavailable' }])
    })

    it('is not used by a tech that starts before it is granted', () => {
      const s = run(
        withBonus('a'),
        techsOf(catTech('a')),
        env({ bonuses: [bonus({ date: day(10) })] }),
      )
      expect(s.items[0].days).toBe(110)
      expect(s.items[0].issues).toEqual([{ kind: 'bonus-unavailable' }])
    })

    it('runs out after its uses', () => {
      const environment = env({ bonuses: [bonus({ uses: 2 })], slots: [{ date: start, total: 3 }] })
      const s = run(
        withBonus('a', 'b', 'c'),
        techsOf(catTech('a'), catTech('b'), catTech('c')),
        environment,
      )
      expect(s.items.map((i) => [i.techId, i.days, i.issues.length])).toEqual([
        ['a', 55, 0],
        ['b', 55, 0],
        ['c', 110, 1],
      ])
    })

    it('is offered to the rows that can still use it', () => {
      const environment = env({
        bonuses: [bonus(), bonus({ ref: { focusId: 'later', index: 0 }, date: day(500) })],
      })
      const techs = techsOf(catTech('a'), catTech('b'))
      const queue = [{ techId: 'a', bonus: chosen }, { techId: 'b' }]
      const s = run(queue, techs, environment)
      // `a` has the only use of the first bonus, so `b` (which starts later) is not offered it.
      expect(availableBonuses(techs.a, 0, s, environment).map((b) => b.ref.focusId)).toEqual([
        'focus',
      ])
      expect(availableBonuses(techs.b, 1, s, environment)).toEqual([])
      expect(bonusMatches(bonus(), techs.a)).toBe(true)
    })
  })

  it('says why a queued tech is left out', () => {
    const techs = techsOf(
      tech('a'),
      tech('special', { researchable: false }),
      tech('needs', { prerequisites: [['missing']] }),
      tech('missing'),
      tech('slow', { cost: 1000 }),
    )
    const s = run(q('a', 'a', 'special', 'nope', 'needs', 'slow'), techs, env(), {
      until: day(400),
    })
    expect(s.unscheduled.map((u) => [u.index, u.reason])).toEqual([
      [1, 'duplicate'],
      [2, 'not-researchable'],
      [3, 'unknown-tech'],
      [4, 'missing-prerequisite'],
      [5, 'out-of-time'],
    ])
    expect(s.items.map((i) => i.techId)).toEqual(['a'])
  })

  it('does nothing without a research slot', () => {
    const s = run(q('a'), techsOf(tech('a')), env({ slots: [] }))
    expect(s.items).toEqual([])
    expect(s.unscheduled[0].reason).toBe('out-of-time')
  })

  it('knows what the country has had by a date', () => {
    const s = run(
      q('a', 'x'),
      techsOf(tech('a'), tech('x')),
      env({ startTechs: ['s'], grants: [{ date: day(20), techIds: ['x'] }] }),
    )
    expect([...s.researchedBy(day(0))]).toEqual(['s'])
    expect([...s.researchedBy(day(20))].sort()).toEqual(['s', 'x'])
    expect([...s.researchedBy(day(110))].sort()).toEqual(['a', 's', 'x'])
  })
})

describe('category research bonus', () => {
  const days = (s: ReturnType<typeof run>) => s.items[0].days
  const armor = tech('t', { categories: ['armor', 'tank_tech'] })
  const bonusEnv = (extra: ResearchEnvironment['categorySpeed']) => env({ categorySpeed: extra })

  it('speeds up a tech in the category, and only while the designer is held', () => {
    const base = days(run(q('t'), techsOf(armor)))
    const fast = days(
      run(q('t'), techsOf(armor), bonusEnv([{ date: start, bonuses: { armor: 0.15 } }])),
    )
    expect(base).toBe(110)
    expect(fast).toBe(Math.ceil(110 / 1.15))
    // Gone again after 50 days: the rest runs at the normal rate.
    const lost = days(
      run(
        q('t'),
        techsOf(armor),
        bonusEnv([
          { date: start, bonuses: { armor: 0.15 } },
          { date: day(50), bonuses: {} },
        ]),
      ),
    )
    expect(lost).toBeGreaterThan(fast)
    expect(lost).toBeLessThan(base)
  })

  it('leaves other categories alone and sums matching ones', () => {
    const plain = tech('p', { categories: ['industry'] })
    const unchanged = days(
      run(q('p'), techsOf(plain), bonusEnv([{ date: start, bonuses: { armor: 0.15 } }])),
    )
    expect(unchanged).toBe(110)
    const both = days(
      run(
        q('t'),
        techsOf(armor),
        bonusEnv([{ date: start, bonuses: { armor: 0.1, tank_tech: 0.1 } }]),
      ),
    )
    expect(both).toBe(Math.ceil(110 / 1.2))
  })

  it('starts the bonus from the day it is in force', () => {
    expect(
      categoryBonusAt(
        { categorySpeed: [{ date: day(5), bonuses: { armor: 0.2 } }] },
        armor,
        day(4),
      ),
    ).toBe(0)
    expect(
      categoryBonusAt(
        { categorySpeed: [{ date: day(5), bonuses: { armor: 0.2 } }] },
        armor,
        day(5),
      ),
    ).toBe(0.2)
  })
})
