/**
 * The factory picture of the country on a date: what the states start with, plus what the focus
 * plan builds instantly, the building slots (state category, the `global_building_slots_factor`
 * of ideas and technologies, extra slots from focuses) and how many civilian factories the
 * consumer goods take. Pure: the store feeds it the production data, the country state and the
 * technology totals.
 *
 * Which state a focus builds in is picked by the game for `random_owned_*state` blocks. The
 * construction batches of the plan are placed into the states in order: a numbered scope in its
 * state, a random block in the first preferred state it fits, else a guess (`placeBatches`).
 * What cannot be placed is listed in `unplaced` and still counted country-wide.
 */
import { humanize } from '../focusEffects'
import { consumerGoodsFor, type ConsumerGoods } from '../production'
import type { BuiltLevel, ProductionData } from '../production'
import type { ConstructionBatch, CountryState, StatTotal } from './types'

export { consumerGoodsFor }
export type { ConsumerGoods }

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
  /** What the focus plan placed here. `guessed`: the game picks the state, this is a guess. */
  fromFocuses: { focusName: string; text: string; guessed: boolean }[]
}

/** A queued (not instant) focus build, with the state it was placed in when there is one. */
export interface QueuedBuild {
  type: string
  name: string
  level: number
  focusName: string
  stateId?: number
  stateName?: string
  guessed: boolean
}

/** A batch that fits no state; still counted country-wide. */
export interface UnplacedBatch {
  focusName: string
  text: string
}

export interface Industry {
  /** Civilian, military and naval factories first, then any other building that shares slots. */
  factories: FactoryCount[]
  /** Focus builds that are queued in the game rather than instant; not counted above. */
  queued: QueuedBuild[]
  slots: { total: number; used: number; free: number }
  /** The states with what the focus plan placed in them. */
  states: StateRow[]
  /** Batches of the plan that fit no state (an unowned numbered scope, or no states at all). */
  unplaced: UnplacedBatch[]
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

const noteOf = (batch: ConstructionBatch): string =>
  [
    ...batch.buildings.map((b) =>
      b.instant ? `+${b.level} ${b.name}` : `${b.level} ${b.name} queued`,
    ),
    ...(batch.slots > 0 ? [`+${batch.slots} slots`] : []),
    ...batch.resources.map((r) => `${r.amount > 0 ? '+' : ''}${r.amount} ${r.name}`),
  ].join(', ')

/**
 * Puts the batches into the states, in order. A numbered scope goes to its state (unplaced when
 * the country does not own it). A random block takes the first preferred state it fits, else the
 * fitting state with most free slots (lowest id on ties), else the state with most free slots,
 * the last two marked guessed. A state fits when its free shared slots, after the batch's extra
 * slots, hold the batch's shared-slot buildings (instant and queued; infrastructure always fits).
 * The slots are those of the viewed date; the game decides with the slots of the completion date,
 * which can differ. Only instant builds count as built in a row; queued ones are listed.
 */
export const placeBatches = (
  rows: StateRow[],
  batches: ConstructionBatch[],
  shared: Set<string>,
) => {
  // Slots taken by queued builds, so later batches see them as occupied.
  const reserved = new Map<number, number>()
  const free = (r: StateRow) => r.slots - r.used - (reserved.get(r.id) ?? 0)
  const queued: QueuedBuild[] = []
  const unplaced: UnplacedBatch[] = []
  /** The state each batch went to (none when it fits no state), in the order of `batches`. */
  const placements: { batch: ConstructionBatch; stateId?: number; guessed: boolean }[] = []
  let unplacedSlots = 0

  for (const batch of batches) {
    const need = batch.buildings.reduce((n, b) => n + (shared.has(b.type) ? b.level : 0), 0)
    let row: StateRow | undefined
    let guessed = false
    if (batch.state !== undefined) {
      row = rows.find((r) => r.id === batch.state)
    } else if (batch.random && rows.length > 0) {
      const fits = rows.filter((r) => free(r) + batch.slots >= need)
      row = batch.prefer?.map((id) => fits.find((r) => r.id === id)).find((r) => r !== undefined)
      if (!row) {
        guessed = true
        const pool = fits.length > 0 ? fits : rows
        row = pool.reduce((best, r) => (free(r) > free(best) ? r : best))
      }
    }
    placements.push({ batch, stateId: row?.id, guessed })
    if (!row) {
      const text = noteOf(batch)
      if (text) unplaced.push({ focusName: batch.focusName, text })
      unplacedSlots += batch.slots
      for (const b of batch.buildings) {
        if (!b.instant) queued.push({ ...b, focusName: batch.focusName, guessed: false })
      }
      continue
    }
    row.slots += batch.slots
    for (const b of batch.buildings) {
      if (!b.instant) {
        reserved.set(row.id, (reserved.get(row.id) ?? 0) + (shared.has(b.type) ? b.level : 0))
        queued.push({
          ...b,
          focusName: batch.focusName,
          stateId: row.id,
          stateName: row.name,
          guessed,
        })
        continue
      }
      if (shared.has(b.type)) row.used += b.level
      if (b.type === CIVILIAN) row.civ += b.level
      else if (b.type === MILITARY) row.mil += b.level
      else if (b.type === NAVAL) row.dock += b.level
      else if (b.type === 'infrastructure') row.infrastructure += b.level
    }
    for (const r of batch.resources) {
      row.resources[r.type] = (row.resources[r.type] ?? 0) + r.amount
    }
    const text = noteOf(batch)
    if (text) row.fromFocuses.push({ focusName: batch.focusName, text, guessed })
  }
  return { queued, unplaced, unplacedSlots, placements }
}

/** The states as they start the game, with the slots the slot factor gives them. */
export const startingRows = (
  production: ProductionData,
  shared: Set<string>,
  slotFactor: number,
): StateRow[] =>
  production.states.map((s): StateRow => {
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
      resources: { ...s.resources },
      fromFocuses: [],
    }
  })

export const sharedBuildings = (production: ProductionData) =>
  new Set([CIVILIAN, MILITARY, NAVAL, ...production.sharedSlotBuildings])

export const industryAt = (
  production: ProductionData,
  state: CountryState,
  techTotals: StatTotal[],
  /** The levels the construction queue finished; those by the state's date count as built. */
  built: BuiltLevel[] = [],
): Industry => {
  const shared = sharedBuildings(production)
  const slotFactor =
    totalOf(state.modifierTotals, 'global_building_slots_factor') +
    totalOf(techTotals, 'global_building_slots_factor')

  const states = startingRows(production, shared, slotFactor)

  const { queued, unplaced, unplacedSlots } = placeBatches(states, state.construction, shared)
  const done = built.filter((b) => b.date <= state.date)
  for (const b of done) {
    const row = states.find((r) => r.id === b.state)
    if (!row) continue
    if (shared.has(b.building)) row.used++
    if (b.building === CIVILIAN) row.civ++
    else if (b.building === MILITARY) row.mil++
    else if (b.building === NAVAL) row.dock++
    else if (b.building === 'infrastructure') row.infrastructure++
  }

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
  for (const b of done) {
    add(b.building, 1, production.buildings.find((d) => d.id === b.building)?.name)
  }

  const count = (type: string) => counts.get(type)?.count ?? 0
  const used = [...counts.values()].reduce((sum, f) => sum + f.count, 0)
  const total = states.reduce((sum, s) => sum + s.slots, 0) + unplacedSlots
  const consumerGoods = consumerGoodsFor(
    count(CIVILIAN),
    totalOf(state.modifierTotals, 'consumer_goods_expected_value'),
    totalOf(state.modifierTotals, 'consumer_goods_factor') +
      totalOf(techTotals, 'consumer_goods_factor'),
    production.defines,
  )
  return {
    factories: [...counts.values()],
    queued,
    slots: { total, used, free: total - used },
    states,
    unplaced,
    consumerGoods,
    availableCivs: count(CIVILIAN) - consumerGoods.factories,
  }
}
