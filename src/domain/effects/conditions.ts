/**
 * Reading a `limit = { ... }` block as the English condition it describes, and folding it into
 * the header it belongs to.
 */
import type { Check, EffectLine } from '../focus'
import { formatEffect } from './format'
import {
  blockEnd,
  humanize,
  isCountryTag,
  isElseBranch,
  isOwnScope,
  opensBlock,
  outdent,
} from './lines'

/** A line with the lines nested under it, to read a `limit` as the condition it describes. */
interface ConditionNode {
  line: EffectLine
  kids: ConditionNode[]
}

const toTree = (lines: EffectLine[]): ConditionNode[] => {
  const roots: ConditionNode[] = []
  const stack: ConditionNode[] = []
  for (const line of lines) {
    const node: ConditionNode = { line, kids: [] }
    while (stack.length > 0 && stack[stack.length - 1].line.depth >= line.depth) stack.pop()
    ;(stack.length > 0 ? stack[stack.length - 1].kids : roots).push(node)
    stack.push(node)
  }
  return roots
}

/** Brackets a group of terms, unless it is a single term that needs none. */
const wrap = (terms: string[]) => (terms.length > 1 ? `(${terms.join(' and ')})` : terms[0])

/** The terms of a condition block, or null when it holds something we cannot read. */
const conditionTerms = (nodes: ConditionNode[]): string[] | null => {
  const terms: string[] = []
  for (const { line, kids } of nodes) {
    if (line.key === null) return null
    const key: string = line.key
    if (line.value !== undefined) {
      terms.push(formatEffect(line))
      continue
    }
    const inner = conditionTerms(kids)
    if (inner === null || inner.length === 0) return null
    if (key === 'NOT') terms.push(`not ${wrap(inner)}`)
    else if (key === 'OR') terms.push(inner.length > 1 ? `(${inner.join(' or ')})` : inner[0])
    else if (key === 'AND') terms.push(wrap(inner))
    else if (key === 'capital_scope') terms.push(`capital ${wrap(inner)}`)
    else if (isCountryTag(key) || isOwnScope(key) || /^\d+$/.test(key)) {
      // A scope the condition is asked about: `Yugoslavia (has war: yes or is subject: yes)`.
      terms.push(`${formatEffect(line).replace(/:$/, '')} ${wrap(inner)}`)
    } else if (kids.every((k) => k.line.value !== undefined && k.line.key !== null)) {
      // A condition with fields of its own: `has_country_leader = { id = 550 }`.
      terms.push(`${humanize(key)} (${kids.map((k) => formatEffect(k.line)).join(', ')})`)
    } else return null
  }
  return terms
}

/** Headers that take a `limit`, which is folded into the header as its condition. */
const CONDITIONAL_KEYS = new Set(['if', 'else_if', 'every_other_country'])

/** The terms of one condition as a single phrase; a lone `or` group needs no brackets of its own. */
const asPhrase = (terms: string[]): string =>
  terms.length === 1 && terms[0].startsWith('(') && !terms[0].includes(' and ')
    ? terms[0].slice(1, -1)
    : terms.join(' and ')

const POPULARITY_IDEOLOGIES = new Set(['democratic', 'communism', 'fascism', 'neutrality'])
const COMPARISONS = new Set(['>', '<', '>=', '<=', '='])

const POPULARITY_OF = /^party_popularity@(.+)$/

/** One term of a limit as a `Check`; anything we cannot answer is `unknown`. */
const checkOfNode = ({ line, kids }: ConditionNode): Check => {
  const key = line.key?.toLowerCase() ?? ''
  if (line.value === undefined && key === 'has_country_leader') {
    // `has_country_leader = { id = 550 }` or `{ character = X }`; `ruling_only` changes nothing for
    // the country's own leader.
    const field = (name: string) => kids.find((k) => k.line.key === name)?.line.value
    const id = field('id')
    const character = field('character')
    const readable = kids.every((k) =>
      ['id', 'character', 'ruling_only'].includes(k.line.key ?? ''),
    )
    if (readable && (id !== undefined || character !== undefined)) {
      return {
        type: 'leader',
        ...(id !== undefined && { id }),
        ...(character !== undefined && { character }),
      }
    }
    return { type: 'unknown' }
  }
  if (line.value === undefined) {
    const inner = kids.map(checkOfNode)
    if (key === 'not')
      return { type: 'not', of: inner.length === 1 ? inner[0] : { type: 'all', of: inner } }
    if (key === 'or') return { type: 'any', of: inner }
    if (key === 'and') return { type: 'all', of: inner }
    return { type: 'unknown' }
  }
  const value = line.value
  if (key === 'has_idea') return { type: 'idea', id: value }
  if (key === 'has_completed_focus') return { type: 'focus', id: value }
  if (key === 'has_tech') return { type: 'tech', id: value }
  if (key === 'has_government') return { type: 'government', id: value }
  const op = line.operator ?? '='
  if (POPULARITY_IDEOLOGIES.has(key) && COMPARISONS.has(op)) {
    const other = POPULARITY_OF.exec(value)
    if (other) return { type: 'popularity', ideology: key, op: op as '>', than: other[1] }
    if (value !== '' && Number.isFinite(Number(value))) {
      return { type: 'popularity', ideology: key, op: op as '>', than: Number(value) }
    }
  }
  return { type: 'unknown' }
}

/** The terms of a `limit` (which are all required) as one `Check`, or undefined if none is known. */
const checkOf = (limit: EffectLine[]): Check | undefined => {
  const checks = toTree(limit).map(checkOfNode)
  const known = (c: Check): boolean =>
    c.type === 'not'
      ? known(c.of)
      : c.type === 'all' || c.type === 'any'
        ? c.of.some(known)
        : c.type !== 'unknown'
  if (!checks.some(known)) return undefined
  return checks.length === 1 ? checks[0] : { type: 'all', of: checks }
}

/**
 * Folds a `limit` into the header it belongs to: `if` / `limit` / `France:` / `is in faction
 * with: Britain` becomes `If France is in faction with: Britain:`. Run after names are resolved,
 * since the condition is written with them. `NOT`, `OR` and `AND` are written out
 * (`not (...)`, `(a or b)`); a limit holding anything else is left as it was. An `if` with an
 * empty limit always applies, so it is dropped and its body shown (with its `else` branches
 * removed, since they never apply).
 */
export const foldConditions = (effects: EffectLine[]): EffectLine[] => {
  const result: EffectLine[] = []
  for (let i = 0; i < effects.length; i++) {
    const line = effects[i]
    const limit = effects[i + 1]
    const takesLimit =
      opensBlock(line) &&
      CONDITIONAL_KEYS.has(line.key) &&
      opensBlock(limit, 'limit') &&
      limit.depth === line.depth + 1
    if (!takesLimit) {
      result.push(line)
      continue
    }
    const limitEnd = blockEnd(effects, i + 1)
    const bodyEnd = blockEnd(effects, i)
    const limitIsEmpty = limitEnd === i + 2

    if (limitIsEmpty && line.key === 'if') {
      // The game files comment the check out, so the condition always holds: show the body, and
      // drop the branches that follow, which can now never apply.
      result.push(...foldConditions(outdent(effects.slice(limitEnd, bodyEnd))))
      let next = bodyEnd
      while (isElseBranch(effects[next], line.depth)) next = blockEnd(effects, next)
      i = next - 1
      continue
    }

    const terms = limitIsEmpty ? null : conditionTerms(toTree(effects.slice(i + 2, limitEnd)))
    if (!terms || terms.length === 0) {
      result.push(line)
      continue
    }
    const check = checkOf(effects.slice(i + 2, limitEnd))
    result.push({ ...line, condition: asPhrase(terms), ...(check && { check }) })
    i = limitEnd - 1
  }
  return result
}
