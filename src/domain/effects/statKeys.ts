/** What a modifier's key alone tells us: where to look for its name, and which way is good. */

/** Localisation keys that may hold the display name of a modifier, most specific first. */
export const modifierNameKeys = (key: string): string[] => [
  `MODIFIER_${key.toUpperCase()}`,
  `modifier_${key}`,
  key,
]

/** Construction speed of one kind of building, e.g. `production_speed_nuclear_reactor_factor`. */
export const isBuildingSpeedModifier = (key: string): boolean =>
  /^production_speed_.+_factor$/.test(key)

/**
 * Which direction is an improvement for a family of stats, judged from the key: costs
 * (`*_cost_factor`) are better lower and building construction speeds better higher. Anything
 * else is left to `statOverrides.ts`.
 */
export const defaultGoodWhen = (key: string): 'positive' | 'negative' | undefined =>
  isBuildingSpeedModifier(key) ? 'positive' : key.endsWith('_cost_factor') ? 'negative' : undefined
