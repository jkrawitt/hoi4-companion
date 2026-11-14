import type { EffectLine } from '../focus'
import { ideaIdsOf } from '../focusEffects'
import { getBlock, getString, parseScript, type ScriptBlock } from './paradoxScript'

/** The ideas of a law category (`law = yes`), and the one that applies until another is chosen. */
export interface LawCategory {
  ideas: string[]
  default?: string
}

/**
 * Reads the law categories of a `common/ideas` file. A category name can appear in several files
 * (a country's file adds its own laws to `economy`), so the caller merges by name.
 */
export const parseLawCategories = (text: string): Record<string, LawCategory> => {
  const result: Record<string, LawCategory> = {}
  const categories = getBlock(parseScript(text), 'ideas') ?? []
  for (const category of categories) {
    if (category.key === null || typeof category.value !== 'object') continue
    if (getString(category.value, 'law') !== 'yes') continue
    const law: LawCategory = { ideas: [] }
    for (const idea of category.value as ScriptBlock) {
      if (idea.key === null || typeof idea.value !== 'object') continue
      law.ideas.push(idea.key)
      if (getString(idea.value, 'default') === 'yes') law.default ??= idea.key
    }
    result[category.key] = law
  }
  return result
}

/** Merges the categories read from several files. */
export const mergeLawCategories = (
  list: Record<string, LawCategory>[],
): Record<string, LawCategory> => {
  const merged: Record<string, LawCategory> = {}
  for (const categories of list) {
    for (const [name, law] of Object.entries(categories)) {
      const into = (merged[name] ??= { ideas: [] })
      into.ideas.push(...law.ideas)
      into.default ??= law.default
    }
  }
  return merged
}

/**
 * `add_ideas` lines for the laws the start does not set. History files leave the laws alone, so
 * the `default = yes` idea of each category applies; a category counts as set when the start
 * already adds one of its ideas. (A later law of the same category does not remove the default;
 * that is not modelled.)
 */
export const defaultLawLines = (
  categories: Record<string, LawCategory>,
  startLines: EffectLine[],
): EffectLine[] => {
  const set = new Set(ideaIdsOf(startLines))
  return Object.values(categories).flatMap((law) =>
    law.default && !law.ideas.some((id) => set.has(id))
      ? [{ depth: 0, key: 'add_ideas', value: law.default }]
      : [],
  )
}
