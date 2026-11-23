/**
 * The one place that builds the `ConditionContext` the campaign answers conditions with. What the
 * country is comes in two forms (the running `Working` state while rewards are applied, and the
 * `CountryState` handed out for a date); each is first read into `ConditionFacts`, and
 * `countryConditions` turns the facts and the options into the context, so every caller gets the
 * same answers for the same country.
 */
import type { ConditionContext } from './conditions'
import { rawStatNow, type Working } from './applyReward'
import { clampStat } from './totals'
import type { CountryState, CountryStateOptions } from './types'

/** What the conditions read about the country at one moment; built from either form of the state. */
export interface ConditionFacts {
  date: Date
  hasIdea: (id: string) => boolean
  hasFocus: (id: string) => boolean
  government?: string
  /** Who leads, for conditions: unknown after a retirement until the game picks a successor. */
  leader?: { id?: string; character?: string }
  /** Popularity by ideology and the actual stats, once the start is known (else undefined). */
  popularity?: (ideology: string) => number | undefined
  stat?: (key: 'stability' | 'war_support') => number | undefined
  /** Whether a country flag is set: known once a reward of the plan has set or cleared it. */
  flag: (id: string) => boolean | undefined
  /** The countries at war with ours, as the player entered them; unknown before the first entry. */
  enemies?: string[]
}

/** The facts of the working state as it stands at `at`. */
export const factsOfWorking = (
  w: Working,
  options: CountryStateOptions,
  at: Date,
): ConditionFacts => {
  // Popularity and the stats are only known once the start has set them; the plan alone only has
  // changes.
  const known = Boolean(options.start?.length)
  return {
    date: at,
    hasIdea: (id) => {
      const idea = w.ideas.get(id)
      return idea !== undefined && (!idea.until || idea.until > at)
    },
    hasFocus: (id) => w.doneFocuses.has(id),
    government: w.government,
    leader: w.identity,
    popularity: known ? (ideology) => w.popularity.get(ideology)?.total ?? 0 : undefined,
    // The actual stat: only known once the start has set it, like popularity.
    stat: known ? (key) => clampStat(rawStatNow(w, options, key, at)) : undefined,
    flag: (id) => w.flags.get(id),
    enemies: w.enemies,
  }
}

/**
 * The facts of the country in `state`. The start is known exactly when `state.stability` is (it is
 * only set once the start has set the stats), which is when popularity is answered too.
 */
export const factsOfState = (state: CountryState): ConditionFacts => {
  const known = state.stability !== undefined
  return {
    date: state.date,
    hasIdea: (id) => state.ideas.some((idea) => idea.id === id),
    hasFocus: (id) => state.completed.some((item) => item.focus.id === id),
    government: state.government,
    leader: state.leaderIdentity,
    popularity: known
      ? (ideology) => state.popularity.find((p) => p.subject === ideology)?.total ?? 0
      : undefined,
    stat: known ? (key) => (key === 'stability' ? state.stability : state.warSupport) : undefined,
    // Only the flags' own keys: `in` would also find `constructor` and the like.
    flag: (id) =>
      Object.prototype.hasOwnProperty.call(state.flags, id) ? state.flags[id] : undefined,
    enemies: state.enemies,
  }
}

/** Answers only the caller can give, and how to treat what is not planned. */
export interface ConditionExtras {
  /** Wars are not planned: with no war entered yet, take the country to be at peace (the planners). */
  assumePeace?: boolean
  /** Answers only the store can give (the factory count, major status). */
  factories?: () => number | undefined
  isMajor?: () => boolean | undefined
}

/** What the campaign can answer about the country described by `facts`. */
export const countryConditions = (
  facts: ConditionFacts,
  options: CountryStateOptions,
  extras: ConditionExtras = {},
): ConditionContext => {
  const { enemies } = facts
  // Wars are only what the player entered; before the first entry they are unknown, unless the
  // caller plans for peace.
  const peace = extras.assumePeace ? false : undefined
  return {
    hasIdea: facts.hasIdea,
    hasFocus: facts.hasFocus,
    government: () => facts.government,
    leader: () => facts.leader,
    popularity: (ideology) => facts.popularity?.(ideology),
    hasTech: (id) => options.hasTech?.(id, facts.date),
    tag: options.tag,
    hasDlc: options.ownedDlc ? (id) => options.ownedDlc![id] === true : undefined,
    controlsState: options.ownedStates
      ? (id) => (options.ownedStates!.includes(Number(id)) ? true : undefined)
      : undefined,
    hasFlag: facts.flag,
    atWar: () => (enemies ? enemies.length > 0 : peace),
    atWarWith: (tag) => (enemies ? enemies.includes(tag) : peace),
    stat: (key) => facts.stat?.(key),
    factories: extras.factories,
    isMajor: extras.isMajor,
  }
}
