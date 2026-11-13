import type { EffectLine } from '../focus'
import type { StatDefinition } from '../stats'
import type { ActiveIdea, RuleValue, StatTotal } from './types'

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

/**
 * What the national spirits and the leader's traits add up to: the summed numeric modifiers and
 * the yes/no rules. A trait changes the country like a spirit does.
 */
export const activeModifiers = (ideas: ActiveIdea[], traits: EffectLine[]) => {
  const totals = new Map<string, StatTotal>()
  const rules = new Map<string, RuleValue>()
  for (const idea of ideas) {
    for (const m of idea.modifiers) {
      if (!m.key || !m.stat || m.value === undefined) continue
      if (m.isRule) rules.set(m.key, { key: m.key, stat: m.stat, value: m.value })
      else if (isNumeric(m.value)) addTo(totals, m.key, m.stat, Number(m.value))
    }
  }
  for (const m of traits) {
    if (m.isModifier && !m.isRule && m.key && m.stat && isNumeric(m.value)) {
      addTo(totals, m.key, m.stat, Number(m.value))
    }
  }
  return { totals, rules }
}
