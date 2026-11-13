import type { Focus } from '../focus'

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
