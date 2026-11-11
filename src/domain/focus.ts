/** HoI4 focus cost is in weeks; one week is 7 days. */
export const DAYS_PER_WEEK = 7

export interface Focus {
  id: string
  /** Display name; falls back to the id when no localisation was found. */
  name: string
  /** Base completion time in days, before any focus speed bonus. */
  days: number
  /**
   * Prerequisite groups. Every group must be satisfied (AND), and a group is satisfied when
   * at least one of its focuses is completed (OR). This mirrors HoI4, where each
   * `prerequisite = { focus = A focus = B }` block is an OR group.
   */
  prerequisites: string[][]
  /** Taking any of these makes this focus unavailable. */
  mutuallyExclusive: string[]
  /** Grid position from the game files; relative to `relativeTo` when that is set. */
  x: number
  y: number
  relativeTo?: string
}

export interface PlanOptions {
  /** Start of the first focus. */
  startDate: Date
  /** Focus completion speed bonus, e.g. 0.25 for +25%. */
  speedBonus: number
}

export type PlanIssue =
  | { kind: 'missing-prerequisite'; focusId: string; oneOf: string[] }
  | { kind: 'mutually-exclusive'; focusId: string; conflictsWith: string }
  | { kind: 'duplicate'; focusId: string }

export interface ScheduledFocus {
  focus: Focus
  start: Date
  end: Date
  durationDays: number
  issues: PlanIssue[]
}

export interface FocusSchedule {
  items: ScheduledFocus[]
  /** Completion date of the last focus, or the start date for an empty plan. */
  finish: Date
  totalDays: number
}
