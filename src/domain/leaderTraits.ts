import type { EffectLine } from './focus'
import { findBlocks } from './paradoxScript'

/** Numeric fields of a trait that are not stat changes. */
const NOT_STATS = new Set(['sprite', 'cost'])

/**
 * Reads the wanted country leader traits from a `common/country_leader` file as stat lines.
 * Only plain `key = number` stats are kept: `sprite`, `random`, `ai_will_do` and the like are
 * not stats, and zero values add nothing.
 */
export const parseLeaderTraits = (
  text: string,
  wanted: Set<string>,
): Record<string, EffectLine[]> =>
  Object.fromEntries(
    Object.entries(findBlocks(text, wanted)).map(([id, block]) => [
      id,
      block.flatMap((entry): EffectLine[] =>
        entry.key !== null &&
        !NOT_STATS.has(entry.key) &&
        typeof entry.value === 'string' &&
        Number.isFinite(Number(entry.value)) &&
        Number(entry.value) !== 0
          ? [{ depth: 0, key: entry.key, value: entry.value, isModifier: true }]
          : [],
      ),
    ]),
  )
