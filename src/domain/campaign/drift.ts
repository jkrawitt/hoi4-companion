/**
 * Party drift: a modifier such as `fascism_drift = 0.1` (an advisor trait, a leader trait, a
 * national spirit) adds that many percentage points to the party's popularity every day it is
 * active, taken from the other parties like any popularity change (`shiftPopularity`).
 *
 * The country state works out the drift in between its events: from one reward or purchase to the
 * next, and up to the date asked for, one day at a time. The drift in force changes only when an
 * idea is added, removed or runs out, so the totals are taken once per stretch between those.
 */
import { wholeDay } from '../calendar'
import { shiftPopularity, type Working } from './applyReward'
import { activeModifiers } from './totals'

/** The drift of each party (a fraction a day) of the ideas and leader traits active on `day`. */
const driftOn = (w: Working, day: Date): Map<string, number> => {
  const ideas = [...w.ideas.values()].filter((idea) => !idea.until || idea.until > day)
  const { totals } = activeModifiers(ideas, w.leader?.traits ?? [])
  const drift = new Map<string, number>()
  for (const subject of w.popularity.keys()) {
    const total = totals.get(`${subject}_drift`)?.total
    if (total) drift.set(subject, total / 100)
  }
  return drift
}

/** Lets the popularity drift from `from` to `to`: one tick for each midnight passed. */
export const accrueDrift = (w: Working, from: Date, to: Date): void => {
  if (w.popularity.size === 0 || wholeDay(to) <= wholeDay(from)) return
  const expiries = [...w.ideas.values()]
    .flatMap((idea) => (idea.until && idea.until > from && idea.until < to ? [idea.until] : []))
    .sort((a, b) => a.getTime() - b.getTime())
  let a = from
  for (const edge of [...expiries, to]) {
    const days = wholeDay(edge) - wholeDay(a)
    if (days > 0) {
      const drift = driftOn(w, a)
      for (let d = 0; d < days; d++) {
        for (const [subject, perDay] of drift) shiftPopularity(w, subject, perDay)
      }
    }
    a = edge
  }
}
