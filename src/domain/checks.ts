/**
 * The pure logic of a `Check`: whether it holds given what the campaign knows (`evaluateCheck`),
 * and whether it can start to hold by itself as time passes (`changesWithoutEvents`).
 */
import type { Check } from './focus'

/** What the campaign knows when a focus completes. A missing answer is `undefined`. */
export interface ConditionContext {
  hasIdea: (id: string) => boolean | undefined
  hasFocus: (id: string) => boolean | undefined
  /** The tech tree is not planned yet, so this can stay out until it is. */
  hasTech?: (id: string) => boolean | undefined
  /** Who leads the country, once known; `undefined` when not known (or retired and not replaced). */
  leader: () => { id?: string; character?: string } | undefined
  /** The ruling ideology group (`democratic`, `communism`, ...), once known. */
  government: () => string | undefined
  /** An ideology's popularity as a fraction of 1, once known. */
  popularity: (ideology: string) => number | undefined
  /** The country's own tag, and the DLCs it owns (a DLC not listed is not owned). */
  tag?: string
  hasDlc?: (id: string) => boolean | undefined
  /** The country's absolute `war_support` or `stability`, once the start has set them. */
  stat?: (key: 'war_support' | 'stability') => number | undefined
  /**
   * Whether the country is at war. Wars are not planned, so only the political power planner
   * answers it (with no: purchases are planned for peace); focus rewards leave it unknown.
   */
  atWar?: () => boolean | undefined
  /**
   * Whether the country has a state (owns and controls it). Known to be so for the states it starts
   * with; otherwise `undefined`, since claims and wars can change hands.
   */
  controlsState?: (id: string) => boolean | undefined
  /** Whether a country flag is set: known once a reward of the plan has set or cleared it. */
  hasFlag?: (id: string) => boolean | undefined
  /** Civilian plus military factories the country has. */
  factories?: () => number | undefined
  /** Whether the country is a subject, or in a civil war: not planned, so only some contexts say. */
  situation?: (key: 'subject' | 'civil_war') => boolean | undefined
  /** Whether the country is a major power. */
  isMajor?: () => boolean | undefined
  /**
   * Whether the country is at war with `tag`. Wars are only known from what the player enters
   * (`WarAdjustment`), and `undefined` before the first entry.
   */
  atWarWith?: (tag: string) => boolean | undefined
}

const compare = (a: number, op: string, b: number): boolean => {
  // Popularity is summed from fractions, so allow for rounding when asking about equality.
  const close = Math.abs(a - b) < 1e-9
  if (op === '>') return a > b && !close
  if (op === '<') return a < b && !close
  if (op === '>=') return a > b || close
  if (op === '<=') return a < b || close
  return close
}

/**
 * Whether `check` can start to hold with no event in between: only because time passes (popularity
 * and stability drift every day, a technology finishes) or because the check is not understood. A
 * check about an idea, focus, government, leader, war and the like only changes when a reward, a
 * purchase or an idea running out changes the country, and those are the political power planner's
 * change points, so it need not look between them.
 */
export const changesWithoutEvents = (check: Check): boolean => {
  switch (check.type) {
    case 'popularity':
    case 'stat':
    case 'tech':
      return true
    case 'not':
      return changesWithoutEvents(check.of)
    case 'all':
    case 'any':
      return check.of.some(changesWithoutEvents)
    case 'idea':
    case 'focus':
    case 'government':
    case 'leader':
    case 'tag':
    case 'dlc':
    case 'const':
    case 'war':
    case 'state':
    case 'flag':
    case 'war_with':
    case 'factories':
    case 'situation':
    case 'major':
      return false
    default:
      return true
  }
}

/** Whether `check` holds: true, false, or undefined when the campaign cannot tell. */
export const evaluateCheck = (check: Check, ctx: ConditionContext): boolean | undefined => {
  switch (check.type) {
    case 'idea':
      return ctx.hasIdea(check.id)
    case 'focus':
      return ctx.hasFocus(check.id)
    case 'tech':
      return ctx.hasTech?.(check.id)
    case 'government': {
      const government = ctx.government()
      return government === undefined ? undefined : government === check.id
    }
    case 'leader': {
      const leader = ctx.leader()
      if (!leader) return undefined
      // A legacy leader (`create_country_leader`) has an id and no character, and the other way round.
      if (check.id !== undefined && leader.id !== check.id) return false
      if (check.character === undefined) return true
      if (leader.character !== undefined) return leader.character === check.character
      return leader.id !== undefined ? false : undefined
    }
    case 'popularity': {
      const left = ctx.popularity(check.ideology)
      const right = typeof check.than === 'number' ? check.than : ctx.popularity(check.than)
      return left === undefined || right === undefined ? undefined : compare(left, check.op, right)
    }
    case 'stat': {
      const value = ctx.stat?.(check.key)
      return value === undefined ? undefined : compare(value, check.op, check.than)
    }
    case 'tag':
      return ctx.tag === undefined ? undefined : ctx.tag === check.id
    case 'dlc':
      return ctx.hasDlc?.(check.id)
    case 'const':
      return check.value
    case 'war': {
      const atWar = ctx.atWar?.()
      return atWar === undefined ? undefined : atWar === check.atWar
    }
    case 'state':
      return ctx.controlsState?.(check.id)
    case 'flag':
      return ctx.hasFlag?.(check.id)
    case 'war_with':
      return ctx.atWarWith?.(check.tag)
    case 'factories': {
      const count = ctx.factories?.()
      return count === undefined ? undefined : compare(count, check.op, check.than)
    }
    case 'situation': {
      const now = ctx.situation?.(check.key)
      return now === undefined ? undefined : now === check.value
    }
    case 'major': {
      const major = ctx.isMajor?.()
      return major === undefined ? undefined : major === check.value
    }
    case 'not': {
      const inner = evaluateCheck(check.of, ctx)
      return inner === undefined ? undefined : !inner
    }
    case 'all':
    case 'any': {
      // One decisive term settles it: a false term for `all`, a true one for `any`.
      const decisive = check.type === 'any'
      const results = check.of.map((c) => evaluateCheck(c, ctx))
      if (results.includes(decisive)) return decisive
      return results.includes(undefined) ? undefined : !decisive
    }
    default:
      return undefined
  }
}
