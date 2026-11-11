import type { EffectLine } from './focus'
import { flattenEffects } from './focusEffects'
import { findBlocks, getBlock } from './paradoxScript'

/**
 * Returns what each wanted idea in a `common/ideas` file does, as effect lines: its `modifier`
 * block (stat changes) followed by its `rule` block (yes/no game rules).
 */
export const parseIdeas = (text: string, wanted: Set<string>): Record<string, EffectLine[]> =>
  Object.fromEntries(
    Object.entries(findBlocks(text, wanted)).map(([id, block]) => [
      id,
      [
        ...flattenEffects(getBlock(block, 'modifier') ?? []).map((l) => ({
          ...l,
          isModifier: true,
        })),
        ...flattenEffects(getBlock(block, 'rule') ?? []).map((l) => ({
          ...l,
          isModifier: true,
          isRule: true,
        })),
      ],
    ]),
  )
