/**
 * What buying with political power costs and earns, and editing the purchase queue. It knows
 * nothing about game files or the campaign (`campaign/politics.ts` schedules the queue against
 * them): it works on the shared shapes of `politics.ts` and on the summed stat totals it is handed.
 *
 * The formulas follow the game's modifiers but are NOT verified against it:
 *
 *   gain a day = (base gain + political_power_gain) x (1 + political_power_factor)
 *                - political_power_cost
 *   cost       = base cost x ranks moved (mobilization laws) x (1 + <slot>_cost_factor
 *                + <ledger>_advisor_cost_factor), rounded
 *
 * A law or designer is swapped for the one in its slot; an advisor needs a free slot (dismiss
 * another first). There are no dependencies between purchases, so every order of the queue is valid.
 */
import type { PoliticalOption, PoliticsDefines, PoliticsItem } from '../politics'

/** Summed stat totals by key, as the country state's modifier totals give them. */
export type Totals = Record<string, number>

export const totalsOf = (list: { key: string; total: number }[]): Totals =>
  Object.fromEntries(list.map((t) => [t.key, t.total]))

/**
 * The `political_power_factor` stability gives: the good modifier's, scaled from nothing at 50%
 * to all of it at 100%, or the bad one's, scaled from 50% down to 0%. At 69% stability that is
 * +3.8%, which the game's tooltip shows as +3%.
 */
export const stabilityFactor = (stability: number, defines: PoliticsDefines): number =>
  stability > 0.5
    ? (defines.stabilityGood * (stability - 0.5)) / 0.5
    : (defines.stabilityBad * (0.5 - stability)) / 0.5

/**
 * The daily political power gain at the given modifier totals and stability (0 to 1). A national
 * focus is taken to be running all the time, so its cost is always paid.
 */
export const dailyGain = (totals: Totals, defines: PoliticsDefines, stability = 0.5): number =>
  (defines.baseGain + (totals.political_power_gain ?? 0)) *
    (1 + (totals.political_power_factor ?? 0) + stabilityFactor(stability, defines)) -
  (totals.political_power_cost ?? 0) -
  defines.focusCost

/**
 * What an option costs now: its base cost with the slot's (and an advisor's ledger's) factors. A
 * law with a rank costs its cost for every rank between it and `current`, the law it replaces.
 */
export const purchaseCost = (
  option: PoliticalOption,
  totals: Totals,
  current?: PoliticalOption,
): number => {
  const ranks =
    option.level !== undefined && current?.level !== undefined
      ? Math.max(1, Math.abs(option.level - current.level))
      : 1
  const factor =
    (totals[`${option.slot}_cost_factor`] ?? 0) +
    (option.kind === 'advisor' && option.ledger
      ? (totals[`${option.ledger}_advisor_cost_factor`] ?? 0)
      : 0)
  return Math.max(0, Math.round(option.cost * ranks * (1 + factor)))
}

/** The option a purchase replaces: what holds its slot now (`heldIds`), when it is one of `options`. */
export const replacedBy = (
  option: PoliticalOption,
  heldIds: string[],
  options: PoliticalOption[],
): PoliticalOption | undefined =>
  options.find((o) => o.slot === option.slot && o.id !== option.id && heldIds.includes(o.id))

/** Whether a slot has room for one more idea, given the ideas in it. */
export const slotHasRoom = (
  option: PoliticalOption,
  held: number,
  slots: Record<string, number>,
): boolean => held < (slots[option.slot] ?? 1)

// --- Editing the queue. ---

/** Appends a purchase or a dismissal, unless the queue already ends in the same one for it. */
export const addPurchase = (
  queue: PoliticsItem[],
  optionId: string,
  dismiss = false,
): PoliticsItem[] => {
  const last = [...queue].reverse().find((item) => item.optionId === optionId)
  if (last && Boolean(last.dismiss) === dismiss) return queue
  return [...queue, { optionId, ...(dismiss && { dismiss: true as const }) }]
}

export const removePurchase = (queue: PoliticsItem[], index: number): PoliticsItem[] =>
  queue.filter((_, i) => i !== index)

/** Moves an item up (-1) or down (1); out of range leaves the queue as it was. */
export const movePurchase = (queue: PoliticsItem[], index: number, by: -1 | 1): PoliticsItem[] => {
  const target = index + by
  if (index < 0 || index >= queue.length || target < 0 || target >= queue.length) return queue
  const moved = [...queue]
  ;[moved[index], moved[target]] = [moved[target], moved[index]]
  return moved
}

/** Sets or (with an empty date) clears the earliest day an item may be bought. */
export const setNotBefore = (
  queue: PoliticsItem[],
  index: number,
  notBefore: string | undefined,
): PoliticsItem[] =>
  queue.map((item, i) => {
    if (i !== index) return item
    return {
      optionId: item.optionId,
      ...(item.dismiss && { dismiss: true as const }),
      ...(notBefore && { notBefore }),
    }
  })

/**
 * Drops items for options that do not exist (the data changed), and the pointless ones. The queue
 * stays valid in every other order, so this is all that is needed after an import.
 */
export const knownPurchases = (queue: PoliticsItem[], options: PoliticalOption[]): PoliticsItem[] =>
  queue.filter((item) => options.some((o) => o.id === item.optionId))
