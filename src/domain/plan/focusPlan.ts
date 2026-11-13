import type { Focus } from '../focus'
import type { FocusSchedule, PlanIssue, PlanOptions, ScheduledFocus } from './types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

export const addDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * MS_PER_DAY)

/** Real duration of a focus after the speed bonus is applied (HoI4 divides by 1 + bonus). */
export const focusDurationDays = (focus: Focus, speedBonus: number): number =>
  focus.days / (1 + speedBonus)

/**
 * Schedules an ordered list of focus ids back to back, one at a time, and reports
 * any rule violations (prerequisites, exclusivity, duplicates). Invalid focuses are
 * still scheduled so the user can see the problem in context.
 */
export const schedulePlan = (
  plan: string[],
  focuses: Record<string, Focus>,
  options: PlanOptions,
): FocusSchedule => {
  const items: ScheduledFocus[] = []
  const completed = new Set<string>()
  let cursor = options.startDate

  for (const id of plan) {
    const focus = focuses[id]
    if (!focus) continue

    const issues: PlanIssue[] = []
    if (completed.has(id)) issues.push({ kind: 'duplicate', focusId: id })

    for (const group of focus.prerequisites) {
      if (!group.some((p) => completed.has(p))) {
        issues.push({ kind: 'missing-prerequisite', focusId: id, oneOf: group })
      }
    }

    for (const other of focus.mutuallyExclusive) {
      if (completed.has(other)) {
        issues.push({ kind: 'mutually-exclusive', focusId: id, conflictsWith: other })
      }
    }

    const durationDays = focusDurationDays(focus, options.speedBonus)
    const end = addDays(cursor, durationDays)
    items.push({ focus, start: cursor, end, durationDays, issues })
    completed.add(id)
    cursor = end
  }

  const totalDays = (cursor.getTime() - options.startDate.getTime()) / MS_PER_DAY
  return { items, finish: cursor, totalDays }
}
