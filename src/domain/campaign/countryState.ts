/**
 * What the plan has done to a country by a given date: the part of the app that turns the focus
 * plan (and, later, other planners) into one picture.
 *
 * A completed focus's reward counts as applied when it sits at the top level or inside a
 * `hidden_effect` (which still happens). Rewards inside `if`/`else`/`random_*` blocks may or may not
 * happen, so they are only listed (`conditional`). Rewards inside another country's scope or a
 * state scope change something other than this country and are skipped.
 *
 * This file only runs the rewards in order and totals the result. `applyReward.ts` is what one
 * reward does, `rewardScopes.ts` sorts its lines, and `types.ts` has the shapes.
 */
import { START_ID } from '../focus'
import type { FocusSchedule } from '../plan/types'
import { applyReward, newWorking } from './applyReward'
import type { Step } from './applyReward'
import { activeModifiers } from './totals'
import { researchEnvironment } from './researchEvents'
import type { CountryState, CountryStateOptions } from './types'

export type {
  ActiveIdea,
  BuildingTotal,
  ConditionalEffects,
  CountryLeader,
  CountryState,
  CountryStateOptions,
  PopularityChange,
  ResourceTotal,
  RuleValue,
  StatTotal,
} from './types'

export const countryStateAt = (
  schedule: FocusSchedule,
  date: Date,
  options: CountryStateOptions = {},
): CountryState => {
  const completed = schedule.items.filter((item) => item.end <= date)
  const next = schedule.items.find((item) => item.end > date)
  // The starting state goes first, as if it were a reward finished on the start date.
  const steps: Step[] = [
    ...(options.start?.length
      ? [
          {
            focus: { id: START_ID, name: 'Game start', effects: options.start },
            end: options.startDate ?? date,
          },
        ]
      : []),
    ...completed,
  ]

  const w = newWorking()
  for (const step of steps) applyReward(w, step, options)

  const active = [...w.ideas.values()].filter((idea) => !idea.until || idea.until > date)

  const { totals: modifierTotals, rules } = activeModifiers(active, w.leader?.traits ?? [])

  return {
    date,
    completed,
    next,
    ideas: active,
    statChanges: [...w.statChanges.values()],
    modifierTotals: [...modifierTotals.values()],
    rules: [...rules.values()],
    popularity: [...w.popularity.values()],
    rulingParty: w.rulingParty,
    leader: w.leader,
    resources: [...w.resources.values()],
    buildings: [...w.buildings.values()],
    buildingSlots: w.buildingSlots,
    conditional: w.conditional,
    research: researchEnvironment(w.research),
  }
}
