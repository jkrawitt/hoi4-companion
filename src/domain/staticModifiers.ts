import type { EffectLine } from './focus'
import { findBlocks } from './paradoxScript'

/**
 * Reads the wanted modifiers from a `common/modifiers` file (static modifiers such as the ones
 * `add_relation_modifier` attaches) as stat lines. Only plain `key = number` stats are kept:
 * conditions like `valid_relation_trigger` are not shown, and zero values (e.g. a base cost
 * reduction of 0) add nothing, so they are dropped too.
 */
export const parseStaticModifiers = (
  text: string,
  wanted: Set<string>,
): Record<string, EffectLine[]> =>
  Object.fromEntries(
    Object.entries(findBlocks(text, wanted)).map(([id, block]) => [
      id,
      block.flatMap((entry): EffectLine[] =>
        entry.key !== null &&
        typeof entry.value === 'string' &&
        Number.isFinite(Number(entry.value)) &&
        Number(entry.value) !== 0
          ? [{ depth: 0, key: entry.key, value: entry.value, isModifier: true }]
          : [],
      ),
    ]),
  )
