/**
 * What the plan has done to a country by a given date: the part of the app that turns the focus
 * plan (and, later, other planners) into one picture.
 *
 * A completed focus's reward counts as applied when it sits at the top level or inside a
 * `hidden_effect` (which still happens). Rewards inside `if`/`else`/`random_*` blocks may or may not
 * happen, so they are only listed (`conditional`). Rewards inside another country's scope or a
 * state scope change something other than this country and are skipped.
 *
 * This file only runs the rewards in order and totals the result. `applyReward.ts` is what one
 * reward does, `rewardScopes.ts` sorts its lines, and `types.ts` has the shapes.
 */
import { START_ID } from '../focus'
import { addDays, wholeDay } from '../calendar'
import type { FocusSchedule } from '../plan/types'
import { applyReward } from './applyReward'
import type { Step } from './applyReward'
import { newWorking, rawStatNow, stabilityBeforeModifiersNow, type Working } from './working'
import { accrueDrift } from './drift'
import { activeModifiers, clampStat } from './totals'
import { researchEnvironment } from './researchEvents'
import type { ResearchWorking } from './researchEvents'
import type { ResearchEnvironment } from '../research'
import type { ActiveIdea, CountryState, CountryStateOptions } from './types'

export type {
  ActiveIdea,
  BuildingTotal,
  ConditionalEffects,
  CountryLeader,
  CountryPolitics,
  CountryState,
  CountryStateOptions,
  PopularityChange,
  ResourceTotal,
  RuleValue,
  StatTotal,
} from './types'

/** The ideas that fill a politics slot, by slot. */
const heldBySlot = (ideas: ActiveIdea[]): Record<string, ActiveIdea[]> => {
  const held: Record<string, ActiveIdea[]> = {}
  for (const idea of ideas) if (idea.slot) (held[idea.slot] ??= []).push(idea)
  return held
}

/** One reward to apply, with where it came from (only a planned focus keeps its branches marked). */
interface Ordered {
  step: Step
  rank: number
  index: number
}

/**
 * How many days of drift are worked out between two checkpoints (see `simulateCountry`). A smaller
 * number makes going back cheaper and keeps more copies of the country; 28 keeps a 25-year search
 * to a few hundred.
 */
const CHECKPOINT_DAYS = 28

/** A copy of the working state that later steps will not change (see `simulateCountry`). */
export const cloneWorking = (w: Working): Working => ({
  ...w,
  // `addTo` adds to a total in place; every other map holds values that are replaced, not changed.
  statChanges: new Map([...w.statChanges].map(([key, total]) => [key, { ...total }])),
  ideas: new Map(w.ideas),
  popularity: new Map(w.popularity),
  conditional: w.conditional.slice(),
  focusEffects: { ...w.focusEffects },
  buildings: new Map(w.buildings),
  construction: w.construction.slice(),
  resources: new Map(w.resources),
  doneFocuses: new Set(w.doneFocuses),
  bypassed: new Set(w.bypassed),
  retiredLeaders: new Set(w.retiredLeaders),
  research: cloneResearch(w.research),
  recruited: new Set(w.recruited),
  flags: new Map(w.flags),
  balanceChanges: w.balanceChanges.slice(),
})

const cloneResearch = (r: ResearchWorking): ResearchWorking => ({
  startTechs: r.startTechs.slice(),
  grants: r.grants.slice(),
  bonuses: r.bonuses.slice(),
  slots: r.slots.slice(),
  snapshots: r.snapshots.slice(),
})

/** The country at a moment of the run: the working state, how far the steps went and the drift. */
interface Position {
  /** Everything up to and including this day is done (-Infinity before the start). */
  time: number
  w: Working
  /** The index of the next step to apply. */
  next: number
  /** The day the popularity has drifted up to; undefined until the first step. */
  driftFrom?: Date
}

const copyOf = (p: Position): Position => ({ ...p, w: cloneWorking(p.w) })

export interface CountrySimulation {
  /** The country on `date`, as `countryStateAt` gives it. */
  at: (date: Date) => CountryState
  /** Adds a reward that is not a focus (a purchase), like one more `extraSteps` entry. */
  addStep: (step: Step) => void
}

/**
 * The country on any dates, worked out once. `countryStateAt` replays the whole country from the
 * start, day by day, for every date asked; a planner that asks for hundreds of dates would take
 * minutes. This keeps one running country (the cursor) and moves it on for a later date, and goes
 * back from the nearest checkpoint for an earlier one. A checkpoint is a copy of the country taken
 * after every reward applied and every `CHECKPOINT_DAYS` of drift. `addStep` adds a purchase and
 * forgets the checkpoints from its day on, which is all it can change.
 *
 * The answer for a date is the same as `countryStateAt`'s, whatever order the dates come in
 * (`accrueDrift` gives the same result however the days are split). The states handed out are
 * copies: asking again does not change one given before.
 */
export const simulateCountry = (
  schedule: FocusSchedule,
  options: CountryStateOptions = {},
): CountrySimulation => {
  const extra: Step[] = [...(options.extraSteps ?? [])]
  const startDate = options.startDate
  const hasStart = Boolean(options.start?.length)
  // Without a start date the starting state is finished on the date asked for, so nothing before
  // it can be reused: each date is worked out from the beginning.
  const resumable = !hasStart || startDate !== undefined

  const stepsFor = (startEnd: Date | undefined): Ordered[] => {
    const start: Ordered[] =
      hasStart && startEnd
        ? [
            {
              step: {
                focus: { id: START_ID, name: 'Game start', effects: options.start! },
                end: startEnd,
              },
              rank: -1,
              index: 0,
            },
          ]
        : []
    // Purchases come in between the focuses by date; a focus goes first on the same day.
    const merged = [
      ...schedule.items.map((step, index) => ({ step, rank: 0, index })),
      ...extra.map((step, index) => ({ step, rank: 1, index })),
      ...(options.adjustments ?? []).map((step, index) => ({ step, rank: 2, index })),
    ].sort(
      (a, b) => a.step.end.getTime() - b.step.end.getTime() || a.rank - b.rank || a.index - b.index,
    )
    return [...start, ...merged]
  }

  const freshPosition = (): Position => {
    const w = newWorking()
    for (const option of options.politics?.options ?? []) {
      if (option.recruited && option.character) w.recruited.add(option.character)
    }
    return { time: -Infinity, w, next: 0 }
  }

  const stateFrom = (w: Working, date: Date): CountryState => {
    const completed = schedule.items.filter((item) => item.end <= date)
    const next = schedule.items.find((item) => item.end > date)
    const active = [...w.ideas.values()].filter((idea) => !idea.until || idea.until > date)

    const { totals: modifierTotals, rules } = activeModifiers(active, w.leader?.traits ?? [])
    // Only known once the start has set them, like popularity.
    const actual = (key: 'stability' | 'war_support') =>
      options.start?.length ? clampStat(rawStatNow(w, options, key, date)) : undefined

    const frozen = cloneResearch(w.research)
    let env: ResearchEnvironment | undefined
    // Nothing here is a container the running country goes on changing.
    return {
      date,
      completed,
      bypassed: [...w.bypassed],
      next,
      ideas: active,
      statChanges: [...w.statChanges.values()].map((total) => ({ ...total })),
      modifierTotals: [...modifierTotals.values()],
      rules: [...rules.values()],
      popularity: [...w.popularity.values()],
      rulingParty: w.rulingParty,
      enemies: w.enemies,
      government: w.government,
      stability: actual('stability'),
      stabilityBeforeModifiers: stabilityBeforeModifiersNow(w, options),
      warSupport: actual('war_support'),
      leader: w.leader,
      leaderIdentity: w.identity && { ...w.identity },
      flags: Object.fromEntries(w.flags),
      balance: w.balance,
      balanceChanges: w.balanceChanges.slice(),
      resources: [...w.resources.values()],
      buildings: [...w.buildings.values()],
      buildingSlots: w.buildingSlots,
      construction: w.construction.slice(),
      conditional: w.conditional.slice(),
      focusEffects: { ...w.focusEffects },
      snapshots: w.research.snapshots.slice(),
      politics: {
        held: heldBySlot(active),
        recruited: [...w.recruited],
      },
      // Worked out when first read: the planners that ask for hundreds of dates never read it.
      get research() {
        env ??= researchEnvironment(frozen)
        return env
      },
    }
  }

  /** Runs the country from `p` up to `target`: the rewards finished by then, with drift between. */
  const advance = (
    p: Position,
    steps: Ordered[],
    target: Date,
    keep: (copy: Position) => void,
  ): void => {
    const checkpoint = (time: number) => keep(copyOf({ ...p, time }))
    // The popularity drifts day by day from the start on, with what is active between rewards.
    const driftTo = (to: Date) => {
      while (p.driftFrom && to > p.driftFrom && wholeDay(to) > wholeDay(p.driftFrom)) {
        const stop = addDays(p.driftFrom, CHECKPOINT_DAYS)
        const edge = stop < to ? stop : to
        accrueDrift(p.w, p.driftFrom, edge, options)
        p.driftFrom = edge
        p.time = edge.getTime()
        if (edge < to) checkpoint(p.time)
      }
      // The rest of a day: nothing to drift, but the position has reached `to`.
      if (p.driftFrom && to > p.driftFrom) p.driftFrom = to
    }
    for (;;) {
      const due = steps[p.next]
      if (!due || due.step.end > target) break
      driftTo(due.step.end)
      applyReward(p.w, due.step, options, due.rank === 0)
      p.next++
      p.driftFrom = due.step.end
      p.time = due.step.end.getTime()
      checkpoint(p.time)
    }
    driftTo(target)
    if (target.getTime() > p.time) p.time = target.getTime()
  }

  if (!resumable) {
    // A start date is missing: each answer is its own run.
    return {
      at: (date) => {
        const p = freshPosition()
        advance(p, stepsFor(date), date, () => {})
        return stateFrom(p.w, date)
      },
      addStep: (step) => {
        extra.push(step)
      },
    }
  }

  let steps = stepsFor(startDate)
  let checkpoints: Position[] = [freshPosition()]
  let cursor: Position = copyOf(checkpoints[0])
  /** Keeps a checkpoint in time order; going over ground already covered adds nothing. */
  const keep = (copy: Position) => {
    let i = checkpoints.length
    while (i > 0 && checkpoints[i - 1].time > copy.time) i--
    for (let j = i - 1; j >= 0 && checkpoints[j].time === copy.time; j--) {
      if (checkpoints[j].next === copy.next) return
    }
    checkpoints.splice(i, 0, copy)
  }

  return {
    at: (date) => {
      // A date before the start still has the starting state, as if the start were that day.
      const target = hasStart && startDate && date < startDate ? startDate : date
      // Back to the latest checkpoint on or before the date.
      if (target.getTime() < cursor.time) {
        let found = checkpoints[0]
        for (const c of checkpoints) if (c.time <= target.getTime()) found = c
        cursor = copyOf(found)
      }
      advance(cursor, steps, target, keep)
      return stateFrom(cursor.w, date)
    },
    addStep: (step) => {
      extra.push(step)
      steps = stepsFor(startDate)
      const from = step.end.getTime()
      checkpoints = checkpoints.filter((c) => c.time < from)
      cursor = copyOf(checkpoints[checkpoints.length - 1])
    },
  }
}

export const countryStateAt = (
  schedule: FocusSchedule,
  date: Date,
  options: CountryStateOptions = {},
): CountryState => simulateCountry(schedule, options).at(date)
