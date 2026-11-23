/**
 * Whether a focus can be taken when it would start: its `available` trigger, asked about the
 * country on that date (popularity, stability, government, focuses completed, ...). A term the
 * campaign cannot answer counts as available, like a political option's `available`.
 */
import type { Focus } from '../focus'
import { pathTo } from '../plan/focusSelection'
import { schedulePlan } from '../plan/focusPlan'
import type { PlanOptions } from '../plan/types'
import { evaluateCheck } from './conditions'
import { countryStateAt, simulateCountry } from './countryState'
import { countryConditions, factsOfState } from './countryConditions'
import type { CountryState, CountryStateOptions } from './types'

export interface AvailabilityInput {
  plan: string[]
  focuses: Record<string, Focus>
  scheduleOptions: PlanOptions
  stateOptions: CountryStateOptions
}

/** Whether `focus` is available in `state`: false only when its trigger is known not to hold. */
const availableIn = (focus: Focus, state: CountryState, options: CountryStateOptions) =>
  !focus.available ||
  evaluateCheck(focus.available, countryConditions(factsOfState(state), options)) !== false

/** The planned focuses whose `available` does not hold on the day they start. */
export const unavailableInPlan = ({
  plan,
  focuses,
  scheduleOptions,
  stateOptions,
}: AvailabilityInput): Set<string> => {
  const bad = new Set<string>()
  if (!plan.some((id) => focuses[id]?.available)) return bad
  const schedule = schedulePlan(plan, focuses, scheduleOptions)
  const sim = simulateCountry(schedule, stateOptions)
  for (const item of schedule.items) {
    if (!item.focus.available) continue
    // Only the focuses finished before this one started count, which is what the date gives.
    const state = sim.at(item.start)
    if (!availableIn(item.focus, state, stateOptions)) bad.add(item.focus.id)
  }
  return bad
}

/**
 * The focuses not in the plan that cannot be taken next: the focus or a prerequisite it needs
 * first would not be available on the day it starts. Those blocked by exclusivity are not
 * included (the selection already blocks them).
 */
export interface AvailabilityBlock {
  /** The focus (the one asked about or a prerequisite it needs) whose `available` fails... */
  focusId: string
  /** ...on this day, when it would start. */
  start: Date
}

export const blockedByAvailability = (input: AvailabilityInput): Map<string, AvailabilityBlock> => {
  const { plan, focuses, scheduleOptions, stateOptions } = input
  const blocked = new Map<string, AvailabilityBlock>()
  // Answers by the plan the focus follows, as prerequisites are shared between focuses.
  const answers = new Map<string, boolean>()
  for (const id of Object.keys(focuses)) {
    if (plan.includes(id)) continue
    const path = pathTo(id, plan, focuses)
    if (path === null || !path.some((p) => focuses[p].available)) continue
    const schedule = schedulePlan([...plan, ...path], focuses, scheduleOptions)
    const failed = path.findIndex((p, i) => {
      if (!focuses[p].available) return false
      const key = [...plan, ...path.slice(0, i + 1)].join(',')
      let ok = answers.get(key)
      if (ok === undefined) {
        const item = schedule.items[plan.length + i]
        ok = availableIn(
          item.focus,
          countryStateAt(schedule, item.start, stateOptions),
          stateOptions,
        )
        answers.set(key, ok)
      }
      return !ok
    })
    if (failed >= 0) {
      blocked.set(id, { focusId: path[failed], start: schedule.items[plan.length + failed].start })
    }
  }
  return blocked
}
