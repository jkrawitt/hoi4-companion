/**
 * Settling the conditions that only ask whether the country has an idea, such as the focuses that
 * remove whichever of a few ideas the player has (`if = { limit = { has_idea = X } remove_ideas = X
 * else = { ... } }`). With the ideas the country has at that point known, the condition is not a
 * maybe: the branch that applies replaces the `if`, so its idea changes count like any other.
 */
import type { EffectLine } from '../focus'
import { blockEnd, opensBlock, outdent } from '../effects/lines'

/** `effects` with each `if` on `has_idea` replaced by the branch that applies. */
export const resolveIdeaConditions = (
  effects: EffectLine[],
  hasIdea: (id: string) => boolean,
): EffectLine[] => {
  const result: EffectLine[] = []
  for (let i = 0; i < effects.length; i++) {
    const line = effects[i]
    if (!opensBlock(line, 'if') || !line.hasIdea) {
      result.push(line)
      continue
    }
    const end = blockEnd(effects, i)
    const body = effects.slice(i + 1, end)
    // The `else` sits inside the `if` block, one level in, after the lines it replaces.
    const elseAt = body.findIndex((l) => opensBlock(l, 'else') && l.depth === line.depth + 1)
    const thenLines = elseAt === -1 ? body : body.slice(0, elseAt)
    const elseLines = elseAt === -1 ? [] : body.slice(elseAt + 1, blockEnd(body, elseAt))
    const holds = hasIdea(line.hasIdea.id) !== line.hasIdea.negated
    const chosen = holds ? outdent(thenLines) : outdent(outdent(elseLines))
    result.push(...resolveIdeaConditions(chosen, hasIdea))
    i = end - 1
  }
  return result
}
