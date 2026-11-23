/**
 * Shared types of a country's balance of power (`common/bop/<TAG>.txt`): a value between -1 and 1
 * whose range gives the country modifiers. Finland's is its public trust. Read by
 * `parsers/balanceOfPower.ts`, moved by `campaign/applyReward.ts`.
 *
 * The weekly drift is modelled (`BopWeeklyRule`: the weekly script of the country adds modifiers
 * with a `power_balance_weekly` while the ruling leader and the parties' popularity say so).
 * Not modelled: what each range does besides its modifiers (swapping spirits, unlocking
 * decisions), and the weekly rules about losing cores (they need the map).
 */
import type { Check, EffectLine } from './focus'

/**
 * One way the balance drifts a week: while `leader` rules and `when` holds (always, when it is
 * missing), `modifier` is on the balance, moving it by `weekly` every week. Read from the country's
 * `on_weekly_<TAG>` on action (`parsers/balanceOfPowerWeekly.ts`).
 */
export interface BopWeeklyRule {
  /** The character whose rule this is (`FIN_pehr_evind_svinhufvud`). */
  leader: string
  /** The modifier's id (`FIN_bop_modifier_concerning_support_for_socialists`). */
  modifier: string
  /** What it adds to the balance each week (negative for the bad ones). */
  weekly: number
  /** The condition the weekly script checks before adding it. */
  when?: Check
}

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
  /** The weekly drift rules; none when the country has no weekly script. */
  weekly?: BopWeeklyRule[]
}

/** The range holding `value`; where two meet, the narrower (the middle one) wins. */
export const rangeAt = (bop: BalanceOfPower, value: number): BopRange | undefined =>
  bop.ranges
    .filter((r) => value >= r.min - 1e-9 && value <= r.max + 1e-9)
    .sort((a, b) => a.max - a.min - (b.max - b.min))[0]

export const clampBalance = (value: number): number =>
  Math.round(Math.min(1, Math.max(-1, value)) * 1e6) / 1e6
