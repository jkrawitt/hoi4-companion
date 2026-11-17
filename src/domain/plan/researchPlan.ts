/**
 * Scheduling the research queue. It knows nothing about game files or the campaign: it is given
 * the technologies and the dated inputs the campaign worked out (`ResearchEnvironment`).
 *
 * The queue is one shared list. Every day, each free research slot (lowest first) takes the first
 * queued tech that can start: not started yet, prerequisites done, no tech it excludes taken. A
 * tech that cannot start yet does not hold up the ones behind it. A slot adds, each day,
 *
 *   (1 + research speed + bonus + category bonus)
 *     / (base cost x tech cost x (1 + penalty x years ahead of time))
 *
 * to a tech, which is done at 1. The years ahead are counted from that day to January 1st of the
 * tech's `start_year`, minus the years the chosen bonus ignores. A design team (a military
 * industrial organisation, chosen per queue item) adds the define's bonus plus its own when one of
 * the tech's categories is one of its research categories, it is available on the start day and
 * it is not the design team of another research under way. The category bonus is what the
 * designers the country has add for the tech's categories, from the day they are in force. A
 * bonus is spent when the tech starts, or, when it is granted while a matching tech is being
 * researched, on that tech from that day (assumed, not checked in game). Everything moves in
 * whole days, so a tech's dates and days are whole numbers.
 */
import type {
  AheadOfTime,
  DesignTeamUse,
  MioData,
  ResearchBonus,
  ResearchDefines,
  ResearchEnvironment,
  ResearchIssue,
  ResearchItem,
  ResearchOptions,
  ResearchSchedule,
  ScheduledResearch,
  Technology,
  UnscheduledReason,
  UnscheduledResearch,
} from '../research'
import { sameBonus } from '../research'
import { addDays, daysBetween, DAYS_PER_YEAR } from '../calendar'

/** Progress is a sum of fractions, so allow for rounding when asking whether a tech is done. */
const EPSILON = 1e-9

/** Whether a research bonus applies to a tech: it names the tech or one of its categories. */
export const bonusMatches = (bonus: ResearchBonus, tech: Technology): boolean =>
  bonus.targets.some((target, i) => {
    const kind = bonus.targetKinds[i]
    return (
      (kind !== 'technology' && tech.categories.includes(target)) ||
      (kind !== 'category' && target === tech.id)
    )
  })

/**
 * The extra research speed a tech gets on `date` from its categories (a designer's
 * `research_bonus`): the sum of the bonuses of the categories it is in.
 */
export const categoryBonusAt = (
  env: Pick<ResearchEnvironment, 'categorySpeed'>,
  tech: Pick<Technology, 'categories'>,
  date: Date | number,
): number => {
  const time = typeof date === 'number' ? date : date.getTime()
  const entry = (env.categorySpeed ?? []).filter((c) => c.date.getTime() <= time).pop()
  if (!entry) return 0
  return Object.entries(entry.bonuses).reduce(
    (sum, [category, bonus]) => (tech.categories.includes(category) ? sum + bonus : sum),
    0,
  )
}

const bonusKey = (bonus: ResearchBonus) => `${bonus.ref.focusId}#${bonus.ref.index}`

/** The value of a dated list on `day`: the last entry that has started by then. */
const valueAt = <T>(list: { day: number; value: T }[], day: number, fallback: T): T => {
  let value = fallback
  for (const entry of list) {
    if (entry.day <= day) value = entry.value
  }
  return value
}

/**
 * The ahead-of-time penalty for researching `tech` on `date`: it is early by the years left until
 * 1 January of its `start_year`, a focus bonus can ignore some of those years, and each remaining
 * year adds `defines.aheadPenalty` to the cost factor.
 */
export const aheadOfTime = (
  tech: Pick<Technology, 'startYear'>,
  date: Date | number,
  ignored: number,
  defines: ResearchDefines,
): AheadOfTime => {
  const years = Math.max(0, daysBetween(date, Date.UTC(tech.startYear, 0, 1))) / DAYS_PER_YEAR
  return { years, ignored, penalty: 1 + defines.aheadPenalty * Math.max(0, years - ignored) }
}

interface Entry {
  index: number
  item: ResearchItem
  tech: Technology
}

interface Running {
  entry: Entry
  start: number
  progress: number
  bonus?: ResearchBonus
  /** The day a bonus granted during the research was applied to it. */
  bonusApplied?: number
  /** The design team in use, with its research bonus (the define's plus its own). */
  designTeam?: { id: string; bonus: number }
  /** The penalty on the day it started, for the queue to show. */
  ahead: AheadOfTime
  issues: ResearchIssue[]
}

export const scheduleResearch = (
  queue: ResearchItem[],
  techs: Record<string, Technology>,
  env: ResearchEnvironment,
  options: ResearchOptions,
): ResearchSchedule => {
  const { startDate, defines } = options
  /** The first whole day on which something dated `date` counts. */
  const dayOf = (date: Date) => Math.max(0, Math.ceil(daysBetween(startDate, date) - EPSILON))
  const horizon = dayOf(options.until)

  const slotsByDay = env.slots
    .map((s) => ({ day: dayOf(s.date), value: s.total }))
    .sort((a, b) => a.day - b.day)
  const speedByDay = env.speed
    .map((s) => ({ day: dayOf(s.date), value: s.factor }))
    .sort((a, b) => a.day - b.day)

  // When each tech is had: the start techs, what focuses hand out, and (below) what gets done.
  const doneAt = new Map<string, Date>()
  const giveAt = (id: string, date: Date) => {
    const known = doneAt.get(id)
    if (!known || date < known) doneAt.set(id, date)
  }
  for (const id of env.startTechs) giveAt(id, startDate)
  for (const grant of env.grants) grant.techIds.forEach((id) => giveAt(id, grant.date))
  const granted = new Set(doneAt.keys())
  /** The day a tech is had, for deciding what can start. */
  const doneDay = (id: string) => {
    const date = doneAt.get(id)
    return date ? dayOf(date) : Infinity
  }

  const scheduled: (ScheduledResearch | undefined)[] = new Array(queue.length)
  const unscheduled: UnscheduledResearch[] = []
  const pending: Entry[] = []
  const seen = new Set<string>()
  queue.forEach((item, index) => {
    const tech = techs[item.techId]
    const leave = (reason: UnscheduledReason) =>
      unscheduled.push({ index, techId: item.techId, reason })
    if (seen.has(item.techId)) return leave('duplicate')
    seen.add(item.techId)
    if (!tech) return leave('unknown-tech')
    if (granted.has(item.techId)) {
      const date = doneAt.get(item.techId)!
      scheduled[index] = {
        index,
        techId: item.techId,
        slot: -1,
        start: date,
        end: date,
        days: 0,
        ahead: { years: 0, ignored: 0, penalty: 1 },
        issues: [{ kind: 'already-researched' }],
      }
    } else if (!tech.researchable) {
      leave('not-researchable')
    } else {
      pending.push({ index, item, tech })
    }
  })

  const started = new Set<string>()
  const running: (Running | undefined)[] = []
  const bonusUses = new Map<string, number>()
  const mioById = new Map((options.mios ?? []).map((mio) => [mio.id, mio]))
  /** The design teams of the research under way: a team does one research at a time. */
  const busyTeams = new Set<string>()
  const teamUses: DesignTeamUse[] = []

  const canStart = ({ tech }: Entry, day: number) =>
    tech.prerequisites.every((group) => group.some((id) => doneDay(id) <= day)) &&
    !tech.exclusiveWith.some((id) => started.has(id) || doneDay(id) <= day)

  const begin = (entry: Entry, day: number): Running => {
    const issues: ResearchIssue[] = []
    let bonus: ResearchBonus | undefined
    if (entry.item.bonus) {
      const chosen = env.bonuses.find((b) => sameBonus(b.ref, entry.item.bonus))
      const usable =
        chosen !== undefined &&
        bonusMatches(chosen, entry.tech) &&
        dayOf(chosen.date) <= day &&
        (bonusUses.get(bonusKey(chosen)) ?? 0) < chosen.uses
      if (usable) {
        bonus = chosen
        bonusUses.set(bonusKey(chosen), (bonusUses.get(bonusKey(chosen)) ?? 0) + 1)
      } else {
        issues.push({ kind: 'bonus-unavailable' })
      }
    }
    let designTeam: Running['designTeam']
    const mio = entry.item.designTeam ? mioById.get(entry.item.designTeam) : undefined
    if (mio) {
      if (!mio.researchCategories.some((category) => entry.tech.categories.includes(category))) {
        issues.push({ kind: 'design-team-mismatch' })
      } else if (env.mioAvailable?.(mio.id, addDays(startDate, day)) === false) {
        issues.push({ kind: 'design-team-unavailable' })
      } else if (busyTeams.has(mio.id)) {
        issues.push({ kind: 'design-team-busy' })
      } else {
        designTeam = { id: mio.id, bonus: defines.designTeamBonus + mio.researchBonus }
        busyTeams.add(mio.id)
      }
    }
    started.add(entry.tech.id)
    const ahead = aheadOfTime(entry.tech, addDays(startDate, day), bonus?.ahead ?? 0, defines)
    return { entry, start: day, progress: 0, bonus, designTeam, ahead, issues }
  }

  for (let day = 0; day < horizon && (pending.length > 0 || running.some(Boolean)); day++) {
    // A bonus granted today goes to the research under way (assumed: in game it applies at once),
    // in slot order, to the techs it matches that have no bonus yet, while it has uses left.
    // Techs that start today choose their own bonus below.
    for (const bonus of env.bonuses) {
      if (dayOf(bonus.date) !== day) continue
      for (const r of running) {
        if ((bonusUses.get(bonusKey(bonus)) ?? 0) >= bonus.uses) break
        if (!r || r.bonus || !bonusMatches(bonus, r.entry.tech)) continue
        r.bonus = bonus
        r.bonusApplied = day
        r.issues = r.issues.filter((issue) => issue.kind !== 'bonus-unavailable')
        bonusUses.set(bonusKey(bonus), (bonusUses.get(bonusKey(bonus)) ?? 0) + 1)
      }
    }
    const slots = valueAt(slotsByDay, day, 0)
    for (let slot = 0; slot < slots; slot++) {
      if (running[slot] || pending.length === 0) continue
      const next = pending.findIndex((entry) => canStart(entry, day))
      if (next !== -1) running[slot] = begin(pending.splice(next, 1)[0], day)
    }

    const speed = valueAt(speedByDay, day, 0)
    const today = addDays(startDate, day)
    running.forEach((r, slot) => {
      if (!r) return
      const { tech } = r.entry
      const { penalty } = aheadOfTime(tech, today, r.bonus?.ahead ?? 0, defines)
      const bonus =
        (r.bonus?.bonus ?? 0) + categoryBonusAt(env, tech, today) + (r.designTeam?.bonus ?? 0)
      const speedFactor = Math.max(defines.minSpeed, 1 + speed + bonus)
      r.progress += speedFactor / (defines.baseCost * tech.cost * penalty)
      if (r.progress < 1 - EPSILON) return
      const end = addDays(startDate, day + 1)
      scheduled[r.entry.index] = {
        index: r.entry.index,
        techId: tech.id,
        slot,
        start: addDays(startDate, r.start),
        end,
        days: day + 1 - r.start,
        designTeam: r.designTeam?.id,
        bonusUsed: r.bonus?.ref,
        bonusApplied: r.bonusApplied === undefined ? undefined : addDays(startDate, r.bonusApplied),
        ahead: r.ahead,
        issues: r.issues,
      }
      if (r.designTeam) {
        busyTeams.delete(r.designTeam.id)
        teamUses.push({ mio: r.designTeam.id, start: addDays(startDate, r.start), end })
      }
      doneAt.set(tech.id, end)
      running[slot] = undefined
    })
  }

  // What never got going, and why.
  for (const r of running) {
    if (!r) continue
    unscheduled.push({ index: r.entry.index, techId: r.entry.tech.id, reason: 'out-of-time' })
    if (r.designTeam) {
      teamUses.push({
        mio: r.designTeam.id,
        start: addDays(startDate, r.start),
        end: options.until,
      })
    }
  }
  for (const { index, tech } of pending) {
    const blocked = tech.exclusiveWith.some((id) => started.has(id) || doneAt.has(id))
    const unreachable = tech.prerequisites.some((group) => !group.some((id) => doneAt.has(id)))
    const reason = blocked ? 'xor-blocked' : unreachable ? 'missing-prerequisite' : 'out-of-time'
    unscheduled.push({ index, techId: tech.id, reason })
  }

  return {
    items: scheduled.filter((s): s is ScheduledResearch => s !== undefined),
    unscheduled: unscheduled.sort((a, b) => a.index - b.index),
    researchedBy: (date) =>
      new Set([...doneAt].flatMap(([id, when]) => (when <= date ? [id] : []))),
    designTeams: teamUses.sort((a, b) => a.start.getTime() - b.start.getTime()),
  }
}

/**
 * When a tech added to the end of the queue would get a research slot: the earliest day one is
 * free, which is after the last tech planned in it, and not before the slot exists (focuses add
 * them). With no slot at all it is `undefined`. It ignores gaps between techs, where a slot waits
 * on a prerequisite, and what the new tech itself needs first.
 */
export const earliestFreeSlot = (
  schedule: Pick<ResearchSchedule, 'items'>,
  env: Pick<ResearchEnvironment, 'slots'>,
  startDate: Date,
): Date | undefined => {
  const slots = [...env.slots].sort((a, b) => a.date.getTime() - b.date.getTime())
  const count = Math.max(0, ...slots.map((s) => s.total))
  let earliest: Date | undefined
  for (let slot = 0; slot < count; slot++) {
    const exists = slots.find((s) => s.total > slot)!.date
    const busyUntil = schedule.items.reduce(
      (latest, item) => (item.slot === slot && item.end > latest ? item.end : latest),
      startDate,
    )
    const free = busyUntil > exists ? busyUntil : exists
    if (!earliest || free < earliest) earliest = free
  }
  return earliest
}

/** The MIOs that can be the design team of a tech: one of its categories is theirs. */
export const designTeamsFor = (tech: Pick<Technology, 'categories'>, mios: MioData[]): MioData[] =>
  mios.filter((mio) => mio.researchCategories.some((c) => tech.categories.includes(c)))

/**
 * The bonuses a queued tech can be given: the ones that apply to it, have been granted by the
 * day it starts, and have a use left after the techs that start before it. A tech that is not
 * scheduled is offered every bonus that applies to it.
 */
export const availableBonuses = (
  tech: Technology,
  index: number,
  schedule: ResearchSchedule,
  env: ResearchEnvironment,
): ResearchBonus[] => {
  const self = schedule.items.find((item) => item.index === index)
  return env.bonuses.filter((bonus) => {
    if (!bonusMatches(bonus, tech)) return false
    if (!self) return true
    // One applied while the tech was being researched stays on offer.
    if (sameBonus(self.bonusUsed, bonus.ref)) return true
    if (bonus.date > self.start) return false
    const usedBefore = schedule.items.filter(
      (other) =>
        other.index !== index &&
        sameBonus(other.bonusUsed, bonus.ref) &&
        (other.start < self.start ||
          (other.start.getTime() === self.start.getTime() && other.index < index)),
    ).length
    return usedBefore < bonus.uses
  })
}
