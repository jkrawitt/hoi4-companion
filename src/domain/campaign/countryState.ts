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
import { DEFAULT_POLITICS_DEFINES } from '../politics'
import { activeModifiers, countryStat } from './totals'
import { researchEnvironment } from './researchEvents'
import type { ActiveIdea, CountryState, CountryStateOptions } from './types'

export type {
  ActiveIdea,
  BuildingTotal,
  ConditionalEffects,
  CountryLeader,
  CountryPolitics,
  CountryState,
  CountryStateOptions,
  PopularityChange,
  ResourceTotal,
  RuleValue,
  StatTotal,
} from './types'

/** The ideas that fill a politics slot, by slot. */
const heldBySlot = (ideas: ActiveIdea[]): Record<string, ActiveIdea[]> => {
  const held: Record<string, ActiveIdea[]> = {}
  for (const idea of ideas) if (idea.slot) (held[idea.slot] ??= []).push(idea)
  return held
}

export const countryStateAt = (
  schedule: FocusSchedule,
  date: Date,
  options: CountryStateOptions = {},
): CountryState => {
  const completed = schedule.items.filter((item) => item.end <= date)
  const next = schedule.items.find((item) => item.end > date)
  // The starting state goes first, as if it were a reward finished on the start date.
  const startStep: Step[] = options.start?.length
    ? [
        {
          focus: { id: START_ID, name: 'Game start', effects: options.start },
          end: options.startDate ?? date,
        },
      ]
    : []
  // Purchases come in between the focuses by date; a focus goes first on the same day.
  const merged = [
    ...completed.map((step, index) => ({ step, rank: 0, index })),
    ...(options.extraSteps ?? [])
      .filter((step) => step.end <= date)
      .map((step, index) => ({ step, rank: 1, index })),
  ].sort(
    (a, b) => a.step.end.getTime() - b.step.end.getTime() || a.rank - b.rank || a.index - b.index,
  )
  const steps: Step[] = [...startStep, ...merged.map((m) => m.step)]

  const w = newWorking()
  for (const option of options.politics?.options ?? []) {
    if (option.recruited && option.character) w.recruited.add(option.character)
  }
  for (const step of steps) applyReward(w, step, options)

  const active = [...w.ideas.values()].filter((idea) => !idea.until || idea.until > date)

  const { totals: modifierTotals, rules } = activeModifiers(active, w.leader?.traits ?? [])
  const actual = (key: 'stability' | 'war_support') =>
    options.start?.length
      ? countryStat(
          key,
          options.start,
          w.statChanges.get(`add_${key}`)?.total ?? 0,
          (k) => modifierTotals.get(k)?.total ?? 0,
          w.government ? (w.popularity.get(w.government)?.total ?? 0) : 0,
          (options.politics?.defines ?? DEFAULT_POLITICS_DEFINES).partyStability,
        )
      : undefined

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
    government: w.government,
    stability: actual('stability'),
    warSupport: actual('war_support'),
    leader: w.leader,
    resources: [...w.resources.values()],
    buildings: [...w.buildings.values()],
    buildingSlots: w.buildingSlots,
    construction: w.construction,
    conditional: w.conditional,
    snapshots: w.research.snapshots,
    politics: {
      held: heldBySlot(active),
      recruited: [...w.recruited],
    },
    research: researchEnvironment(w.research),
  }
}
