import type { EffectLine, LeaderData } from '../focus'
import type { PoliticsData } from '../politics'
import type { ResearchEnvironment } from '../research'
import type { ScheduledFocus } from '../plan/types'
import type { StatDefinition } from '../stats'
import type { Step } from './applyReward'

export interface ActiveIdea {
  id: string
  name: string
  focusId: string
  focusName: string
  since: Date
  /** When a timed idea runs out. */
  until?: Date
  /** The idea's modifier and rule lines, at depth 0. */
  modifiers: EffectLine[]
  /** The politics slot it fills (one law, designer, ...), when it is one political power buys. */
  slot?: string
  /** A designer's extra research speed per technology category. */
  researchBonus?: Record<string, number>
}

export interface CountryLeader {
  name: string
  /** The leader's own `id` when made by `create_country_leader`; characters have none. */
  id?: string
  /** The character leading, when the leader is one. */
  character?: string
  /** The leader's own ideology, e.g. `Conservatism`. */
  ideology?: string
  /** `leader_trait` lines with their stats beneath, at depth 0. */
  traits: EffectLine[]
}

export interface StatTotal {
  key: string
  stat: StatDefinition
  total: number
}

export interface RuleValue {
  key: string
  stat: StatDefinition
  value: string
}

export interface PopularityChange extends StatTotal {
  subject: string
  subjectName: string
}

export interface ConditionalEffects {
  focusId: string
  focusName: string
  lines: EffectLine[]
}

/** Buildings built by focuses, summed per type; instant and queued builds are counted apart. */
export interface BuildingTotal {
  type: string
  name: string
  total: number
  instant: boolean
}

export interface ResourceTotal {
  type: string
  name: string
  total: number
}

/**
 * What one block of a reward builds: the construction lines under one header (a numbered state
 * scope or a `random_owned_*state` block), or loose top-level ones (neither `state` nor `random`).
 */
export interface ConstructionBatch {
  focusId: string
  focusName: string
  date: Date
  /** The state of a numbered scope (`46 = { ... }`). */
  state?: number
  /** The states a random block prefers, in order. */
  prefer?: number[]
  /** A `random_owned_*` block: the game picks the state. */
  random: boolean
  buildings: { type: string; name: string; level: number; instant: boolean }[]
  /** Extra shared building slots. */
  slots: number
  resources: { type: string; name: string; amount: number }[]
}

/** What the country is like after a reward, for the planners that change over time. */
export interface StateSnapshot {
  date: Date
  ideas: ActiveIdea[]
  traits: EffectLine[]
  /** The `add_stability` total so far (the start's `set_stability` plus changes). */
  stabilityBase: number
  /** The ruling party's popularity, as a fraction of 1. */
  rulingPopularity: number
}

export interface CountryPolitics {
  /** The active ideas in each politics slot (`economy`, `political_advisor`, ...). */
  held: Record<string, ActiveIdea[]>
  /** The characters recruited so far: the history's, and those focuses recruit. */
  recruited: string[]
}

export interface CountryState {
  date: Date
  /** Focuses finished by `date`, in order. */
  completed: ScheduledFocus[]
  /** The first focus not finished yet. */
  next?: ScheduledFocus
  ideas: ActiveIdea[]
  /** Stats such as stability and political power: the starting value plus rewards so far. */
  statChanges: StatTotal[]
  /** The summed numeric modifiers of the active ideas. */
  modifierTotals: StatTotal[]
  /** The yes/no rules of the active ideas. */
  rules: RuleValue[]
  /** Popularity per ideology (the start plus changes), as a fraction of 1 like the game scripts. */
  popularity: PopularityChange[]
  rulingParty?: string
  /** The ruling party's ideology id (`democratic`), which `popularity` entries are keyed by. */
  government?: string
  /**
   * Actual stability and war support (0 to 1; see `countryStat`): only known once the start has
   * set them, like popularity.
   */
  stability?: number
  warSupport?: number
  leader?: CountryLeader
  /** The production of each resource added by completed focuses, summed. */
  resources: ResourceTotal[]
  /** The buildings added by completed focuses, summed per type. */
  buildings: BuildingTotal[]
  /** Extra building slots added by completed focuses, summed. */
  buildingSlots: number
  /** The same builds block by block, in order, for placing them in states. */
  construction: ConstructionBatch[]
  conditional: ConditionalEffects[]
  /** The ideas and leader traits in force after each reward, to work out the modifiers on any date. */
  snapshots: StateSnapshot[]
  /** What fills the politics slots, and which characters can be hired. */
  politics: CountryPolitics
  /** The dated slots, speed, bonuses and techs the research planner schedules with. */
  research: ResearchEnvironment
}

export interface CountryStateOptions {
  /** The country's own tag, so scopes naming it are not mistaken for another country's. */
  tag?: string
  /** The DLCs the player owns, to answer `has_dlc`; one not listed is not owned. */
  ownedDlc?: Record<string, boolean>
  /**
   * The laws, designers and advisors political power can buy: their slot sizes (a slot already full
   * gives up its oldest idea for a new one) and which characters the history recruits.
   */
  politics?: PoliticsData
  /**
   * Rewards that are not focuses, applied in date order with the completed focuses (a focus first
   * on the same day): the planned political power purchases.
   */
  extraSteps?: Step[]
  /** What the country starts with, applied first like a reward; see `parsers/countryStart.ts`. */
  start?: EffectLine[]
  /**
   * Who the game picks as leader when one is retired or the ruling party changes under them. Without
   * it the leader stays as the plan last set it.
   */
  leaders?: LeaderData
  /** When the starting state applies, i.e. the campaign's start date. */
  startDate?: Date
  /**
   * Whether the country has a technology on a date (a focus completing), which settles `has_tech`
   * conditions. Without it they are listed as conditional.
   */
  hasTech?: (id: string, date: Date) => boolean | undefined
  /** The law category of every law idea; a law added replaces the active law of its category. */
  laws?: Record<string, string>
}
