import type { StatDefinition } from '../stats'
import type { StatTotal } from './types'

export const round = (n: number) => Number(n.toFixed(6))

/** Adds `amount` to the total for `key`, keeping the order keys first appeared in. */
export const addTo = (
  totals: Map<string, StatTotal>,
  key: string,
  stat: StatDefinition,
  amount: number,
) => {
  const existing = totals.get(key)
  if (existing) existing.total = round(existing.total + amount)
  else totals.set(key, { key, stat, total: round(amount) })
}

export const isNumeric = (value: string | undefined): value is string =>
  value !== undefined && value !== '' && Number.isFinite(Number(value))
