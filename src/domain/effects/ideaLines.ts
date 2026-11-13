/**
 * Finding the lines of an effect list that add or remove an idea. The importer lists the idea's
 * own modifiers underneath each of them, reversed for the ones being removed.
 */
import type { EffectLine } from '../focus'

/** Single-idea effects whose idea's modifiers are worth listing beneath them. */
const ADD_IDEA_KEYS = new Set(['add_idea', 'add_timed_idea', 'show_ideas_tooltip'])
const REMOVE_IDEA_KEYS = new Set(['remove_idea'])

/**
 * Indexes of the lines naming an idea, written either as `<header> = X`, as the bare values of
 * `<header> = { X Y }`, or as one of the single-idea effects in `singles`.
 */
const ideaLines = (effects: EffectLine[], header: string, singles: Set<string>): number[] => {
  const indexes: number[] = []
  let blockDepth: number | null = null
  effects.forEach((e, i) => {
    if (blockDepth !== null && e.depth <= blockDepth) blockDepth = null
    if (e.key === header) {
      if (e.value !== undefined) indexes.push(i)
      else blockDepth = e.depth
    } else if (blockDepth !== null && e.key === null && e.value !== undefined) {
      indexes.push(i)
    } else if (e.key !== null && e.value !== undefined && singles.has(e.key)) {
      indexes.push(i)
    }
  })
  return indexes
}

/** Lines that add an idea (`add_ideas`, `add_idea`, ...): its modifiers are listed beneath. */
export const ideaLineIndexes = (effects: EffectLine[]): number[] =>
  ideaLines(effects, 'add_ideas', ADD_IDEA_KEYS)

/** Lines that remove an idea (`remove_ideas`, `remove_idea`): its modifiers are listed reversed. */
export const removedIdeaLineIndexes = (effects: EffectLine[]): number[] =>
  ideaLines(effects, 'remove_ideas', REMOVE_IDEA_KEYS)

/** Every idea id an effect list mentions, whether it adds or removes it. */
export const ideaIdsOf = (effects: EffectLine[]): string[] =>
  [...ideaLineIndexes(effects), ...removedIdeaLineIndexes(effects)].map((i) => effects[i].value!)

/**
 * A modifier line as it reads when its idea is removed: the change is undone, so `+5%` becomes
 * `-5%` and a rule that was `yes` becomes `no`.
 */
export const reverseModifier = (line: EffectLine): EffectLine => {
  if (line.value === undefined) return line
  if (line.isRule) {
    return { ...line, value: line.value === 'no' || line.value === '0' ? 'yes' : 'no' }
  }
  const n = Number(line.value)
  return Number.isFinite(n) ? { ...line, value: String(-n) } : line
}
