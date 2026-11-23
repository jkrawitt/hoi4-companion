/**
 * Party popularity: how a change to one party is shared out among the others, and how a daily
 * drift is scaled by the popularity the party has.
 */
import { round } from '../numbers'
import { clampStat } from './totals'
import type { Working } from './working'

/**
 * Moves one party's popularity by `delta` (a fraction) and keeps the total at 100%: the others
 * share the change in proportion to what they have (evenly if they have none), and the party
 * itself stays between 0 and 100%. Only the parties already in `w.popularity` take part, which is
 * all of them once the start has set them.
 */
export const shiftPopularity = (w: Working, subject: string, delta: number): void => {
  const mine = w.popularity.get(subject)
  if (!mine) return
  const others = [...w.popularity.values()].filter((p) => p.subject !== subject)
  const next = others.length === 0 ? mine.total + delta : clampStat(mine.total + delta)
  w.popularity.set(subject, { ...mine, total: round(next) })
  const rest = others.reduce((sum, p) => sum + p.total, 0)
  for (const other of others) {
    const share = rest > 0 ? other.total / rest : 1 / others.length
    w.popularity.set(other.subject, { ...other, total: round((1 - next) * share) })
  }
}

/**
 * A party above 20% popularity drifts up at half its daily drift, and above 30% at a third
 * (checked in game on Finland: fascism 19% at the start, 20.80% on 1 March with Susitaival's
 * `fascism_drift`, 26.30% on 11 March after the coup focus, 32.21% on 29 July; an `add_popularity`
 * effect is not scaled). The thresholds are read from those cases; what happens past 40% is not
 * known, so a third is kept. Losses are not scaled.
 */
export const DRIFT_SCALES: { above: number; scale: number }[] = [
  { above: 0.2, scale: 1 / 2 },
  { above: 0.3, scale: 1 / 3 },
]

/** What a daily drift of `delta` really does to a party that has `current`. */
export const scaledDrift = (current: number, delta: number): number => {
  if (delta <= 0) return delta
  const tier = DRIFT_SCALES.filter((t) => current > t.above).pop()
  return tier ? delta * tier.scale : delta
}
