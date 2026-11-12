import type { EffectLine } from './focus'
import { parseStatBlocks } from './statBlocks'

/**
 * Reads the wanted modifiers from a `common/modifiers` file as stat lines. These are the static
 * modifiers that effects such as `add_relation_modifier` attach.
 */
export const parseStaticModifiers = (
  text: string,
  wanted: Set<string>,
): Record<string, EffectLine[]> => parseStatBlocks(text, wanted)
