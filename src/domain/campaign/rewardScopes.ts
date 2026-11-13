/**
 * Which lines of a reward are certain to happen for this country, which sit in blocks that might
 * not (`if`, `random_*`, ...), and which are in another country's scope.
 */
import type { EffectLine } from '../focus'
import { blockEnd, isCountryTag, opensBlock } from '../effects/lines'

const CONDITIONAL_HEADERS = /^(if|else|else_if|random|random_list|random_.+|every_.+|all_.+)$/

/** Whether the lines inside this block header are skipped because they are not about this country. */
const isForeignScope = (key: string, tag: string | undefined): boolean => {
  if (/^\d+$/.test(key)) return true
  if (isCountryTag(key)) return key !== tag
  // A character scope (`ROM_ion_antonescu = { ... }`) belongs to the country in its prefix.
  const prefix = /^([A-Z]{3})_/.exec(key)
  return prefix !== null && tag !== undefined && prefix[1] !== tag
}

/** Splits a reward into the lines that happen for sure and the blocks that might not. */
export const classify = (effects: EffectLine[], tag: string | undefined) => {
  const applied = new Set<number>()
  const conditional: EffectLine[][] = []
  const states: EffectLine[][] = []
  let i = 0
  while (i < effects.length) {
    const line = effects[i]
    if (opensBlock(line) && CONDITIONAL_HEADERS.test(line.key)) {
      const end = blockEnd(effects, i)
      conditional.push(effects.slice(i, end))
      i = end
    } else if (opensBlock(line) && isForeignScope(line.key, tag)) {
      const end = blockEnd(effects, i)
      // A state scope (`46 = { ... }`) is taken to be one of the country's own states.
      if (/^\d+$/.test(line.key)) states.push(effects.slice(i, end))
      i = end
    } else {
      // Plain effects, and blocks (hidden_effect, own scopes, add_ideas) that are looked into.
      applied.add(i)
      i++
    }
  }
  return { applied, conditional, states }
}

/** Effects that add production of a resource or build something. */
export const CONSTRUCTION_KEYS = new Set([
  'add_resource',
  'add_building_construction',
  'add_extra_state_shared_building_slots',
])

/**
 * Takes the resource and building effects out of a `random_owned_*state` block, which picks one of
 * the country's own states, so they do happen. Returns them under the block's header (which names
 * the states it prefers), and what is left of the block for the conditional list.
 */
export const splitConstruction = (
  block: EffectLine[],
): { built: EffectLine[]; rest: EffectLine[] } => {
  if (!block[0].key?.startsWith('random_owned_') && !/^\d+$/.test(block[0].key ?? ''))
    return { built: [], rest: block }
  const built: EffectLine[] = [block[0]]
  const rest: EffectLine[] = [block[0]]
  let i = 1
  while (i < block.length) {
    const end = blockEnd(block, i)
    const isConstruction = block[i].depth === 1 && CONSTRUCTION_KEYS.has(block[i].key ?? '')
    ;(isConstruction ? built : rest).push(...block.slice(i, end))
    i = end
  }
  const hasEffects = (lines: EffectLine[]) =>
    lines.slice(1).some((l) => l.depth === 1 && l.key !== 'limit')
  return {
    built: hasEffects(built) ? built : [],
    rest: hasEffects(rest) ? rest : [],
  }
}
