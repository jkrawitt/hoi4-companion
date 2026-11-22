/**
 * Shared types of a country's balance of power (`common/bop/<TAG>.txt`): a value between -1 and 1
 * whose range gives the country modifiers. Finland's is its public trust. Read by
 * `parsers/balanceOfPower.ts`, moved by `campaign/applyReward.ts`.
 *
 * Not modelled: the weekly drift of `power_balance_weekly` modifiers (`add_power_balance_modifier`),
 * and what each range does besides its modifiers (swapping spirits, unlocking decisions).
 */
import type { EffectLine } from './focus'

export interface BopRange {
  id: string
  name: string
  min: number
  max: number
  /** The modifiers the range gives, at depth 0 with their stat definitions. */
  modifiers: EffectLine[]
}

export interface BalanceOfPower {
  /** The id effects name (`FIN_power_balance`). */
  id: string
  name: string
  /** The value when a script sets the balance to its default. */
  initial: number
  ranges: BopRange[]
}

/** The range holding `value`; where two meet, the narrower (the middle one) wins. */
export const rangeAt = (bop: BalanceOfPower, value: number): BopRange | undefined =>
  bop.ranges
    .filter((r) => value >= r.min - 1e-9 && value <= r.max + 1e-9)
    .sort((a, b) => a.max - a.min - (b.max - b.min))[0]

export const clampBalance = (value: number): number =>
  Math.round(Math.min(1, Math.max(-1, value)) * 1e6) / 1e6
