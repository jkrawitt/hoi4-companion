/** HoI4 focus cost is in weeks; one week is 7 days. */
export const DAYS_PER_WEEK = 7

import type { StatDefinition } from './stats'

/**
 * Ids of the pseudo focuses that carry the starting state and the leader candidates through the
 * same passes as the focuses. The start is also the `focusId` of what it added (an idea, say).
 */
export const START_ID = '__start__'
export const LEADERS_ID = '__leaders__'

/** How an opinion modifier changes opinion between two countries. */
export interface OpinionModifier {
  value: number
  /** How long it lasts; permanent (until it decays or is removed) when unset. */
  months?: number
}

/**
 * A condition from a `limit` that the campaign can sometimes answer from the plan: the country's
 * ideas, the focuses it has completed, its ruling party and popularity, and its technologies.
 * `unknown` stands for a term we cannot answer (another country's state, a leader id, ...).
 */
export type Check =
  | { type: 'idea' | 'focus' | 'tech' | 'government'; id: string }
  /** `democratic > party_popularity@fascism` (`than` an ideology) or `democratic > 0.5`. */
  | {
      type: 'popularity'
      ideology: string
      op: '>' | '<' | '>=' | '<=' | '='
      than: string | number
    }
  /** `has_country_leader = { id = 550 }` (a legacy leader) or `{ character = X }`. */
  | { type: 'leader'; id?: string; character?: string }
  | { type: 'not'; of: Check }
  | { type: 'all' | 'any'; of: Check[] }
  | { type: 'unknown' }

/**
 * Who can lead a country, for when the game picks a new leader (a retired leader, or a change of
 * ruling party). `candidates` are the characters the history recruits that have a `country_leader`
 * role, in the order the game would pick them, as `promote_character` lines (named like any other
 * effect); `groups` maps each sub-ideology to its ideology group (`conservatism` to `democratic`).
 */
export interface LeaderData {
  candidates: { group: string; line: EffectLine }[]
  groups: Record<string, string>
}

/** One line of a focus's completion reward, flattened from the effect script. */
export interface EffectLine {
  /** Nesting level, e.g. the fields of `add_popularity = { ... }` sit one deeper. */
  depth: number
  /** Effect or field name as written in the game files; null for a bare value. */
  key: string | null
  value?: string
  /** Comparison operator when it is not `=`, e.g. `>` in `communism > party_popularity@fascism`. */
  operator?: string
  /** Localised name of `value` when it refers to something with one (e.g. an idea). */
  valueName?: string
  /** What the effect applies to, e.g. the ideology of an `add_popularity` line. */
  subject?: string
  /** Localised name of `subject`. */
  subjectName?: string
  /** For `add_opinion_modifier` lines: the modifier named by `value`, toward `subject`. */
  opinion?: OpinionModifier
  /** For `add_timed_idea` lines: how long the idea lasts. */
  days?: number
  /** For `country_event` lines: the event's title, with names filled in where we can. */
  eventTitle?: string
  /** For `random_owned_controlled_state` headers: state ids the game tries first. */
  preferStates?: string[]
  /** Localised names of `preferStates`. */
  preferNames?: string[]
  /** For `add_doctrine_cost_reduction` lines: `value` is the category, e.g. `land_doctrine`. */
  doctrine?: { reduction: number; uses: number; name?: string }
  /**
   * For research effects: `tech_bonus` (`add_tech_bonus`), `mastery` (`add_mastery_bonus`) and
   * `unlock` (`set_technology`). `targets` are the categories, doctrines or technologies it
   * applies to, `targetNames` their localised names.
   */
  research?: {
    kind: 'tech_bonus' | 'mastery' | 'unlock'
    bonus?: number
    uses?: number
    days?: number
    /** Years of the ahead-of-time research penalty that are ignored. */
    ahead?: number
    targets: string[]
    targetNames?: string[]
  }
  /** For `add_building_construction` lines: the building is built at once, not queued. */
  instant?: boolean
  /** For `if` headers whose `limit` was folded in: the condition, e.g. `France is in faction`. */
  condition?: string
  /** For `if`/`else_if` headers whose `limit` was folded in: the condition as data. */
  check?: Check
  /** For `create_country_leader` lines: the leader's own `id`, which `has_country_leader` can ask for. */
  leaderId?: string
  /** For `create_country_leader` lines: the ids of the leader's traits. */
  traits?: string[]
  /** For `diplomatic_relation` lines: whether the relation is being granted or removed. */
  active?: boolean
  /** Inside a `hidden_effect` block: the game does not show it to the player. */
  hidden?: boolean
  /** Set on lines from an idea's `modifier` block; they are shown through their `stat`. */
  isModifier?: boolean
  /** Set on lines from an idea's `rule` block (yes/no game rules such as `can_send_volunteers`). */
  isRule?: boolean
  /** How to display this modifier line (resolved at import from names, docs and overrides). */
  stat?: StatDefinition
}

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
  /** Localised flavour text, when the game provides some. */
  description?: string
  /** What completing the focus does (its `completion_reward`). */
  effects: EffectLine[]
}
