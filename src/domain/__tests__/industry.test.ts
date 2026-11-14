import { describe, expect, it } from 'vitest'
import { consumerGoodsFor, industryAt } from '../campaign/industry'
import type { BuildingTotal, ConstructionBatch, CountryState, StatTotal } from '../campaign/types'
import type { ProductionData } from '../production'

const total = (key: string, value: number): StatTotal => ({
  key,
  stat: { key, kind: 'number' },
  total: value,
})

const production: ProductionData = {
  states: [
    {
      id: 1,
      name: 'A',
      category: 'city',
      buildings: { infrastructure: 3, arms_factory: 3, industrial_complex: 1 },
      resources: { oil: 4 },
      manpower: 0,
    },
    {
      id: 2,
      name: 'B',
      category: 'rural',
      buildings: { industrial_complex: 4, dockyard: 2, air_base: 1 },
      resources: {},
      manpower: 0,
    },
  ],
  categorySlots: { city: 6, rural: 3 },
  sharedSlotBuildings: ['arms_factory', 'industrial_complex', 'dockyard'],
  defines: { minConsumerFactories: 1, minConsumerPercent: 0.1 },
}

const building = (type: string, n: number, instant: boolean): BuildingTotal => ({
  type,
  name: type,
  total: n,
  instant,
})

const bld = (type: string, level: number, instant: boolean) => ({
  type,
  name: type,
  level,
  instant,
})

const batch = (extra: Partial<ConstructionBatch>): ConstructionBatch => ({
  focusId: 'f',
  focusName: 'F',
  date: new Date(Date.UTC(1936, 6, 1)),
  random: false,
  buildings: [],
  slots: 0,
  resources: [],
  ...extra,
})

const country = (extra: Partial<CountryState> = {}): CountryState =>
  ({
    modifierTotals: [],
    buildings: [],
    buildingSlots: 0,
    construction: [],
    ...extra,
  }) as unknown as CountryState

describe('industryAt', () => {
  it('counts what the states start with', () => {
    const industry = industryAt(production, country(), [])
    const count = (type: string) => industry.factories.find((f) => f.type === type)?.count
    expect([count('industrial_complex'), count('arms_factory'), count('dockyard')]).toEqual([
      5, 3, 2,
    ])
    expect(industry.slots).toEqual({ total: 9, used: 10, free: -1 })
    expect(industry.states[0]).toMatchObject({ slots: 6, used: 4, infrastructure: 3, civ: 1 })
  })

  it('counts instant focus builds and lists queued ones apart', () => {
    const industry = industryAt(
      production,
      country({
        buildings: [building('arms_factory', 2, true), building('industrial_complex', 1, false)],
        buildingSlots: 3,
        construction: [
          batch({
            state: 2,
            slots: 3,
            buildings: [bld('arms_factory', 2, true), bld('industrial_complex', 1, false)],
          }),
        ],
      }),
      [],
    )
    expect(industry.factories.find((f) => f.type === 'arms_factory')?.count).toBe(5)
    expect(industry.factories.find((f) => f.type === 'industrial_complex')?.count).toBe(5)
    expect(industry.queued.map((b) => [b.type, b.stateId])).toEqual([['industrial_complex', 2]])
    expect(industry.states[1]).toMatchObject({ mil: 2, civ: 4, slots: 6, used: 8 })
    expect(industry.slots.total).toBe(12)
  })

  it('scales state slots by the factor of ideas and technologies, rounding down', () => {
    const industry = industryAt(
      production,
      country({ modifierTotals: [total('global_building_slots_factor', 0.1)] }),
      [total('global_building_slots_factor', 0.1)],
    )
    // city 6 * 1.2 = 7.2 -> 7, rural 3 * 1.2 = 3.6 -> 3
    expect(industry.states.map((s) => s.slots)).toEqual([7, 3])
  })

  it('takes consumer goods from the ideas and leaves the rest of the civs', () => {
    const industry = industryAt(
      production,
      country({
        modifierTotals: [
          total('consumer_goods_expected_value', 0.35),
          total('consumer_goods_factor', 0.4),
        ],
      }),
      [],
    )
    // 0.35 * 1.4 = 0.49 of 5 + 3 factories -> ceil(3.92) = 4
    expect(industry.consumerGoods.factories).toBe(4)
    expect(industry.consumerGoods.percent).toBeCloseTo(0.49)
    expect(industry.availableCivs).toBe(1)
  })
})

describe('placing focus builds in states', () => {
  // State 1 (city) has 2 free slots, state 2 (rural) has none.
  const place = (batches: ConstructionBatch[]) =>
    industryAt(production, country({ construction: batches }), [])
  const one = (extra: Partial<ConstructionBatch>) =>
    batch({ random: true, buildings: [bld('arms_factory', 1, true)], ...extra })

  it('takes the first preferred state that fits', () => {
    const industry = place([one({ prefer: [2, 1] })])
    expect(industry.states[0]).toMatchObject({ mil: 4, used: 5 })
    expect(industry.states[0].fromFocuses).toEqual([
      { focusName: 'F', text: '+1 arms_factory', guessed: false },
    ])
    expect(industry.states[1].fromFocuses).toEqual([])
  })

  it('falls back to the fitting state with most free slots and marks it guessed', () => {
    const industry = place([one({ prefer: [2] })])
    expect(industry.states[0].mil).toBe(4)
    expect(industry.states[0].fromFocuses[0].guessed).toBe(true)
  })

  it('uses the state with most free slots when nothing fits', () => {
    const industry = place([one({ buildings: [bld('arms_factory', 5, true)], prefer: [2] })])
    expect(industry.states[0]).toMatchObject({ mil: 8 })
    expect(industry.states[0].fromFocuses[0].guessed).toBe(true)
  })

  it('sees earlier builds as using the slots', () => {
    const industry = place([
      one({ buildings: [bld('arms_factory', 2, true)], prefer: [1] }),
      one({ prefer: [1] }),
    ])
    expect(industry.states[0].mil).toBe(6)
    expect(industry.states[0].fromFocuses.map((f) => f.guessed)).toEqual([false, true])
    // Not preferred any more: it goes to the state with most free slots, state 1 again (-1 vs -2).
    expect(industry.states[1].mil).toBe(0)
  })

  it('lets the extra slots of the batch make a state fit', () => {
    const industry = place([
      one({ buildings: [bld('arms_factory', 3, true)], slots: 1, prefer: [1] }),
    ])
    expect(industry.states[0]).toMatchObject({ mil: 6, slots: 7, used: 7 })
    expect(industry.states[0].fromFocuses[0]).toMatchObject({
      text: '+3 arms_factory, +1 slots',
      guessed: false,
    })
  })

  it('puts a numbered scope in its state, with resources, and leaves unowned ones unplaced', () => {
    const industry = place([
      batch({
        state: 2,
        buildings: [bld('arms_factory', 1, true)],
        resources: [{ type: 'oil', name: 'Oil', amount: 3 }],
      }),
      batch({ state: 99, slots: 2, buildings: [bld('arms_factory', 1, true)] }),
    ])
    expect(industry.states[1]).toMatchObject({ mil: 1, resources: { oil: 3 } })
    expect(industry.unplaced).toHaveLength(1)
    expect(industry.slots.total).toBe(11)
  })

  it('lists queued builds with their state and does not count them as built', () => {
    const industry = place([
      one({ buildings: [bld('industrial_complex', 1, false), bld('infrastructure', 1, true)] }),
    ])
    expect(industry.states[0]).toMatchObject({ civ: 1, infrastructure: 4, used: 4 })
    expect(industry.queued).toEqual([
      expect.objectContaining({ type: 'industrial_complex', stateId: 1, guessed: true }),
    ])
  })
})

describe('consumerGoodsFor', () => {
  const defines = { minConsumerFactories: 1, minConsumerPercent: 0.1 }

  it('keeps the minimum number and share of civilian factories', () => {
    expect(consumerGoodsFor(5, 5, 0, 0, defines).factories).toBe(1)
    expect(consumerGoodsFor(30, 0, 0, 0, defines).factories).toBe(3)
  })

  it('never takes more than the civilian factories', () => {
    expect(consumerGoodsFor(2, 20, 0.5, 0, defines).factories).toBe(2)
    expect(consumerGoodsFor(0, 3, 0.5, 0, defines).factories).toBe(0)
  })
})
