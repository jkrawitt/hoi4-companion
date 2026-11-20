/**
 * The overview's Modifiers section: the totals of every source of stat changes merged into one
 * row per stat key and sorted into the groups of `statGroups.ts`.
 */
import { STAT_GROUPS, statGroupOf, type StatGroup } from '../statGroups'
import { statLabel, type StatDefinition } from '../stats'
import type { RuleValue, StatTotal } from './types'

/** One stat across the sources that contribute to it. */
export interface ModifierRow {
  key: string
  stat: StatDefinition
  /** The summed total as a raw script value, or a rule's value. */
  value: string
  /** What each source adds, for the sources that add anything. */
  sources: { spirits?: number; technology?: number }
}

export interface ModifierGroup extends StatGroup {
  rows: ModifierRow[]
}

export interface ModifierSources {
  /** Leader traits, national spirits, laws and staff. */
  spirits: StatTotal[]
  technology: StatTotal[]
  rules: RuleValue[]
}

/** Merges the sources per key (never two different keys, whatever their labels) and groups them. */
export const combineModifiers = ({
  spirits,
  technology,
  rules,
}: ModifierSources): ModifierGroup[] => {
  const rows = new Map<string, ModifierRow>()
  const add = (source: 'spirits' | 'technology', totals: StatTotal[]) => {
    for (const t of totals) {
      const row = rows.get(t.key) ?? { key: t.key, stat: t.stat, value: '0', sources: {} }
      row.sources[source] = (row.sources[source] ?? 0) + t.total
      row.value = String(Number(row.value) + t.total)
      rows.set(t.key, row)
    }
  }
  add('spirits', spirits)
  add('technology', technology)
  const numeric = [...rows.values()].filter((row) => Number(row.value) !== 0)
  const flags: ModifierRow[] = rules.map((r) => ({
    key: r.key,
    stat: r.stat,
    value: r.value,
    sources: {},
  }))
  return STAT_GROUPS.map((group) => ({
    ...group,
    rows: [...numeric, ...flags]
      .filter((row) => statGroupOf(row.key) === group.id)
      .sort((a, b) => statLabel(a.stat).localeCompare(statLabel(b.stat))),
  })).filter((group) => group.rows.length > 0)
}
