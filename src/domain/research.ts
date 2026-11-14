/**
 * The shared shapes of research: what the importer reads out of the game (`ResearchData`), the
 * dated inputs the campaign hands the planner (`ResearchEnvironment`) and what the planner
 * produces (`ResearchSchedule`). `plan/researchPlan.ts` depends on nothing but this file.
 */
import type { EffectLine } from './focus'

/** One technology as the game defines it, with the folders it can be seen in. */
export interface Technology {
  id: string
  /** Display name; the humanized id when no localisation was found. */
  name: string
  /** `research_cost`, a multiplier on the base cost of a technology. */
  cost: number
  startYear: number
  /** Where it sits in each folder that is available to the player. A tech can be in several. */
  folders: { id: string; x: number; y: number }[]
  categories: string[]
  /**
   * Every group must be satisfied (AND) and a group is satisfied by any one of its techs (OR).
   * The techs leading to this one form one group (any parent will do); a `dependencies` entry
   * is a group of its own.
   */
  prerequisites: string[][]
  /** Researching one of these (an `XOR` block) rules this one out. */
  exclusiveWith: string[]
  /** False for special projects, techs only a focus can grant and ones without a folder. */
  researchable: boolean
  /** The plain stat changes the tech brings (not the per-category ones). */
  modifiers: EffectLine[]
}

export interface TechFolder {
  id: string
  name: string
  /** The game draws this folder's trees sideways (years run left to right), like the army ones. */
  sideways?: boolean
}

/** The research numbers the game keeps in its defines. */
export interface ResearchDefines {
  /** Days a tech with a cost of 1 takes at a research speed of 1. */
  baseCost: number
  /** Extra cost per year a tech is researched ahead of its time. */
  aheadPenalty: number
  /** Research speed never goes below this. */
  minSpeed: number
}

/** What the importer reads about research. */
export interface ResearchData {
  techs: Technology[]
  /** The folders that are available (DLC variants picked), in the game's order. */
  folders: TechFolder[]
  defines: ResearchDefines
}

/** One `add_tech_bonus` granted by a focus: `index` counts the bonuses of that focus. */
export interface BonusRef {
  focusId: string
  index: number
}

export const sameBonus = (a: BonusRef | undefined, b: BonusRef | undefined): boolean =>
  a !== undefined && b !== undefined && a.focusId === b.focusId && a.index === b.index

/** A research bonus the campaign has earned: usable from `date` on, `uses` times. */
export interface ResearchBonus {
  ref: BonusRef
  date: Date
  /** The focus that grants it. */
  name: string
  /** Extra research speed, as a fraction: 1 is +100%. */
  bonus: number
  uses: number
  /** Years of the ahead-of-time penalty it ignores. */
  ahead: number
  /** Categories or technology ids, told apart by `targetKinds`. */
  targets: string[]
  targetKinds: ('category' | 'technology')[]
  targetNames?: string[]
}

/** The campaign's dated inputs to research, built while the focus rewards are applied. */
export interface ResearchEnvironment {
  /** Technologies the country starts the game with. */
  startTechs: string[]
  /** Research slots from each date on. */
  slots: { date: Date; total: number }[]
  /** The research speed factor (0.1 is +10%) from each date on. */
  speed: { date: Date; factor: number }[]
  /** Technologies handed out (`set_technology`) on a date. */
  grants: { date: Date; techIds: string[] }[]
  bonuses: ResearchBonus[]
  /**
   * Extra research speed per technology category from each date on, from the designers the country
   * has (`research_bonus`); a tech takes the sum of the entries for its categories.
   */
  categorySpeed?: { date: Date; bonuses: Record<string, number> }[]
}

export const emptyEnvironment = (): ResearchEnvironment => ({
  startTechs: [],
  slots: [],
  speed: [],
  grants: [],
  bonuses: [],
  categorySpeed: [],
})

/** A technology in the queue, and the focus bonus chosen for it. */
export interface ResearchItem {
  techId: string
  bonus?: BonusRef
}

/**
 * What researching a tech before its `start_year` costs on a given day: the years it is early
 * (`years`), the years a focus bonus ignores (`ignored`), and the factor on its cost (`penalty`,
 * 1 when it is not early, or the bonus covers all of it).
 */
export interface AheadOfTime {
  years: number
  ignored: number
  penalty: number
}

export type ResearchIssue = { kind: 'already-researched' } | { kind: 'bonus-unavailable' }

export interface ScheduledResearch {
  /** Position in the queue. */
  index: number
  techId: string
  /** Which research slot does it (from 0); -1 for a tech the country already has. */
  slot: number
  start: Date
  end: Date
  days: number
  bonusUsed?: BonusRef
  /** The ahead-of-time penalty on the day it started; see `aheadOfTime`. */
  ahead: AheadOfTime
  issues: ResearchIssue[]
}

export type UnscheduledReason =
  | 'unknown-tech'
  | 'not-researchable'
  | 'duplicate'
  | 'xor-blocked'
  | 'missing-prerequisite'
  | 'out-of-time'

export interface UnscheduledResearch {
  index: number
  techId: string
  reason: UnscheduledReason
}

export interface ResearchSchedule {
  /** The techs that get researched, in queue order. */
  items: ScheduledResearch[]
  /** The queued techs that never get started or finished. */
  unscheduled: UnscheduledResearch[]
  /** Every tech the country has on a date: the start techs, grants and finished research. */
  researchedBy: (date: Date) => Set<string>
}

export interface ResearchOptions {
  startDate: Date
  /** How far to simulate; techs not done by then are left unscheduled. */
  until: Date
  defines: ResearchDefines
}
