import type { EffectLine } from '../focus'
import { ideaLineIndexes, removedIdeaLineIndexes, reverseModifier } from './ideaLines'

/** Stat lines of the things a focus can apply, which are shown beneath the line applying them. */
export interface Definitions {
  ideas: Record<string, EffectLine[]>
  relations: Record<string, EffectLine[]>
  leaderTraits: Record<string, EffectLine[]>
}

/**
 * Puts each applied idea's, relation modifier's and leader trait's own stats directly beneath
 * the line that applies it, one level deeper. A removed idea's modifiers are reversed, since the
 * change is being undone, and a leader's `traits` become a line each with their stats under them.
 */
export const listModifiersUnderLines = (effects: EffectLine[], defs: Definitions): EffectLine[] => {
  const adds = new Set(ideaLineIndexes(effects))
  const removes = new Set(removedIdeaLineIndexes(effects))
  const modifiersFor = (line: EffectLine, i: number): EffectLine[] => {
    if (adds.has(i)) return defs.ideas[line.value!] ?? []
    if (removes.has(i)) return (defs.ideas[line.value!] ?? []).map(reverseModifier)
    if (!line.value) return []
    if (line.key === 'add_relation_modifier') return defs.relations[line.value] ?? []
    if (line.key === 'add_country_leader_trait') return defs.leaderTraits[line.value] ?? []
    return []
  }
  return effects.flatMap((line, i): EffectLine[] => {
    /** Nests lines under `line`, keeping them hidden if it is hidden. */
    const under = (lines: EffectLine[], extra = 0) =>
      lines.map((m) => ({ ...m, depth: line.depth + 1 + extra + m.depth, hidden: line.hidden }))
    if (line.traits) {
      return [
        line,
        ...line.traits.flatMap((trait) => [
          { depth: line.depth + 1, key: 'leader_trait', value: trait, hidden: line.hidden },
          ...under(defs.leaderTraits[trait] ?? [], 1),
        ]),
      ]
    }
    return [line, ...under(modifiersFor(line, i))]
  })
}
