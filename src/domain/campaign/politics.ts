/**
 * Planning political power against the campaign. The purchase queue (laws, designers, advisors)
 * is worked through in order: each item is bought the first day the political power is there and
 * it is available, and the next item waits behind it (the power is saved up in order).
 *
 * The planner reuses `simulateCountry` (`countryStateAt`, kept running) rather than a second model
 * of the country. The gain is
 * constant until the country changes (a focus ends, a timed idea runs out, a purchase), so it
 * jumps from change to change: at each one it asks the state what is held, available and costs
 * what, and works out the day the head of the queue becomes affordable. If that day comes before
 * the next change it is bought then, and the purchase is added to the state (as an `extraStep`)
 * before looking further. Political power is the gain summed over the time, capped, plus what
 * focuses add (`add_political_power`), minus what was spent. The gain formula is not verified
 * against the game (see `plan/politicsPlan.ts`).
 */
import type { PoliticalOption, PoliticsData, PoliticsItem, PoliticsSchedule } from '../politics'
import type { PurchaseIssue, ScheduledPurchase, UnscheduledPurchase } from '../politics'
import type { EffectLine } from '../focus'
import type { FocusSchedule } from '../plan/types'
import { dailyGain, purchaseCost, replacedBy, slotHasRoom, totalsOf } from '../plan/politicsPlan'
import { addDays, daysBetween, parseDay } from '../calendar'
import type { Step } from './applyReward'
import { changesWithoutEvents, evaluateCheck } from './conditions'
import { countryConditions, factsOfState } from './countryConditions'
import { simulateCountry } from './countryState'
import type { CountryState, CountryStateOptions } from './types'

export interface PoliticsPlanInput {
  focusSchedule: FocusSchedule
  /** What `countryStateAt` takes (tag, start, leaders, ownedDlc, hasTech). */
  options: CountryStateOptions
  queue: PoliticsItem[]
  data?: PoliticsData
  startDate: Date
  /** How far to look for purchases. */
  until: Date
  /** When design teams (MIOs assigned to research) are in use; each costs political power a day. */
  designTeams?: { start: Date; end: Date }[]
}

export interface PlannedPolitics extends PoliticsSchedule {
  /** The purchases as rewards, for `countryStateAt`'s `extraSteps`. */
  steps: Step[]
}

/** The reward a purchase (or a dismissal) is, for the country state to apply. */
export const purchaseEffects = (option: PoliticalOption, dismiss: boolean): EffectLine[] =>
  option.kind === 'decision'
    ? option.modifiers.map((line) => ({ ...line }))
    : dismiss
      ? [{ depth: 0, key: 'remove_ideas', value: option.id, valueName: option.name }]
      : [
          {
            depth: 0,
            key: 'add_ideas',
            value: option.id,
            valueName: option.name,
            slot: option.slot,
            ...(option.researchBonus && { researchBonus: option.researchBonus }),
          },
          ...option.modifiers.map((line) => ({ ...line, depth: line.depth + 1 })),
        ]

/** What happens to the head of the queue in the country as it is right now. */
type Outcome =
  | { kind: 'skip'; reason: UnscheduledPurchase['reason'] }
  | { kind: 'already' }
  /** Not possible yet; maybe after the next change. */
  | { kind: 'wait'; reason: UnscheduledPurchase['reason'] }
  | { kind: 'buy'; cost: number; days: number; issues: PurchaseIssue[] }

export const planPolitics = (input: PoliticsPlanInput): PlannedPolitics => {
  const { focusSchedule, options, queue, data, startDate, until } = input
  const items: ScheduledPurchase[] = []
  const unscheduled: UnscheduledPurchase[] = []
  const steps: Step[] = []
  if (!data) {
    return {
      items,
      unscheduled,
      steps,
      balanceAt: () => 0,
      gainAt: () => 0,
      designTeamsAt: () => 0,
    }
  }
  const byId = new Map(data.options.map((o) => [o.id, o]))
  const { cap, designTeamCost } = data.defines
  const teams = input.designTeams ?? []
  /** How many design teams are in use on a date: from the day their research starts until it ends. */
  const teamsAt = (date: Date) => teams.filter((u) => u.start <= date && date < u.end).length

  // One running country for all the dates asked about; a purchase is added to it as it is made.
  const sim = simulateCountry(focusSchedule, { ...options, politics: data, extraSteps: [] })
  const stateAt = (date: Date) => sim.at(date)
  const lumpOf = (state: CountryState) =>
    state.statChanges.find((s) => s.key === 'add_political_power')?.total ?? 0
  /** The gain on the day `t`: the modifiers' gain less what the design teams in use cost. */
  const gainOf = (state: CountryState) =>
    dailyGain(totalsOf(state.modifierTotals), data.defines, state.stability) -
    designTeamCost * teamsAt(t)

  let t = startDate
  let state = stateAt(t)
  let lump = lumpOf(state)
  let gain = gainOf(state)
  // Checked in game (Romania and Finland): the country shows its first day's gain on 1 January
  // (1 PP for Finland's 1.798, 2 for Romania's 2.076), and picking the first focus takes that
  // day's focus cost from it (0 for Finland, 1 for Romania). So the balance starts at the net
  // gain, which already has the focus cost taken off.
  let balance = lump + gain
  /** The balance and gain from each moment the country changed, to work out any date from. */
  const points = [{ date: t, balance, gain }]

  /** Lets the time pass to `to` (the gain is constant until then) and takes the new state. */
  const moveTo = (to: Date) => {
    balance = Math.min(cap, balance + gain * daysBetween(t, to))
    t = to
    state = stateAt(t)
    const lumpNow = lumpOf(state)
    balance += lumpNow - lump
    lump = lumpNow
    gain = gainOf(state)
    points.push({ date: t, balance, gain })
  }

  /**
   * The days the balance of power's weekly drift changes the range (and so the gain), looked up
   * to the end of the time looked at. They depend on what is bought, so they are worked out again
   * after each purchase.
   */
  let balanceChanges: { purchases: number; days: Date[] } | undefined
  const driftChanges = (): Date[] => {
    if (balanceChanges?.purchases !== steps.length) {
      balanceChanges = { purchases: steps.length, days: stateAt(until).balanceChanges }
    }
    return balanceChanges.days
  }

  /** The next time the country changes, within the time looked at. */
  const nextChange = (): Date | undefined => {
    const times = [
      ...driftChanges(),
      ...(state.next ? [state.next.end] : []),
      // What the player entered from the game changes the gain on its day.
      ...(options.adjustments ?? []).map((step) => step.end),
      // A design team starts or stops costing political power.
      ...teams.flatMap((u) => [u.start, u.end]),
      ...state.ideas.flatMap((idea) => (idea.until && idea.until > t ? [idea.until] : [])),
    ].filter((d) => d > t && d <= until)
    return times.length > 0 ? new Date(Math.min(...times.map((d) => d.getTime()))) : undefined
  }

  /** The decisions taken so far, for `fire_only_once`. */
  const taken = new Set<string>()

  const assess = (option: PoliticalOption, dismiss: boolean): Outcome => {
    const isDecision = option.kind === 'decision'
    if (isDecision && (dismiss || (option.fireOnce && taken.has(option.id)))) {
      return { kind: 'skip', reason: dismiss ? 'not-held' : 'already-taken' }
    }
    // A decision is never held as an idea; it can be taken again unless it fires only once.
    const held = !isDecision && state.ideas.some((idea) => idea.id === option.id)
    if (dismiss)
      return held
        ? { kind: 'buy', cost: 0, days: 0, issues: [] }
        : { kind: 'skip', reason: 'not-held' }
    if (held) return { kind: 'already' }
    if (option.kind === 'advisor') {
      if (state.leader?.character === option.character) return { kind: 'skip', reason: 'is-leader' }
      if (!state.politics.recruited.includes(option.character ?? '')) {
        return { kind: 'wait', reason: 'not-recruited' }
      }
      const inSlot = state.politics.held[option.slot]?.length ?? 0
      if (!slotHasRoom(option, inSlot, data.slots)) return { kind: 'skip', reason: 'slots-full' }
    }
    const issues: PurchaseIssue[] = []
    if (option.available) {
      const holds = evaluateCheck(
        option.available,
        countryConditions(factsOfState(state), options, { assumePeace: true }),
      )
      if (holds === false) return { kind: 'wait', reason: 'unavailable' }
      if (holds === undefined) issues.push({ kind: 'availability-unknown' })
    }
    if (option.variableCost) issues.push({ kind: 'cost-unknown' })
    const inSlotNow = isDecision
      ? []
      : (state.politics.held[option.slot] ?? []).map((idea) => idea.id)
    const current = replacedBy(option, inSlotNow, data.options)
    const cost = purchaseCost(option, totalsOf(state.modifierTotals), current)
    const need = cost - balance
    if (need <= 0) return { kind: 'buy', cost, days: 0, issues }
    if (gain <= 0 || cost > cap) return { kind: 'wait', reason: 'unaffordable' }
    return { kind: 'buy', cost, days: Math.ceil(need / gain), issues }
  }

  /**
   * The first day after now, before `limit`, on which an option's `available` no longer fails.
   * Popularity and stability move every day with no event, so the days are looked at a week at a
   * time and the week it turns in is then looked at day by day.
   */
  const firstDayAvailable = (option: PoliticalOption, limit: Date): Date | undefined => {
    if (!option.available) return undefined
    const check = option.available
    // What no passing day can change is only settled by a change of the country, looked at anyway.
    if (!changesWithoutEvents(check)) return undefined
    const open = (day: Date) =>
      evaluateCheck(
        check,
        countryConditions(factsOfState(stateAt(day)), options, { assumePeace: true }),
      ) !== false
    let before = t
    for (let day = addDays(t, 7); before < limit; day = addDays(day, 7)) {
      const end = day < limit ? day : limit
      if (open(end)) {
        for (let d = addDays(before, 1); d <= end; d = addDays(d, 1)) if (open(d)) return d
      }
      before = end
    }
    return undefined
  }

  queue.forEach((item, index) => {
    const option = byId.get(item.optionId)
    const dismiss = item.dismiss === true
    const leave = (reason: UnscheduledPurchase['reason']) =>
      unscheduled.push({ index, optionId: item.optionId, reason })
    if (!option) return leave('unknown-option')
    const notBefore = item.notBefore ? parseDay(item.notBefore) : undefined

    for (;;) {
      const outcome = assess(option, dismiss)
      if (outcome.kind === 'skip') return leave(outcome.reason)
      if (outcome.kind === 'already') {
        items.push({
          index,
          id: item.id,
          optionId: option.id,
          dismiss,
          date: t,
          cost: 0,
          balanceAfter: balance,
          issues: [{ kind: 'already-held' }],
        })
        return
      }
      const change = nextChange()
      if (outcome.kind === 'wait') {
        // What is not available yet may become so by itself: a party's popularity drifting over a
        // threshold is no change of the country, so look for that day before the next change.
        const day =
          outcome.reason === 'unavailable' ? firstDayAvailable(option, change ?? until) : undefined
        const to = day && (!change || day < change) ? day : change
        if (!to) return leave(outcome.reason)
        moveTo(to)
        continue
      }
      let when = addDays(t, outcome.days)
      if (notBefore && notBefore > when) when = notBefore
      if (change && when >= change) {
        // A change comes first (a focus may make the option available or cost less): look again then.
        moveTo(change)
        continue
      }
      if (when > until) return leave('out-of-time')
      if (when > t) moveTo(when)
      balance -= outcome.cost
      taken.add(option.id)
      const step: Step = {
        focus: {
          id: `politics:${index}`,
          name: option.name,
          effects: purchaseEffects(option, dismiss),
        },
        end: t,
      }
      steps.push(step)
      sim.addStep(step)
      state = stateAt(t)
      gain = gainOf(state)
      points.push({ date: t, balance, gain })
      items.push({
        index,
        id: item.id,
        optionId: option.id,
        dismiss,
        date: t,
        cost: outcome.cost,
        balanceAfter: balance,
        issues: outcome.issues,
      })
      return
    }
  })

  // Carry on to the end of what the focuses change, so the balance is known for every date.
  for (let change = nextChange(); change; change = nextChange()) moveTo(change)

  const pointAt = (date: Date) => [...points].reverse().find((p) => p.date <= date) ?? points[0]
  return {
    items,
    unscheduled: unscheduled.sort((a, b) => a.index - b.index),
    steps,
    balanceAt: (date) => {
      const p = pointAt(date)
      const elapsed = Math.max(0, daysBetween(p.date, date))
      return Math.min(cap, p.balance + p.gain * elapsed)
    },
    gainAt: (date) => pointAt(date).gain,
    designTeamsAt: teamsAt,
  }
}
