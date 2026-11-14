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

/** `DEFAULT_STABILITY` and `DEFAULT_WAR_SUPPORT`: what a country has when its history sets none. */
const DEFAULT_STAT = 0.5

/**
 * The country's actual stability or war support (0 to 1), as the game works it out: the scripted
 * value (the start's `set_*`, or 50% when it has none, plus the changes since) plus `<key>_factor`
 * modifiers, and for stability the ruling party's popularity times `partyStability`. War
 * (`BASE_STABILITY_WAR_FACTOR`) is not modelled.
 */
export const countryStat = (
  key: 'stability' | 'war_support',
  start: EffectLine[],
  changes: number,
  modifiers: (key: string) => number,
  rulingPopularity: number,
  partyStability: number,
): number => {
  const set = start.some((l) => l.depth === 0 && l.key === `add_${key}`)
  const party = key === 'stability' ? rulingPopularity * partyStability : 0
  const value = (set ? 0 : DEFAULT_STAT) + changes + modifiers(`${key}_factor`) + party
  return Math.min(1, Math.max(0, round(value)))
}

export const isNumeric =(value: string | undefined): value is string =>
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
