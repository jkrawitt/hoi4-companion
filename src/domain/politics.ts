/**
 * The shared shapes of political power: what the importer reads out of the game (`PoliticsData`:
 * laws, designers and advisors, each as a `PoliticalOption`) and what the planner takes (the queue
 * of `PoliticsItem`s). `plan/politicsPlan.ts` depends on nothing but this file.
 */
import type { Check, EffectLine } from './focus'

/** The four sections of the game's politics screen. */
export type PoliticsGroup = 'laws' | 'government' | 'research_production' | 'military_staff'

export const POLITICS_GROUPS: { id: PoliticsGroup; name: string }[] = [
  { id: 'laws', name: 'Laws' },
  { id: 'government', name: 'Government' },
  { id: 'research_production', name: 'Research & production' },
  { id: 'military_staff', name: 'Military staff' },
]

/** One thing political power can buy: a law, a designer or industrial concern, or an advisor. */
export interface PoliticalOption {
  /** The idea id; for an advisor its `idea_token`, which is the character's id in practice. */
  id: string
  name: string
  kind: 'law' | 'designer' | 'advisor'
  /** The slot it fills: economy, trade_laws, political_advisor, theorist, tank_manufacturer, ... */
  slot: string
  group: PoliticsGroup
  /** Base cost in political power, before the cost factors. */
  cost: number
  ledger?: 'army' | 'navy' | 'air'
  /** A law the country starts with when the history sets none for the slot. */
  default?: boolean
  /**
   * Mobilization laws: the law's rank (`level`). Changing law costs `cost` for every rank moved
   * (checked in game: one rank 150, two 300); laws without one cost `cost` flat.
   */
  level?: number
  /** Advisors: the character the idea belongs to, who must be recruited to be hired. */
  character?: string
  /** Advisors: whether the history recruits the character at the start. */
  recruited?: boolean
  /** The `available` block as a condition the campaign can answer; absent when there is none. */
  available?: Check
  /** The `available` block in English, when it is simple enough to write out. */
  availableText?: string
  /** Law and designer `modifier` and `rule` lines, or an advisor's `leader_trait` lines with stats. */
  modifiers: EffectLine[]
  /** `research_bonus` of a designer: extra research speed per technology category. */
  researchBonus?: Record<string, number>
}

export interface PoliticsData {
  options: PoliticalOption[]
  /** How many ideas each slot holds: 3 political advisors and high command, 1 of the others. */
  slots: Record<string, number>
  /** Localised names of the technology categories in the options' `researchBonus`. */
  categoryNames: Record<string, string>
  defines: PoliticsDefines
}

/** The political power numbers the game keeps in its defines. */
export interface PoliticsDefines {
  /** Political power gained a day before any modifier. */
  baseGain: number
  /** Political power never goes above this. */
  cap: number
  /** Stability gained per point of ruling party popularity (`BASE_STABILITY_PARTY_POPULARITY_FACTOR`). */
  partyStability: number
  /**
   * `political_power_factor` of `stability_good_modifier` (at 100% stability) and
   * `stability_bad_modifier` (at 0%), scaled linearly from 50% stability.
   */
  stabilityGood: number
  stabilityBad: number
  /** `political_power_cost` of `gain_focus`: what running a national focus costs a day. */
  focusCost: number
}

export const DEFAULT_POLITICS_DEFINES: PoliticsDefines = {
  baseGain: 2,
  cap: 2000,
  partyStability: 0.15,
  stabilityGood: 0.1,
  stabilityBad: -0.2,
  focusCost: 1,
}

export const emptyPolitics = (): PoliticsData => ({
  options: [],
  slots: {},
  categoryNames: {},
  defines: DEFAULT_POLITICS_DEFINES,
})

/** An entry of the purchase queue: buy an option, or dismiss it (an advisor, say) to free its slot. */
export interface PoliticsItem {
  optionId: string
  dismiss?: true
  /** The earliest day to buy it, `YYYY-MM-DD`. */
  notBefore?: string
}

/** The slot a character advisor and a designer fill, as the group of the politics screen. */
export const groupOfSlot = (slot: string, lawSlots: Set<string>): PoliticsGroup => {
  if (lawSlots.has(slot)) return 'laws'
  if (slot === 'political_advisor') return 'government'
  if (['army_chief', 'navy_chief', 'air_chief', 'high_command'].includes(slot)) {
    return 'military_staff'
  }
  return 'research_production'
}

export type PurchaseIssue =
  /** Already in the slot when its turn came, so nothing is bought. */
  | { kind: 'already-held' }
  /** Its `available` block asks about something the campaign cannot answer, so it is allowed. */
  | { kind: 'availability-unknown' }

export interface ScheduledPurchase {
  /** Position in the queue. */
  index: number
  optionId: string
  /** A dismissal, not a purchase. */
  dismiss: boolean
  date: Date
  /** What it cost, after the cost factors in force that day. */
  cost: number
  /** The political power left after it. */
  balanceAfter: number
  issues: PurchaseIssue[]
}

export type UnscheduledPurchaseReason =
  | 'unknown-option'
  | 'not-held'
  | 'slots-full'
  | 'is-leader'
  /** The character is never recruited (in the time looked at). */
  | 'not-recruited'
  /** Its `available` block never holds. */
  | 'unavailable'
  /** The political power gain is not enough, ever. */
  | 'unaffordable'
  | 'out-of-time'

export interface UnscheduledPurchase {
  index: number
  optionId: string
  reason: UnscheduledPurchaseReason
}

export interface PoliticsSchedule {
  items: ScheduledPurchase[]
  unscheduled: UnscheduledPurchase[]
  /** The political power on a date, and the daily gain in force on it. */
  balanceAt: (date: Date) => number
  gainAt: (date: Date) => number
}
