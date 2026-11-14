import { describe, expect, it } from 'vitest'
import { consumerGoodsFor, industryAt } from '../campaign/industry'
import type { BuildingTotal, CountryState, StatTotal } from '../campaign/types'
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

const country = (extra: Partial<CountryState> = {}): CountryState =>
  ({
    modifierTotals: [],
    buildings: [],
    buildingSlots: 0,
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
      }),
      [],
    )
    expect(industry.factories.find((f) => f.type === 'arms_factory')?.count).toBe(5)
    expect(industry.factories.find((f) => f.type === 'industrial_complex')?.count).toBe(5)
    expect(industry.queued.map((b) => b.type)).toEqual(['industrial_complex'])
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
