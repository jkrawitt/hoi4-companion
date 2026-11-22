import { DAYS_PER_WEEK, type Check, type EffectLine, type Focus } from '../focus'
import { checkOfLines } from '../effects/conditions'
import {
  collapseEffects,
  flattenEffects,
  markHidden,
  pruneEmptyBlocks,
  simplifyRandomStates,
  unwrapEventConditions,
} from '../focusEffects'
import {
  getAll,
  getBlock,
  getString,
  getStrings,
  parseScript,
  type ScriptBlock,
} from './paradoxScript'
import { expandEffects, type ScriptedEffects } from './scriptedEffects'

/** Whether a check has a term the campaign can answer (not just unknown ones and constants). */
const answerable = (check: Check): boolean => {
  switch (check.type) {
    case 'not':
      return answerable(check.of)
    case 'all':
    case 'any':
      return check.of.some(answerable)
    case 'unknown':
    case 'const':
    case 'tag':
    case 'dlc':
    // Only a decision's `visible` answers these (the store's view context), never a focus.
    case 'situation':
    case 'factories':
    case 'major':
      return false
    default:
      return true
  }
}

/** A focus's `available` or `bypass` block as a check, or nothing when we could never answer it. */
const triggerCheck = (
  block: ScriptBlock | undefined,
): { check: Check; lines: EffectLine[] } | undefined => {
  if (!block || block.length === 0) return undefined
  const lines = flattenEffects(block)
  const check = checkOfLines(lines)
  return check && answerable(check) ? { check, lines } : undefined
}

const optional = <K extends string, V>(key: K, value: V | undefined) =>
  value ? { [key]: value } : {}

const parseFocus = (block: ScriptBlock, scripted: ScriptedEffects): Focus | null => {
  const id = getString(block, 'id')
  if (!id) return null
  const available = triggerCheck(getBlock(block, 'available'))
  const cost = Number(getString(block, 'cost') ?? 10)
  const coordinate = (key: string) => {
    const n = Number(getString(block, key) ?? 0)
    return Number.isFinite(n) ? n : 0
  }
  return {
    id,
    name: id,
    days: (Number.isFinite(cost) ? cost : 10) * DAYS_PER_WEEK,
    prerequisites: getAll(block, 'prerequisite').flatMap((e) =>
      typeof e.value === 'object' ? [getStrings(e.value, 'focus')] : [],
    ),
    mutuallyExclusive: getStrings(getBlock(block, 'mutually_exclusive') ?? [], 'focus'),
    ...optional('available', available?.check),
    ...optional('availableLines', available?.lines),
    ...optional('bypass', triggerCheck(getBlock(block, 'bypass'))?.check),
    x: coordinate('x'),
    y: coordinate('y'),
    relativeTo: getString(block, 'relative_position_id'),
    effects: markHidden(
      pruneEmptyBlocks(
        simplifyRandomStates(
          unwrapEventConditions(
            collapseEffects(
              flattenEffects(expandEffects(getBlock(block, 'completion_reward') ?? [], scripted)),
            ),
          ),
        ),
      ),
    ),
  }
}

/**
 * Extracts the focuses of every `focus_tree` in a `common/national_focus` file, with the
 * scripted effects they call written out.
 */
export const parseFocusTreeFile = (text: string, scripted: ScriptedEffects = {}): Focus[] => {
  const focuses: Focus[] = []
  for (const tree of getAll(parseScript(text), 'focus_tree')) {
    if (typeof tree.value !== 'object') continue
    for (const entry of getAll(tree.value, 'focus')) {
      if (typeof entry.value !== 'object') continue
      const focus = parseFocus(entry.value, scripted)
      if (focus) focuses.push(focus)
    }
  }
  return focuses
}
