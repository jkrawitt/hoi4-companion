/**
 * The factory picture of the country on a date: what the states start with, plus what the focus
 * plan builds instantly, the building slots (state category, the `global_building_slots_factor`
 * of ideas and technologies, extra slots from focuses) and how many civilian factories the
 * consumer goods take. Pure: the store feeds it the production data, the country state and the
 * technology totals.
 *
 * Which state a focus builds in is picked by the game (`random_owned_controlled_state`), so what
 * focuses build is counted for the whole country and listed apart from the states.
 */
import { humanize } from '../focusEffects'
import type { ProductionData, ProductionDefines } from '../production'
import type { BuildingTotal, CountryState, StatTotal } from './types'

export interface FactoryCount {
  type: string
  name: string
  count: number
}

export interface StateRow {
  id: number
  name: string
  category: string
  slots: number
  used: number
  infrastructure: number
  civ: number
  mil: number
  dock: number
  resources: Record<string, number>
}

export interface ConsumerGoods {
  /** The share of the factories the country wants on consumer goods, 0.35 for 35%. */
  percent: number
  factories: number
}

export interface Industry {
  /** Civilian, military and naval factories first, then any other building that shares slots. */
  factories: FactoryCount[]
  /** Focus builds that are queued in the game rather than instant; not counted above. */
  queued: BuildingTotal[]
  slots: { total: number; used: number; free: number }
  /** The slots and buildings of each state at the start; focus builds are not placed in them. */
  states: StateRow[]
  /** What the focus plan builds instantly and the slots it adds, not placed in a state. */
  focusSlots: number
  /** Civilian, military and naval factories the focus plan built instantly, not placed in a state. */
  focusBuilt: { civ: number; mil: number; dock: number }
  consumerGoods: ConsumerGoods
  /** Civilian factories left once the consumer goods are paid. */
  availableCivs: number
}

const CIVILIAN = 'industrial_complex'
const MILITARY = 'arms_factory'
const NAVAL = 'dockyard'
const FACTORY_NAMES: Record<string, string> = {
  [CIVILIAN]: 'Civilian factories',
  [MILITARY]: 'Military factories',
  [NAVAL]: 'Naval dockyards',
}

const totalOf = (totals: StatTotal[], key: string) => totals.find((t) => t.key === key)?.total ?? 0

/**
 * The civilian factories the consumer goods take. NOT VERIFIED AGAINST THE GAME: this is the
 * share wanted (`consumer_goods_expected_value`, raised by `consumer_goods_factor`) of all the
 * civilian and military factories, rounded up, but at least the defines' minimum (a number and a
 * share of the civilian factories), and never more than the civilian factories there are. This is
 * the one place to fix once it is compared with the production screen.
 */
export const consumerGoodsFor = (
  civ: number,
  mil: number,
  expectedValue: number,
  factor: number,
  defines: ProductionDefines,
): ConsumerGoods => {
  const percent = expectedValue * (1 + factor)
  const wanted = Math.max(
    Math.ceil(percent * (civ + mil)),
    defines.minConsumerFactories,
    Math.ceil(defines.minConsumerPercent * civ),
  )
  return { percent, factories: Math.min(wanted, civ) }
}

export const industryAt = (
  production: ProductionData,
  state: CountryState,
  techTotals: StatTotal[],
): Industry => {
  const shared = new Set([CIVILIAN, MILITARY, NAVAL, ...production.sharedSlotBuildings])
  const slotFactor =
    totalOf(state.modifierTotals, 'global_building_slots_factor') +
    totalOf(techTotals, 'global_building_slots_factor')

  const states = production.states.map((s): StateRow => {
    const used = Object.entries(s.buildings).reduce(
      (sum, [type, n]) => sum + (shared.has(type) ? n : 0),
      0,
    )
    return {
      id: s.id,
      name: s.name,
      category: s.category,
      slots: Math.floor((production.categorySlots[s.category] ?? 0) * (1 + slotFactor)),
      used,
      infrastructure: s.buildings.infrastructure ?? 0,
      civ: s.buildings[CIVILIAN] ?? 0,
      mil: s.buildings[MILITARY] ?? 0,
      dock: s.buildings[NAVAL] ?? 0,
      resources: s.resources,
    }
  })

  const counts = new Map<string, FactoryCount>(
    [CIVILIAN, MILITARY, NAVAL].map((type) => [
      type,
      { type, name: FACTORY_NAMES[type], count: 0 },
    ]),
  )
  const add = (type: string, count: number, name?: string) => {
    if (!shared.has(type)) return
    const entry = counts.get(type) ?? { type, name: name ?? humanize(type), count: 0 }
    entry.count += count
    counts.set(type, entry)
  }
  for (const s of production.states) {
    for (const [type, n] of Object.entries(s.buildings)) add(type, n)
  }
  for (const b of state.buildings) if (b.instant) add(b.type, b.total, b.name)

  const count = (type: string) => counts.get(type)?.count ?? 0
  const instant = (type: string) =>
    state.buildings.filter((b) => b.instant && b.type === type).reduce((n, b) => n + b.total, 0)
  const used = [...counts.values()].reduce((sum, f) => sum + f.count, 0)
  const total = states.reduce((sum, s) => sum + s.slots, 0) + state.buildingSlots
  const consumerGoods = consumerGoodsFor(
    count(CIVILIAN),
    count(MILITARY),
    totalOf(state.modifierTotals, 'consumer_goods_expected_value'),
    totalOf(state.modifierTotals, 'consumer_goods_factor') +
      totalOf(techTotals, 'consumer_goods_factor'),
    production.defines,
  )
  return {
    factories: [...counts.values()],
    queued: state.buildings.filter((b) => !b.instant),
    slots: { total, used, free: total - used },
    states,
    focusSlots: state.buildingSlots,
    focusBuilt: { civ: instant(CIVILIAN), mil: instant(MILITARY), dock: instant(NAVAL) },
    consumerGoods,
    availableCivs: count(CIVILIAN) - consumerGoods.factories,
  }
}
