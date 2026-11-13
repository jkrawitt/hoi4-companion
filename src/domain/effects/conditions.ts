/**
 * Reading a `limit = { ... }` block as the English condition it describes, and folding it into
 * the header it belongs to.
 */
import type { EffectLine } from '../focus'
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

/**
 * Folds a `limit` into the header it belongs to: `if` / `limit` / `France:` / `is in faction
 * with: Britain` becomes `If France is in faction with: Britain:`. Run after names are resolved,
 * since the condition is written with them. `NOT`, `OR` and `AND` are written out
 * (`not (...)`, `(a or b)`); a limit holding anything else is left as it was. An `if` with an
 * empty limit always applies, so it is dropped and its body shown (with its `else` branches
 * removed, since they never apply).
 */
/** The idea a limit is only asking about (`has_idea = X`, or that inside a `NOT`), if it is. */
const hasIdeaOnly = (limit: EffectLine[]): EffectLine['hasIdea'] => {
  const [first, second] = limit
  if (limit.length === 1 && first.key === 'has_idea' && first.value) {
    return { id: first.value, negated: false }
  }
  if (
    limit.length === 2 &&
    opensBlock(first) &&
    first.key.toLowerCase() === 'not' &&
    second.key === 'has_idea' &&
    second.value
  ) {
    return { id: second.value, negated: true }
  }
  return undefined
}

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
    const hasIdea = hasIdeaOnly(effects.slice(i + 2, limitEnd))
    result.push({ ...line, condition: asPhrase(terms), ...(hasIdea && { hasIdea }) })
    i = limitEnd - 1
  }
  return result
}
