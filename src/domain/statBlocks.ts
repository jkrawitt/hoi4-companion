import type { EffectLine } from './focus'
import { findBlocks } from './paradoxScript'

/**
 * Reads definitions whose body is a plain list of stat changes (`key = number`), which is the
 * shape of both static modifiers and country leader traits.
 *
 * Only plain numbers are kept: conditions such as `valid_relation_trigger` are blocks rather
 * than stats, fields like `sprite` and `ai_will_do` are bookkeeping, and a zero value (e.g. a
 * base cost reduction of 0) adds nothing to show.
 */
export const parseStatBlocks = (
  text: string,
  wanted: Set<string>,
  /** Numeric fields that are not stats, e.g. a trait's `cost`. */
  notStats: Set<string> = new Set(),
): Record<string, EffectLine[]> =>
  Object.fromEntries(
    Object.entries(findBlocks(text, wanted)).map(([id, block]) => [
      id,
      block.flatMap((entry): EffectLine[] =>
        entry.key !== null &&
        !notStats.has(entry.key) &&
        typeof entry.value === 'string' &&
        Number.isFinite(Number(entry.value)) &&
        Number(entry.value) !== 0
          ? [{ depth: 0, key: entry.key, value: entry.value, isModifier: true }]
          : [],
      ),
    ]),
  )
