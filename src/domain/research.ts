/**
 * The shared shapes of research: what the importer reads out of the game (`ResearchData`), the
 * dated inputs the campaign hands the planner (`ResearchEnvironment`) and what the planner
 * produces (`ResearchSchedule`). `plan/researchPlan.ts` depends on nothing but this file.
 */
import type { Check, EffectLine } from './focus'

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
  /** Research bonus of a design team (a military industrial organisation) matching the tech. */
  designTeamBonus: number
}

/**
 * A military industrial organisation (MIO) the country can have as the design team of a research.
 * Its trait unlocks, policies, funds and size are not modelled.
 */
export interface MioData {
  id: string
  name: string
  /** The `mio_cat_tech_*` categories whose technologies it can research as a design team. */
  researchCategories: string[]
  /** Its own research bonus (`military_industrial_organization_research_bonus`), added to the define's. */
  researchBonus: number
  /** Its `available` block (a focus completed, say), when it has one. */
  available?: Check
  availableText?: string
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
  /** Whether a MIO is available on a date; `undefined` when the campaign cannot tell. */
  mioAvailable?: (id: string, date: Date) => boolean | undefined
}

export const emptyEnvironment = (): ResearchEnvironment => ({
  startTechs: [],
  slots: [],
  speed: [],
  grants: [],
  bonuses: [],
  categorySpeed: [],
})

/** A technology in the queue, the focus bonus and the design team (a MIO id) chosen for it. */
export interface ResearchItem {
  techId: string
  bonus?: BonusRef
  designTeam?: string
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

/** `1.5 years ahead of time: x4 cost (the bonus ignores 2 years)`, for tooltips and queue rows. */
export const describeAhead = (ahead: AheadOfTime): string => {
  const years = Math.round(ahead.years * 10) / 10
  const cost =
    ahead.penalty > 1 ? `x${Math.round(ahead.penalty * 100) / 100} cost` : 'no extra cost'
  const bonus = ahead.ignored > 0 ? ` (the bonus ignores ${ahead.ignored} years)` : ''
  return `${years} ${years === 1 ? 'year' : 'years'} ahead of time: ${cost}${bonus}`
}

export type ResearchIssue =
  | { kind: 'already-researched' }
  | { kind: 'bonus-unavailable' }
  /** The design team does not research any of the tech's categories. */
  | { kind: 'design-team-mismatch' }
  /** The design team is the one of another research that is under way. */
  | { kind: 'design-team-busy' }
  /** The design team's `available` block does not hold on the day the tech starts. */
  | { kind: 'design-team-unavailable' }

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
  /** The day the bonus was applied, when it was granted while the tech was being researched. */
  bonusApplied?: Date
  /** The design team (MIO id) actually used; the tech runs without it when there is an issue. */
  designTeam?: string
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
  /** When each design team was in use: from its tech's start to its end. */
  designTeams: DesignTeamUse[]
}

export interface DesignTeamUse {
  mio: string
  start: Date
  end: Date
}

export interface ResearchOptions {
  startDate: Date
  /** How far to simulate; techs not done by then are left unscheduled. */
  until: Date
  defines: ResearchDefines
  /** The MIOs a queued tech can name as its design team. */
  mios?: MioData[]
  /**
   * Days of progress a tech that starts on the first day has already made, like a first focus
   * (`PlanOptions.loadedDays`): the game seems to give the opening research slots a free day.
   */
  loadedDays?: number
}
