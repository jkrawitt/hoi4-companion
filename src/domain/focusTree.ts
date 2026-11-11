import { DAYS_PER_WEEK, type Focus } from './focus'
import { collapseEffects, flattenEffects, markHidden, simplifyRandomStates } from './focusEffects'
import {
  getAll,
  getBlock,
  getString,
  getStrings,
  parseScript,
  type ScriptBlock,
} from './paradoxScript'

const parseFocus = (block: ScriptBlock): Focus | null => {
  const id = getString(block, 'id')
  if (!id) return null
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
    x: coordinate('x'),
    y: coordinate('y'),
    relativeTo: getString(block, 'relative_position_id'),
    effects: markHidden(
      simplifyRandomStates(
        collapseEffects(flattenEffects(getBlock(block, 'completion_reward') ?? [])),
      ),
    ),
  }
}

/** Extracts the focuses of every `focus_tree` in a `common/national_focus` file. */
export const parseFocusTreeFile = (text: string): Focus[] => {
  const focuses: Focus[] = []
  for (const tree of getAll(parseScript(text), 'focus_tree')) {
    if (typeof tree.value !== 'object') continue
    for (const entry of getAll(tree.value, 'focus')) {
      if (typeof entry.value !== 'object') continue
      const focus = parseFocus(entry.value)
      if (focus) focuses.push(focus)
    }
  }
  return focuses
}
