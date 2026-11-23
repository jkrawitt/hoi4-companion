/**
 * Party drift: a modifier such as `fascism_drift = 0.1` (an advisor trait, a leader trait, a
 * national spirit) adds that many percentage points to the party's popularity every day it is
 * active, taken from the other parties like any popularity change (`shiftPopularity`).
 *
 * The balance of power drifts here too: see `weeklyScript` and `driftBalance`.
 *
 * The country state works out the drift in between its events: from one reward or purchase to the
 * next, and up to the date asked for, one day at a time. The drift in force changes only when an
 * idea is added, removed or runs out, or the balance of power moves into another range, so the
 * totals are taken again then and not before. That makes the result the same however the time is
 * split into calls (`accrueDrift(a, b)` then `accrueDrift(b, c)` is `accrueDrift(a, c)`), which the
 * country simulation relies on to carry on from a checkpoint.
 */
import { rangeAt } from '../balanceOfPower'
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
 * The first weekly script runs this many days after the start (checked in game on Finland: the
 * public trust holds until 4 January, then falls 0.14 a day). Its rules then hold for a week.
 */
const FIRST_WEEKLY_DAY = 3

/**
 * The weekly script on the day `at`: the rules of the ruling
 * leader that hold now stay in force until the next one. Not a move of the balance itself.
 */
const weeklyScript = (w: Working, options: CountryStateOptions, at: Date): void => {
  const bop = options.balanceOfPower
  const leader = w.identity?.character
  if (!bop?.weekly) return
  const ctx = conditionContext(w, options, at)
  w.bopRules = leader
    ? bop.weekly
        .filter((rule) => rule.leader === leader)
        .filter((rule) => !rule.when || evaluateCheck(rule.when, ctx) === true)
    : []
}

/**
 * The balance of power moves a seventh of the weekly drift of the rules in force each day (checked
 * in game: -0.01 a week is about 0.14 a day on the screen's 100-point scale). When that takes the
 * balance into another range, the range's modifiers change from this day on (`balanceChanges`, and
 * a snapshot for the planners).
 */
const driftBalance = (w: Working, options: CountryStateOptions, at: Date): void => {
  const bop = options.balanceOfPower
  if (!bop || w.balance === undefined || w.bopRules.length === 0) return
  const delta = w.bopRules.reduce((sum, rule) => sum + rule.weekly, 0) / DAYS_PER_WEEK
  const before = rangeAt(bop, w.balance)
  // Not rounded each day, so a seventh of 0.01 does not add up an error over a long game.
  w.balance = Math.min(1, Math.max(-1, w.balance + delta))
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
      let drift = driftOn(w, a)
      for (let d = 0; d < days; d++) {
        for (const [subject, perDay] of drift) {
          shiftPopularity(w, subject, scaledDrift(w.popularity.get(subject)?.total ?? 0, perDay))
        }
        // The weekly script runs on day 3 and every 7th day after; the balance drifts daily.
        if (origin !== undefined) {
          const daysIn = wholeDay(a) + d + 1 - origin
          const day = addDays(options.startDate!, daysIn)
          if (daysIn >= FIRST_WEEKLY_DAY && (daysIn - FIRST_WEEKLY_DAY) % DAYS_PER_WEEK === 0) {
            weeklyScript(w, options, day)
          }
          const ranges = w.balanceChanges.length
          driftBalance(w, options, day)
          // A new range may carry a drift of its own (or end one) from the next day on.
          if (w.balanceChanges.length !== ranges) drift = driftOn(w, a)
        }
      }
    }
    a = edge
  }
}
