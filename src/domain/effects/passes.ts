/**
 * Passes that tidy the flattened effect list: resolving conditions whose answer we know,
 * dropping blocks that say nothing to a player, and marking the ones the game hides.
 */
import type { EffectLine } from '../focus'
import {
  blockEnd,
  childrenOf,
  isCountryTag,
  isElseBranch,
  isOwnScope,
  opensBlock,
  outdent,
} from './lines'

/**
 * Tidies `random_owned_controlled_state = { prioritize = { 46 } limit = { ... } ... }`: the
 * prioritized state ids move onto the header line (`preferStates`), and the `limit` is dropped.
 * It only says which states qualify (free building slots, ownership, ...), which is the game's
 * business of picking one, not something the player decides.
 */
export const simplifyRandomStates = (effects: EffectLine[]): EffectLine[] => {
  const result: EffectLine[] = []
  for (let i = 0; i < effects.length; i++) {
    const line = effects[i]
    if (!opensBlock(line, 'random_owned_controlled_state')) {
      result.push(line)
      continue
    }
    const end = blockEnd(effects, i)
    const body = effects.slice(i + 1, end)
    const prefer: string[] = []
    const kept: EffectLine[] = []
    for (let j = 0; j < body.length; j++) {
      const child = body[j]
      const isSetting =
        child.depth === line.depth + 1 &&
        (opensBlock(child, 'prioritize') || opensBlock(child, 'limit'))
      if (!isSetting) {
        kept.push(child)
        continue
      }
      const inner = childrenOf(body, j)
      if (child.key === 'prioritize') {
        prefer.push(...inner.flatMap((s) => (s.key === null && s.value ? [s.value] : [])))
      }
      j += inner.length
    }
    result.push(prefer.length > 0 ? { ...line, preferStates: prefer } : line)
    result.push(...simplifyRandomStates(kept))
    i = end - 1
  }
  return result
}

/**
 * `if = { limit = { ... } POL = { country_event = X } }` becomes just the event under `POL:`.
 * Only done when the whole body is events sent to other countries, so the condition (is that
 * country free, in a faction, ...) is not shown for those. Other conditionals are left as is.
 */
export const unwrapEventConditions = (effects: EffectLine[]): EffectLine[] => {
  const result: EffectLine[] = []
  for (let i = 0; i < effects.length; i++) {
    const line = effects[i]
    if (!opensBlock(line, 'if')) {
      result.push(line)
      continue
    }
    const end = blockEnd(effects, i)
    const inner = effects.slice(i + 1, end)
    // Everything after the `limit` block is the body of the `if`.
    const body = opensBlock(inner[0], 'limit') ? inner.slice(blockEnd(inner, 0)) : []
    const sendsEventsOnly =
      body.length > 0 &&
      body.every((e) =>
        e.depth === line.depth + 1
          ? opensBlock(e) && isCountryTag(e.key)
          : e.key === 'country_event' && e.value !== undefined,
      )
    if (!sendsEventsOnly || isElseBranch(effects[end], line.depth)) {
      result.push(line)
      continue
    }
    result.push(...outdent(body))
    i = end - 1
  }
  return result
}

/** Headers that only group other effects, so they mean nothing once those are gone. */
const GROUPING_KEYS = new Set([
  'if',
  'else',
  'else_if',
  'hidden_effect',
  'random_owned_controlled_state',
  'every_other_country',
  'capital_scope',
])

/**
 * Whether a block's contents include something that actually happens. A `limit` says when the
 * block applies rather than doing anything, so what is inside it does not count.
 */
const holdsAnEffect = (body: EffectLine[]): boolean => {
  for (let i = 0; i < body.length; i++) {
    if (opensBlock(body[i], 'limit')) {
      i = blockEnd(body, i) - 1
      continue
    }
    if (body[i].value !== undefined || body[i].research !== undefined) return true
  }
  return false
}

/**
 * Removes grouping blocks (`if`, `else`, `hidden_effect`, ...) with no effect left in them. A
 * `limit` does not count as an effect, so an `if` holding only a condition goes too. This
 * cleans up after dropped effects such as division templates.
 */
export const pruneEmptyBlocks = (effects: EffectLine[]): EffectLine[] => {
  const result: EffectLine[] = []
  for (let i = 0; i < effects.length; i++) {
    const line = effects[i]
    const groups =
      opensBlock(line) &&
      (GROUPING_KEYS.has(line.key) || isCountryTag(line.key) || isOwnScope(line.key))
    if (!groups) {
      result.push(line)
      continue
    }
    const end = blockEnd(effects, i)
    if (holdsAnEffect(effects.slice(i + 1, end))) result.push(line)
    else i = end - 1
  }
  return result
}

/** Marks everything inside a `hidden_effect = { ... }` block, which the game does not show. */
export const markHidden = (effects: EffectLine[]): EffectLine[] => {
  let hiddenDepth: number | null = null
  return effects.map((line) => {
    if (hiddenDepth !== null && line.depth <= hiddenDepth) hiddenDepth = null
    if (hiddenDepth === null && opensBlock(line, 'hidden_effect')) hiddenDepth = line.depth
    return hiddenDepth === null ? line : { ...line, hidden: true }
  })
}

/**
 * Settles the DLC terms of the `limit` at `limitIndex`: `has_dlc = X` and `NOT = { has_dlc = X }`
 * for a DLC whose ownership is known. `holds` is whether those terms are satisfied, and `kept`
 * are the limit's other terms, which are not about DLC and so stay.
 */
const settleLimit = (
  effects: EffectLine[],
  limitIndex: number,
  ownedDlc: Record<string, boolean>,
) => {
  const limitEnd = blockEnd(effects, limitIndex)
  const kept: EffectLine[] = []
  let known = false
  let holds = true
  for (let j = limitIndex + 1; j < limitEnd; ) {
    const term = effects[j]
    const termEnd = blockEnd(effects, j)
    const negated = opensBlock(term) && term.key.toLowerCase() === 'not' && termEnd - j === 2
    const check = negated ? effects[j + 1] : term
    if (check.key === 'has_dlc' && check.value !== undefined && check.value in ownedDlc) {
      known = true
      if (ownedDlc[check.value] === negated) holds = false
    } else {
      kept.push(...effects.slice(j, termEnd))
    }
    j = termEnd
  }
  return { known, holds, kept }
}

/**
 * Settles `has_dlc` conditions for the DLCs whose ownership is known (`ownedDlc`, from
 * `src/data/dlc.ts`), so a player sees what they really get:
 * - the DLC is owned (or its `NOT` is not): the condition goes, and the `if` is replaced by its
 *   body, or keeps just the other terms of its `limit` when there are some;
 * - it is not: the `else` branch replaces the `if`, or nothing does when there is none.
 * An `else` may sit inside the `if` block or follow it. DLCs not listed are left as they were.
 */
export const resolveDlcConditions = (
  effects: EffectLine[],
  ownedDlc: Record<string, boolean>,
): EffectLine[] => {
  const result: EffectLine[] = []
  for (let i = 0; i < effects.length; i++) {
    const line = effects[i]
    const limit = effects[i + 1]
    const settled =
      opensBlock(line, 'if') && opensBlock(limit, 'limit') && limit.depth === line.depth + 1
        ? settleLimit(effects, i + 1, ownedDlc)
        : undefined
    if (!settled?.known) {
      result.push(line)
      continue
    }
    const limitEnd = blockEnd(effects, i + 1)
    const end = blockEnd(effects, i)
    const body = effects.slice(limitEnd, end)
    const inner = body.findIndex((l) => opensBlock(l, 'else') && l.depth === line.depth + 1)
    const thenLines = inner === -1 ? body : body.slice(0, inner)
    const sibling = opensBlock(effects[end], 'else') && effects[end].depth === line.depth
    const siblingEnd = sibling ? blockEnd(effects, end) : end
    const elseLines =
      inner !== -1
        ? outdent(outdent(body.slice(inner + 1, blockEnd(body, inner))))
        : sibling
          ? outdent(effects.slice(end + 1, siblingEnd))
          : []
    if (!settled.holds) {
      result.push(...resolveDlcConditions(elseLines, ownedDlc))
    } else if (settled.kept.length === 0) {
      result.push(...resolveDlcConditions(outdent(thenLines), ownedDlc))
    } else {
      // Other terms are still to be met, and the `else` still goes with them.
      result.push(line, limit, ...settled.kept)
      result.push(...resolveDlcConditions(effects.slice(limitEnd, siblingEnd), ownedDlc))
    }
    i = siblingEnd - 1
  }
  return result
}
