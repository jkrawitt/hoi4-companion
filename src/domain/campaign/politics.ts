/**
 * Planning political power against the campaign. The purchase queue (laws, designers, advisors)
 * is worked through in order: each item is bought the first day the political power is there and
 * it is available, and the next item waits behind it (the power is saved up in order).
 *
 * The planner reuses `countryStateAt` rather than a second model of the country. The gain is
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
import { addDays, daysBetween } from '../calendar'
import type { Step } from './applyReward'
import { evaluateCheck, type ConditionContext } from './conditions'
import { countryStateAt } from './countryState'
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
}

export interface PlannedPolitics extends PoliticsSchedule {
  /** The purchases as rewards, for `countryStateAt`'s `extraSteps`. */
  steps: Step[]
}

/** The reward a purchase (or a dismissal) is, for the country state to apply. */
export const purchaseEffects = (option: PoliticalOption, dismiss: boolean): EffectLine[] =>
  dismiss
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

/** What the campaign knows about the country in `state`, for an option's `available` block. */
const conditionsOf = (state: CountryState, options: CountryStateOptions): ConditionContext => {
  const known = Boolean(options.start?.length)
  return {
    hasIdea: (id) => state.ideas.some((idea) => idea.id === id),
    hasFocus: (id) => state.completed.some((item) => item.focus.id === id),
    hasTech: (id) => options.hasTech?.(id, state.date),
    leader: () =>
      state.leader ? { id: state.leader.id, character: state.leader.character } : undefined,
    government: () => state.government,
    popularity: (ideology) =>
      known ? (state.popularity.find((p) => p.subject === ideology)?.total ?? 0) : undefined,
    tag: options.tag,
    hasDlc: options.ownedDlc ? (id) => options.ownedDlc![id] === true : undefined,
    stat: (key) => (key === 'stability' ? state.stability : state.warSupport),
    // Wars are not planned: purchases are planned for peace.
    atWar: () => false,
  }
}

const parseDay = (text: string): Date => new Date(`${text}T00:00:00Z`)

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
    return { items, unscheduled, steps, balanceAt: () => 0, gainAt: () => 0 }
  }
  const byId = new Map(data.options.map((o) => [o.id, o]))
  const { cap } = data.defines

  const stateAt = (date: Date) =>
    countryStateAt(focusSchedule, date, { ...options, politics: data, extraSteps: steps })
  const lumpOf = (state: CountryState) =>
    state.statChanges.find((s) => s.key === 'add_political_power')?.total ?? 0
  const gainOf = (state: CountryState) =>
    dailyGain(totalsOf(state.modifierTotals), data.defines, state.stability)

  let t = startDate
  let state = stateAt(t)
  let lump = lumpOf(state)
  // Checked in game: the country shows one day's base gain on the first day, and picking the first
  // focus takes that day's focus cost from it (2 - 1 = 1 for Romania).
  let balance = lump + data.defines.baseGain - data.defines.focusCost
  let gain = gainOf(state)
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

  /** The next time the country changes, within the time looked at. */
  const nextChange = (): Date | undefined => {
    const times = [
      ...(state.next ? [state.next.end] : []),
      ...state.ideas.flatMap((idea) => (idea.until && idea.until > t ? [idea.until] : [])),
    ].filter((d) => d > t && d <= until)
    return times.length > 0 ? new Date(Math.min(...times.map((d) => d.getTime()))) : undefined
  }

  const assess = (option: PoliticalOption, dismiss: boolean): Outcome => {
    const held = state.ideas.some((idea) => idea.id === option.id)
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
      const holds = evaluateCheck(option.available, conditionsOf(state, options))
      if (holds === false) return { kind: 'wait', reason: 'unavailable' }
      if (holds === undefined) issues.push({ kind: 'availability-unknown' })
    }
    const inSlotNow = (state.politics.held[option.slot] ?? []).map((idea) => idea.id)
    const current = replacedBy(option, inSlotNow, data.options)
    const cost = purchaseCost(option, totalsOf(state.modifierTotals), current)
    const need = cost - balance
    if (need <= 0) return { kind: 'buy', cost, days: 0, issues }
    if (gain <= 0 || cost > cap) return { kind: 'wait', reason: 'unaffordable' }
    return { kind: 'buy', cost, days: Math.ceil(need / gain), issues }
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
        if (!change) return leave(outcome.reason)
        moveTo(change)
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
      steps.push({
        focus: {
          id: `politics:${index}`,
          name: option.name,
          effects: purchaseEffects(option, dismiss),
        },
        end: t,
      })
      state = stateAt(t)
      gain = gainOf(state)
      points.push({ date: t, balance, gain })
      items.push({
        index,
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
  }
}
