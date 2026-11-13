/**
 * Planning research against the campaign: the focus plan decides how many slots there are, how
 * fast research goes, which bonuses exist and which techs are handed out, and the research queue
 * is scheduled against that. The focus plan in turn asks about technologies (`has_tech`), which
 * is answered from the research schedule, so the two are settled together (`planResearch`).
 */
import type {
  ResearchBonus,
  ResearchData,
  ResearchEnvironment,
  ResearchItem,
  ResearchSchedule,
  ScheduledResearch,
  Technology,
} from '../research'
import { emptyEnvironment, sameBonus } from '../research'
import type { FocusSchedule } from '../plan/types'
import { scheduleResearch } from '../plan/researchPlan'
import { countryStateAt } from './countryState'
import { addTo, isNumeric } from './totals'
import { statLabel } from '../stats'
import type { CountryStateOptions, StatTotal } from './types'

export interface PlannedResearch {
  schedule: ResearchSchedule
  environment: ResearchEnvironment
  /** Answers `has_tech` for the campaign; undefined when there is no tech data to answer from. */
  hasTech?: (id: string, date: Date) => boolean | undefined
}

export interface ResearchPlanInput {
  focusSchedule: FocusSchedule
  /** What `countryStateAt` takes (tag, start, leaders); `hasTech` is worked out here. */
  options: CountryStateOptions
  queue: ResearchItem[]
  data?: ResearchData
  startDate: Date
  /** How far to look for techs finishing. */
  until: Date
}

/** The most times the focus plan and the research schedule are settled against each other. */
const MAX_PASSES = 3

const signature = (schedule: ResearchSchedule): string =>
  JSON.stringify([schedule.items, schedule.unscheduled])

/**
 * Schedules the research queue against the focus plan.
 *
 * `has_tech` conditions in focus rewards depend on the research schedule, and the research
 * schedule depends on what those rewards give (slots, bonuses, techs), so this settles them by
 * repetition. The first pass leaves `has_tech` unanswered; each later pass answers it from the
 * previous schedule. Only the branches that ask about techs can change between passes, so it
 * normally settles after the second. If it has not by the last pass the latest schedule is used.
 */
export const planResearch = (input: ResearchPlanInput): PlannedResearch => {
  const { focusSchedule, options, queue, data, startDate, until } = input
  if (!data) {
    const environment = countryStateAt(focusSchedule, focusSchedule.finish, options).research
    return {
      schedule: scheduleResearch([], {}, emptyEnvironment(), {
        startDate,
        until,
        defines: emptyDefines,
      }),
      environment,
    }
  }
  const techs = Object.fromEntries(data.techs.map((t) => [t.id, t]))
  const answerFrom =
    (schedule: ResearchSchedule): PlannedResearch['hasTech'] =>
    (id, date) =>
      id in techs ? schedule.researchedBy(date).has(id) : undefined

  let hasTech: PlannedResearch['hasTech']
  let planned: PlannedResearch | undefined
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const environment = countryStateAt(focusSchedule, focusSchedule.finish, {
      ...options,
      hasTech,
    }).research
    const schedule = scheduleResearch(queue, techs, environment, {
      startDate,
      until,
      defines: data.defines,
    })
    const settled = planned !== undefined && signature(planned.schedule) === signature(schedule)
    hasTech = answerFrom(schedule)
    planned = { schedule, environment, hasTech }
    if (settled) break
  }
  return planned!
}

const emptyDefines = { baseCost: 110, aheadPenalty: 2, minSpeed: 0.1 }

/** A research bonus and how many uses of it are left. */
export interface BonusLeft {
  bonus: ResearchBonus
  left: number
}

export interface ResearchStatus {
  slots: number
  /** Techs the plan finished by the date. */
  finished: ScheduledResearch[]
  /** Techs being researched on the date. */
  inProgress: ScheduledResearch[]
  /** Bonuses granted by the date that still have uses left. */
  unusedBonuses: BonusLeft[]
}

/** How research stands on a date: the slots, the techs done and in progress, the bonuses unspent. */
export const researchStatusAt = (
  schedule: ResearchSchedule,
  environment: ResearchEnvironment,
  date: Date,
): ResearchStatus => {
  const real = schedule.items.filter((item) => item.slot >= 0)
  const slots = environment.slots.filter((s) => s.date <= date).pop()?.total ?? 0
  const spent = (bonus: ResearchBonus) =>
    real.filter((item) => item.start <= date && sameBonus(item.bonusUsed, bonus.ref)).length
  return {
    slots,
    finished: real.filter((item) => item.end <= date),
    inProgress: real.filter((item) => item.start <= date && item.end > date),
    unusedBonuses: environment.bonuses
      .filter((bonus) => bonus.date <= date)
      .map((bonus) => ({ bonus, left: bonus.uses - spent(bonus) }))
      .filter((b) => b.left > 0),
  }
}

/**
 * What the technologies the country has add up to: the plain stat changes of every tech in `had`
 * (what `ResearchSchedule.researchedBy` gives: the start techs, what focuses hand out and the
 * research finished by then), summed per stat and sorted by name. Only the stats a tech lists
 * directly count; the per-category ones (`land_doctrine` blocks and the like) are not read.
 */
export const techModifierTotals = (techs: Technology[], had: Set<string>): StatTotal[] => {
  const totals = new Map<string, StatTotal>()
  for (const tech of techs) {
    if (!had.has(tech.id)) continue
    for (const m of tech.modifiers) {
      if (m.key && m.stat && isNumeric(m.value)) addTo(totals, m.key, m.stat, Number(m.value))
    }
  }
  return [...totals.values()]
    .filter((t) => t.total !== 0)
    .sort((a, b) => statLabel(a.stat).localeCompare(statLabel(b.stat)))
}
