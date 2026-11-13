import type { EffectLine, LeaderData, ScheduledFocus } from '../focus'
import type { StatDefinition } from '../stats'

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
  leader?: CountryLeader
  /** The production of each resource added by completed focuses, summed. */
  resources: ResourceTotal[]
  /** The buildings added by completed focuses, summed per type. */
  buildings: BuildingTotal[]
  /** Extra building slots added by completed focuses, summed. */
  buildingSlots: number
  conditional: ConditionalEffects[]
}

export interface CountryStateOptions {
  /** The country's own tag, so scopes naming it are not mistaken for another country's. */
  tag?: string
  /** What the country starts with, applied first like a reward; see `parsers/countryStart.ts`. */
  start?: EffectLine[]
  /**
   * Who the game picks as leader when one is retired or the ruling party changes under them. Without
   * it the leader stays as the plan last set it.
   */
  leaders?: LeaderData
  /** When the starting state applies, i.e. the campaign's start date. */
  startDate?: Date
}
