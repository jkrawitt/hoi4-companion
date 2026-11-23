/**
 * What the rewards applied so far have done for research, kept as dated events so the research
 * planner can replay them: slots, research speed, bonuses and technologies handed out.
 * `applyReward.ts` records them as it goes and `researchEnvironment` turns them into the
 * `ResearchEnvironment` the planner takes.
 */
import type { ResearchBonus, ResearchEnvironment } from '../research'
import { round } from '../numbers'
import { activeModifiers } from './totals'
import { changePoints } from './snapshots'
import type { StateSnapshot } from './types'

/** The key of the stat that changes research speed. */
const SPEED_KEY = 'research_speed_factor'

export interface ResearchWorking {
  startTechs: string[]
  grants: ResearchEnvironment['grants']
  bonuses: ResearchBonus[]
  slots: ResearchEnvironment['slots']
  /** The ideas and leader traits in force after each reward, to work out the speed on any date. */
  snapshots: StateSnapshot[]
}

export const newResearchWorking = (): ResearchWorking => ({
  startTechs: [],
  grants: [],
  bonuses: [],
  slots: [],
  snapshots: [],
})

/** Records what a reward finished on `date` left the country with: its slots and its modifiers. */
export const recordResearchState = (
  r: ResearchWorking,
  date: Date,
  slots: number,
  snapshot: Omit<StateSnapshot, 'date'>,
) => {
  if (r.slots[r.slots.length - 1]?.total !== slots) r.slots.push({ date, total: slots })
  r.snapshots.push({ date, ...snapshot })
}

/** The change points (see `changePoints`) once the first reward has been applied. */
const pointsOf = (snapshots: StateSnapshot[]) =>
  changePoints(snapshots).filter((point) => point.snapshot !== undefined)

/**
 * The research speed factor over time. It changes when a reward does, and when a timed idea runs
 * out, which is why every `until` is a date of its own.
 */
const speedOverTime = (snapshots: ResearchWorking['snapshots']): ResearchEnvironment['speed'] =>
  pointsOf(snapshots).map(({ date, ideas, traits }) => ({
    date,
    factor: activeModifiers(ideas, traits).totals.get(SPEED_KEY)?.total ?? 0,
  }))

/** The research bonus per category over time, from the designers' `research_bonus`. */
const categorySpeedOverTime = (
  snapshots: ResearchWorking['snapshots'],
): NonNullable<ResearchEnvironment['categorySpeed']> =>
  pointsOf(snapshots).map(({ date, ideas }) => {
    const bonuses: Record<string, number> = {}
    for (const idea of ideas) {
      for (const [category, bonus] of Object.entries(idea.researchBonus ?? {})) {
        bonuses[category] = round((bonuses[category] ?? 0) + bonus)
      }
    }
    return { date, bonuses }
  })

export const researchEnvironment = (r: ResearchWorking): ResearchEnvironment => ({
  startTechs: r.startTechs,
  slots: r.slots,
  speed: speedOverTime(r.snapshots),
  categorySpeed: categorySpeedOverTime(r.snapshots),
  grants: r.grants,
  bonuses: r.bonuses,
})
