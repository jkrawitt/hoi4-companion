import type { OpinionModifier } from './focus'
import { findBlocks, getString } from './paradoxScript'

/**
 * Reads the wanted modifiers from a `common/opinion_modifiers` file, e.g.
 * `ROM_a_deal_with_the_devil = { value = 40 }`. Durations in years are converted to months.
 */
export const parseOpinionModifiers = (
  text: string,
  wanted: Set<string>,
): Record<string, OpinionModifier> => {
  const result: Record<string, OpinionModifier> = {}
  for (const [id, block] of Object.entries(findBlocks(text, wanted))) {
    const number = (key: string) => {
      const n = Number(getString(block, key))
      return Number.isFinite(n) ? n : undefined
    }
    const years = number('years')
    result[id] = {
      value: number('value') ?? 0,
      months: number('months') ?? (years === undefined ? undefined : years * 12),
    }
  }
  return result
}
