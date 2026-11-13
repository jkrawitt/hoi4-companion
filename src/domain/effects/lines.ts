/**
 * The flattened effect list and the handful of operations every pass over it needs.
 *
 * Effects are kept as a flat list of depth-annotated lines rather than a tree, because that is
 * how they are displayed. A `key = { ... }` block becomes a header line followed by its contents
 * at a greater depth, so "the lines inside this block" means "the following lines that are
 * deeper", which is what `blockEnd` and `childrenOf` work out.
 */
import type { EffectLine } from '../focus'
import type { ScriptBlock } from '../parsers/paradoxScript'

/** Flattens a script block into depth-annotated lines. */
export const flattenEffects = (block: ScriptBlock, depth = 0): EffectLine[] =>
  block.flatMap((entry): EffectLine[] => {
    if (typeof entry.value === 'string') {
      return [
        entry.operator && entry.operator !== '='
          ? { depth, key: entry.key, value: entry.value, operator: entry.operator }
          : { depth, key: entry.key, value: entry.value },
      ]
    }
    // Script keywords are case-insensitive, and the game files write `IF` as well as `if`.
    const key = entry.key === 'IF' ? 'if' : entry.key
    return [{ depth, key }, ...flattenEffects(entry.value, depth + 1)]
  })

/**
 * Whether a line opens a `key = { ... }` block, as opposed to being a `key = value` field or a
 * bare value. Optionally also checks which block it is, so `opensBlock(line, 'limit')` replaces
 * `line.key === 'limit' && line.value === undefined`.
 */
export const opensBlock = (
  line: EffectLine | undefined,
  key?: string,
): line is EffectLine & { key: string } =>
  line !== undefined &&
  line.value === undefined &&
  line.key !== null &&
  (key === undefined || line.key === key)

/** Index just past the last line nested under `effects[index]`. */
export const blockEnd = (effects: EffectLine[], index: number): number => {
  let end = index + 1
  while (end < effects.length && effects[end].depth > effects[index].depth) end++
  return end
}

/** The lines nested under `effects[index]`, at any depth. */
export const childrenOf = (effects: EffectLine[], index: number): EffectLine[] =>
  effects.slice(index + 1, blockEnd(effects, index))

/** Lifts lines one level out, for when the block that held them is dropped. */
export const outdent = (lines: EffectLine[]): EffectLine[] =>
  lines.map((line) => ({ ...line, depth: line.depth - 1 }))

/** Whether a line continues a conditional at `depth`, i.e. an `else` or `else_if` branch. */
export const isElseBranch = (line: EffectLine | undefined, depth: number): boolean =>
  line?.depth === depth && (line.key === 'else' || line.key === 'else_if')

/** A script key read as words: `add_stability` as `add stability`. */
export const humanize = (key: string): string => key.replace(/_/g, ' ')

export const capitalize = (text: string): string => text.replace(/^./, (c) => c.toUpperCase())

/** Strips the escaped quotes the game files wrap some names in. */
export const unquote = (text: string): string => text.replace(/^"|"$/g, '')

export const signed = (n: number): string => `${n > 0 ? '+' : ''}${n}`

/** A fraction as a percentage number, e.g. `0.755` as `75.5`. */
export const percentOf = (fraction: number, decimals = 1): number =>
  Number((fraction * 100).toFixed(decimals))

/** Words that stand for the country taking the focus when used as an effect target. */
const OWN_SCOPES = new Set(['ROOT', 'THIS', 'PREV', 'FROM'])
export const isOwnScope = (word: string): boolean => OWN_SCOPES.has(word)

/** Country tags such as `SOV`, used as scope blocks (`SOV = { ... }`). */
export const isCountryTag = (key: string | null): key is string =>
  key !== null && /^[A-Z]{3}$/.test(key)
