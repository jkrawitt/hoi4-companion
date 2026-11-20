/**
 * What a focus that is not in the plan would do if it were taken next: its reward with the
 * branches marked as they would be on completion, after the prerequisites it needs first.
 */
import type { EffectLine, Focus } from '../focus'
import { schedulePlan } from '../plan/focusPlan'
import type { PlanOptions } from '../plan/types'
import { pathTo } from '../plan/focusSelection'
import { countryStateAt } from './countryState'
import type { CountryStateOptions } from './types'

export interface FocusPreviewInput {
  plan: string[]
  focuses: Record<string, Focus>
  /** The start date and speed bonus the real schedule uses. */
  scheduleOptions: PlanOptions
  /** The options the overview's state uses, with `hasTech` and the purchases. */
  stateOptions: CountryStateOptions
}

/**
 * The reward of `focusId` marked for the plan with it (and the prerequisites it needs) appended,
 * and the prerequisites added before it; `undefined` when exclusivity blocks it. This does not run
 * the research or political power planning again: it uses the answers the current campaign gave
 * (`hasTech`, the purchases), so a condition on a technology is as the current plan has it.
 */
export const previewFocusEffects = (
  focusId: string,
  { plan, focuses, scheduleOptions, stateOptions }: FocusPreviewInput,
): { effects: EffectLine[]; added: string[] } | undefined => {
  const path = pathTo(focusId, plan, focuses)
  if (path === null) return undefined
  const schedule = schedulePlan([...plan, ...path], focuses, scheduleOptions)
  const state = countryStateAt(schedule, schedule.finish, stateOptions)
  const effects = state.focusEffects[focusId]
  if (!effects) return undefined
  return { effects, added: path.filter((id) => id !== focusId) }
}
