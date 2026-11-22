/**
 * A `Check` as a tree a person can read, each term marked with whether it holds in the country now
 * (`true`, `false`, or `undefined` when the campaign cannot tell). Names come from `nameOf`.
 */
import type { Check } from '../focus'
import { capitalize, humanize } from '../effects/lines'

const nice = (id: string) => capitalize(humanize(id))
import { evaluateCheck, type ConditionContext } from './conditions'

export interface CheckView {
  text: string
  holds: boolean | undefined
  /** `all`: every child is needed; `any`: one is enough. Absent on a plain term. */
  join?: 'all' | 'any'
  children: CheckView[]
}

export interface CheckNames {
  idea?: (id: string) => string | undefined
  focus?: (id: string) => string | undefined
  tech?: (id: string) => string | undefined
}

const PERCENT = (n: number) => `${Math.round(n * 1000) / 10}%`

const termText = (check: Check, names: CheckNames): string => {
  const name = (kind: keyof CheckNames, id: string) => names[kind]?.(id) ?? nice(id)
  switch (check.type) {
    case 'idea':
      return `Has idea: ${name('idea', check.id)}`
    case 'focus':
      return `Completed focus: ${name('focus', check.id)}`
    case 'tech':
      return `Has technology: ${name('tech', check.id)}`
    case 'government':
      return `Government is ${nice(check.id)}`
    case 'popularity':
      return `${nice(check.ideology)} popularity ${check.op} ${
        typeof check.than === 'number' ? PERCENT(check.than) : `${nice(check.than)} popularity`
      }`
    case 'leader':
      return `Leader is ${check.character ? nice(check.character) : `#${check.id}`}`
    case 'stat':
      return `${nice(check.key)} ${check.op} ${PERCENT(check.than)}`
    case 'tag':
      return `Country is ${check.id}`
    case 'dlc':
      return `Owns the ${check.id} DLC`
    case 'const':
      return check.value ? 'Always' : 'Never'
    case 'war':
      return check.atWar ? 'At war' : 'Not at war'
    case 'state':
      return `Controls state ${check.id}`
    case 'flag':
      return `Country flag set: ${nice(check.id)}`
    case 'war_with':
      return `At war with ${check.tag}`
    case 'factories':
      return `Factories ${check.op} ${check.than}`
    case 'situation':
      return `${check.key === 'subject' ? 'Is a subject' : 'In a civil war'}: ${check.value ? 'yes' : 'no'}`
    case 'major':
      return check.value ? 'Is a major power' : 'Is not a major power'
    case 'unknown':
      return check.text || 'A condition the planner cannot read'
    default:
      return ''
  }
}

/** Flattens `all` inside `all` and `any` inside `any`, and drops groups of one. */
const simplify = (check: Check): Check => {
  if (check.type === 'not') return { type: 'not', of: simplify(check.of) }
  if (check.type !== 'all' && check.type !== 'any') return check
  const of = check.of.flatMap((c) => {
    const inner = simplify(c)
    return inner.type === check.type ? inner.of : [inner]
  })
  if (of.length === 0) return { type: 'const', value: check.type === 'all' }
  return of.length === 1 ? of[0] : { type: check.type, of }
}

/** `HUN_treaty_of_trianon`: the game names what belongs to a country after its tag. */
const otherTagPrefix = (id: string, ctx: ConditionContext) => {
  const tag = /^([A-Z]{3})_/.exec(id)?.[1]
  return tag !== undefined && ctx.tag !== undefined && tag !== ctx.tag
}

/** Whether the check is false because it needs another country's tag or something of theirs. */
const forOtherCountry = (check: Check, ctx: ConditionContext): boolean => {
  switch (check.type) {
    case 'tag':
      return ctx.tag !== undefined && ctx.tag !== check.id
    case 'idea':
    case 'focus':
    case 'tech':
    case 'flag':
      return otherTagPrefix(check.id, ctx)
    case 'all':
      return check.of.some((c) => forOtherCountry(c, ctx))
    case 'any':
      return check.of.length > 0 && check.of.every((c) => forOtherCountry(c, ctx))
    default:
      return false
  }
}

const TRUE: Check = { type: 'const', value: true }

/**
 * Leaves out what says nothing about this country: the branches of an `any` that need another
 * country's tag (or something named after it), and, in an `all`, the terms that hold for any
 * country but theirs (their tag, and `not` of what is theirs).
 */
const prune = (check: Check, ctx: ConditionContext): Check => {
  if (check.type === 'not') return { type: 'not', of: prune(check.of, ctx) }
  if (check.type === 'any') {
    const of = check.of.filter((c) => !forOtherCountry(c, ctx)).map((c) => prune(c, ctx))
    // One branch that always holds is enough.
    return of.some((c) => c.type === 'const' && c.value) ? TRUE : { type: 'any', of }
  }
  if (check.type !== 'all') return check
  const of = check.of
    .filter((c) => !(c.type === 'not' && forOtherCountry(c.of, ctx)))
    .filter((c) => !(c.type === 'tag' && evaluateCheck(c, ctx) === true))
    .map((c) => prune(c, ctx))
    .filter((c) => !(c.type === 'const' && c.value))
  return of.length === 0 ? TRUE : { type: 'all', of }
}

/**
 * `blind`: the check is about another scope than our country (inside a block we cannot answer), so
 * it is shown without a verdict.
 */
const view = (check: Check, ctx: ConditionContext, names: CheckNames, blind = false): CheckView => {
  const holds = blind ? undefined : evaluateCheck(check, ctx)
  if (check.type === 'unknown' && check.of) {
    return {
      text: termText(check, names),
      holds,
      join: 'all',
      children: check.of.map((c) => view(c, ctx, names, true)),
    }
  }
  if (check.type === 'all' || check.type === 'any') {
    return {
      text: '',
      holds,
      join: check.type,
      children: check.of.map((c) => view(c, ctx, names, blind)),
    }
  }
  if (check.type === 'not') {
    const inner = view(check.of, ctx, names, blind)
    // `not` of a plain term reads as one line; of a group it stays a group of its own.
    return inner.join
      ? {
          text: inner.join === 'any' ? 'None of:' : 'Not all of:',
          holds,
          join: inner.join,
          children: inner.children,
        }
      : { text: `Not: ${inner.text}`, holds, children: [] }
  }
  return { text: termText(check, names), holds, children: [] }
}

export const viewCheck = (check: Check, ctx: ConditionContext, names: CheckNames = {}): CheckView =>
  view(simplify(prune(check, ctx)), ctx, names)
