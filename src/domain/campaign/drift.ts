/**
 * Party drift: a modifier such as `fascism_drift = 0.1` (an advisor trait, a leader trait, a
 * national spirit) adds that many percentage points to the party's popularity every day it is
 * active, taken from the other parties like any popularity change (`shiftPopularity`).
 *
 * The balance of power drifts here too, once a week: see `weeklyBalanceDrift`.
 *
 * The country state works out the drift in between its events: from one reward or purchase to the
 * next, and up to the date asked for, one day at a time. The drift in force changes only when an
 * idea is added, removed or runs out, so the totals are taken once per stretch between those.
 */
import { clampBalance, rangeAt } from '../balanceOfPower'
import { addDays, wholeDay } from '../calendar'
import {
  conditionContext,
  scaledDrift,
  shiftPopularity,
  stabilityBeforeModifiersNow,
  syncBalanceOfPower,
  type Working,
} from './applyReward'
import { evaluateCheck } from './conditions'
import { recordResearchState } from './researchEvents'
import { activeModifiers } from './totals'
import type { CountryStateOptions } from './types'

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

/** The days between the weekly scripts (`on_weekly_<TAG>`). */
const DAYS_PER_WEEK = 7

/**
 * The balance of power's weekly drift on the day `at`, 7 days into the game and every 7 days
 * after (an assumption: not checked in game). The rules of the ruling leader that hold now each
 * add their `weekly`; when that takes the balance into another range, the range's modifiers
 * change from this day on (`Working.balanceChanges`, and a snapshot for the planners).
 */
const weeklyBalanceDrift = (w: Working, options: CountryStateOptions, at: Date): void => {
  const bop = options.balanceOfPower
  const leader = w.identity?.character
  if (!bop?.weekly || w.balance === undefined || !leader) return
  const ctx = conditionContext(w, options, at)
  const delta = bop.weekly
    .filter((rule) => rule.leader === leader)
    .filter((rule) => !rule.when || evaluateCheck(rule.when, ctx) === true)
    .reduce((sum, rule) => sum + rule.weekly, 0)
  if (delta === 0) return
  const before = rangeAt(bop, w.balance)
  w.balance = clampBalance(w.balance + delta)
  const source = w.ideas.get(`bop:${bop.id}`)
  syncBalanceOfPower(w, options, {
    focusId: source?.focusId ?? `bop:${bop.id}`,
    focusName: source?.focusName ?? bop.name,
    end: at,
  })
  if (rangeAt(bop, w.balance)?.id !== before?.id) {
    w.balanceChanges.push(at)
    recordResearchState(w.research, at, w.statChanges.get('add_research_slot')?.total ?? 0, {
      ideas: [...w.ideas.values()],
      traits: w.leader?.traits ?? [],
      stabilityBeforeModifiers: stabilityBeforeModifiersNow(w, options),
    })
  }
}

/** Lets the popularity drift from `from` to `to`: one tick for each midnight passed. */
export const accrueDrift = (
  w: Working,
  from: Date,
  to: Date,
  options: CountryStateOptions,
): void => {
  if (wholeDay(to) <= wholeDay(from)) return
  const expiries = [...w.ideas.values()]
    .flatMap((idea) => (idea.until && idea.until > from && idea.until < to ? [idea.until] : []))
    .sort((a, b) => a.getTime() - b.getTime())
  const origin = options.startDate ? wholeDay(options.startDate) : undefined
  let a = from
  for (const edge of [...expiries, to]) {
    const days = wholeDay(edge) - wholeDay(a)
    if (days > 0) {
      const drift = driftOn(w, a)
      for (let d = 0; d < days; d++) {
        for (const [subject, perDay] of drift) {
          shiftPopularity(w, subject, scaledDrift(w.popularity.get(subject)?.total ?? 0, perDay))
        }
        // The weekly script: every 7th day since the start.
        if (origin !== undefined) {
          const day = wholeDay(a) + d + 1
          if ((day - origin) % DAYS_PER_WEEK === 0) {
            weeklyBalanceDrift(w, options, addDays(options.startDate!, day - origin))
          }
        }
      }
    }
    a = edge
  }
}
