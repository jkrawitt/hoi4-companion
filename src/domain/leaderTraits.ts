import type { EffectLine } from './focus'
import { parseStatBlocks } from './statBlocks'

/** Numeric fields of a trait that are not stat changes. */
const NOT_STATS = new Set(['sprite', 'cost'])

/** Reads the wanted country leader traits from a `common/country_leader` file as stat lines. */
export const parseLeaderTraits = (
  text: string,
  wanted: Set<string>,
): Record<string, EffectLine[]> => parseStatBlocks(text, wanted, NOT_STATS)
