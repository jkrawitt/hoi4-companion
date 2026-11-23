/**
 * The country's working state while rewards are applied one after another, and the stat formulas
 * read from it (`rawStatNow`, `stabilityBeforeModifiersNow`).
 */
import type { EffectLine } from '../focus'
import type { BopWeeklyRule } from '../balanceOfPower'
import { DEFAULT_POLITICS_DEFINES } from '../politics'
import { newResearchWorking, recordResearchState, type ResearchWorking } from './researchEvents'
import { round } from '../numbers'
import { activeModifiers, rawCountryStat, scriptedStat } from './totals'
import type {
  ActiveIdea,
  BuildingTotal,
  ConditionalEffects,
  ConstructionBatch,
  CountryLeader,
  CountryStateOptions,
  PopularityChange,
  ResourceTotal,
  StatTotal,
} from './types'

/** Everything the rewards applied so far have done to the country. */
export interface Working {
  ideas: Map<string, ActiveIdea>
  statChanges: Map<string, StatTotal>
  popularity: Map<string, PopularityChange>
  conditional: ConditionalEffects[]
  /** The planned focuses' rewards with the branches marked, by focus id. */
  focusEffects: Record<string, EffectLine[]>
  buildings: Map<string, BuildingTotal>
  buildingSlots: number
  construction: ConstructionBatch[]
  resources: Map<string, ResourceTotal>
  rulingParty?: string
  /** The ruling ideology group as the scripts name it (`communism`), for conditions. */
  government?: string
  doneFocuses: Set<string>
  /** The focuses whose `bypass` held as they started: they are skipped, with no reward. */
  bypassed: Set<string>
  /** Who leads, for conditions: unknown again after `retire_country_leader`, as the game picks next. */
  identity?: { id?: string; character?: string }
  /** The ideology group the leader leads for, when known (a new leader, not a bare role). */
  leaderGroup?: string
  retiredLeaders: Set<string>
  leader?: CountryLeader
  research: ResearchWorking
  /** The characters recruited so far, whom advisors need to be hired. */
  recruited: Set<string>
  /** The countries at war with ours, from the player's entries; unknown before the first one. */
  enemies?: string[]
  /** Country flags the plan's rewards set (true) or cleared (false). */
  flags: Map<string, boolean>
  /** The balance of power's value (Finland's public trust), once a reward has set or moved it. */
  balance?: number
  /** The days the balance moved from one range into another by the weekly drift. */
  balanceChanges: Date[]
  /** The weekly drift rules in force: the ones that held at the last weekly script. */
  bopRules: BopWeeklyRule[]
}

export const newWorking = (): Working => ({
  ideas: new Map(),
  statChanges: new Map(),
  popularity: new Map(),
  balanceChanges: [],
  bopRules: [],
  conditional: [],
  focusEffects: {},
  buildings: new Map(),
  buildingSlots: 0,
  construction: [],
  resources: new Map(),
  doneFocuses: new Set(),
  bypassed: new Set(),
  retiredLeaders: new Set(),
  research: newResearchWorking(),
  recruited: new Set(),
  flags: new Map(),
})

/**
 * The country's stability or war support on `date` as the rewards so far leave it, before it is
 * kept between 0 and 1 (see `rawCountryStat`): what conditions, the overview and
 * `set_actual_stability` all go by.
 */
export const rawStatNow = (
  w: Working,
  options: CountryStateOptions,
  key: 'stability' | 'war_support',
  date: Date,
): number => {
  const active = [...w.ideas.values()].filter((idea) => !idea.until || idea.until > date)
  const { totals } = activeModifiers(active, w.leader?.traits ?? [])
  return rawCountryStat(
    key,
    options.start ?? [],
    w.statChanges.get(`add_${key}`)?.total ?? 0,
    (k) => totals.get(k)?.total ?? 0,
    w.government ? (w.popularity.get(w.government)?.total ?? 0) : 0,
    (options.politics?.defines ?? DEFAULT_POLITICS_DEFINES).partyStability,
  )
}

/**
 * Stability before modifiers (see `stabilityFrom`): the scripted part plus the ruling party's
 * popularity times `partyStability`, from the same inputs `rawStatNow` uses.
 */
export const stabilityBeforeModifiersNow = (w: Working, options: CountryStateOptions): number =>
  round(
    scriptedStat('stability', options.start ?? [], w.statChanges.get('add_stability')?.total ?? 0) +
      (w.government ? (w.popularity.get(w.government)?.total ?? 0) : 0) *
        (options.politics?.defines ?? DEFAULT_POLITICS_DEFINES).partyStability,
  )

/** Records the research environment (ideas, leader traits, stability) as it is on `at`. */
export const snapshotResearch = (w: Working, options: CountryStateOptions, at: Date): void => {
  recordResearchState(w.research, at, w.statChanges.get('add_research_slot')?.total ?? 0, {
    ideas: [...w.ideas.values()],
    traits: w.leader?.traits ?? [],
    stabilityBeforeModifiers: stabilityBeforeModifiersNow(w, options),
  })
}
