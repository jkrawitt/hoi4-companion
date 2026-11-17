/**
 * The country between rewards, for the planners that need it on any date: `applyReward.ts` keeps a
 * `StateSnapshot` after each reward, and `changePoints` turns them into the dates something can
 * change on, with what is in force then.
 */
import type { ActiveIdea, StateSnapshot } from './types'
import type { EffectLine } from '../focus'

export interface ChangePoint {
  date: Date
  /** The latest snapshot on or before the date; undefined before the first one. */
  snapshot?: StateSnapshot
  /** Its ideas that have not run out by the date. */
  ideas: ActiveIdea[]
  traits: EffectLine[]
}

/**
 * Each date the country's ideas change (a reward, or a timed idea running out), plus `extra` dates
 * a caller needs (research finishing, the start), in order, with what is active on each.
 */
export const changePoints = (snapshots: StateSnapshot[], extra: Date[] = []): ChangePoint[] => {
  const times = new Set<number>(extra.map((d) => d.getTime()))
  for (const s of snapshots) {
    times.add(s.date.getTime())
    for (const idea of s.ideas) if (idea.until) times.add(idea.until.getTime())
  }
  return [...times]
    .sort((a, b) => a - b)
    .map((time) => {
      const date = new Date(time)
      const snapshot = snapshots.filter((s) => s.date <= date).pop()
      const ideas = (snapshot?.ideas ?? []).filter((idea) => !idea.until || idea.until > date)
      return { date, snapshot, ideas, traits: snapshot?.traits ?? [] }
    })
}
