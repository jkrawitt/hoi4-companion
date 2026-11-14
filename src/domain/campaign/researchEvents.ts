/**
 * What the rewards applied so far have done for research, kept as dated events so the research
 * planner can replay them: slots, research speed, bonuses and technologies handed out.
 * `applyReward.ts` records them as it goes and `researchEnvironment` turns them into the
 * `ResearchEnvironment` the planner takes.
 */
import type { ResearchBonus, ResearchEnvironment } from '../research'
import { activeModifiers } from './totals'
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

/**
 * The research speed factor over time. It changes when a reward does, and when a timed idea runs
 * out, which is why every `until` is a date of its own.
 */
const speedOverTime = (snapshots: ResearchWorking['snapshots']): ResearchEnvironment['speed'] => {
  const times = new Set<number>()
  for (const s of snapshots) {
    times.add(s.date.getTime())
    for (const idea of s.ideas) if (idea.until) times.add(idea.until.getTime())
  }
  return [...times]
    .sort((a, b) => a - b)
    .flatMap((time) => {
      const date = new Date(time)
      const latest = snapshots.filter((s) => s.date <= date).pop()
      if (!latest) return []
      const active = latest.ideas.filter((idea) => !idea.until || idea.until > date)
      const factor = activeModifiers(active, latest.traits).totals.get(SPEED_KEY)?.total ?? 0
      return [{ date, factor }]
    })
}

export const researchEnvironment = (r: ResearchWorking): ResearchEnvironment => ({
  startTechs: r.startTechs,
  slots: r.slots,
  speed: speedOverTime(r.snapshots),
  grants: r.grants,
  bonuses: r.bonuses,
})
