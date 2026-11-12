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
 * The DLC an `if` at `index` tests, when its whole condition is a single `has_dlc` check for a
 * DLC whose ownership we know; undefined when it is any other condition.
 */
const dlcCheckedBy = (
  effects: EffectLine[],
  index: number,
  ownedDlc: Record<string, boolean>,
): string | undefined => {
  const line = effects[index]
  const limit = effects[index + 1]
  const dlc = effects[index + 2]
  const checksNothingElse = (effects[index + 3]?.depth ?? 0) <= (limit?.depth ?? 0)
  return opensBlock(line, 'if') &&
    opensBlock(limit, 'limit') &&
    limit.depth === line.depth + 1 &&
    dlc?.key === 'has_dlc' &&
    dlc.value !== undefined &&
    dlc.value in ownedDlc &&
    checksNothingElse
    ? dlc.value
    : undefined
}

/**
 * `if = { limit = { has_dlc = "X" } ... } else = { ... }` for a DLC whose ownership is known
 * (`ownedDlc`, from `src/data/dlc.ts`): keeps the branch that applies and drops the condition,
 * so a player without the DLC sees what they would get. DLCs not listed, and a `has_dlc` `if`
 * without an `else`, are left as they were.
 */
export const resolveDlcConditions = (
  effects: EffectLine[],
  ownedDlc: Record<string, boolean>,
): EffectLine[] => {
  const result: EffectLine[] = []
  for (let i = 0; i < effects.length; i++) {
    const line = effects[i]
    const dlc = dlcCheckedBy(effects, i, ownedDlc)
    const thenEnd = blockEnd(effects, i)
    const otherwise = effects[thenEnd]
    if (dlc === undefined || !opensBlock(otherwise, 'else') || otherwise.depth !== line.depth) {
      result.push(line)
      continue
    }
    const elseEnd = blockEnd(effects, thenEnd)
    const chosen = ownedDlc[dlc]
      ? effects.slice(i + 3, thenEnd) // the `if` body, which starts after `limit = { has_dlc }`
      : effects.slice(thenEnd + 1, elseEnd)
    // Handle the chosen body too, in case it holds another such condition.
    result.push(...resolveDlcConditions(outdent(chosen), ownedDlc))
    i = elseEnd - 1
  }
  return result
}
