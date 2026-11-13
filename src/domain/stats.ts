/**
 * Universal handling of stat changes (modifiers like `guarantee_cost = -0.5`). A stat's
 * definition says how its raw script value is shown; where definitions come from, in priority
 * order: hand-written overrides (`src/data/statOverrides.ts`), the game's modifier documentation,
 * then a guess from the key and value.
 */
export type StatKind = 'percent' | 'number' | 'flag'
export type StatTone = 'good' | 'bad' | 'neutral'

export interface StatDefinition {
  key: string
  /** Display name; the humanized key when none is known. */
  label?: string
  kind?: StatKind
  /** Maximum decimals to show (trailing zeros are dropped unless `fixedDecimals` is set). */
  decimals?: number
  /** Always show exactly `decimals` digits, e.g. `1.00%` rather than `1%`. */
  fixedDecimals?: boolean
  /** Put a `+` before positive values. On by default; turn off where the colour says it. */
  showPlus?: boolean
  /** Which direction of change is good for the player; neutral when unset. */
  goodWhen?: 'positive' | 'negative'
}

/** What the game's modifier documentation says about each modifier. */
export type StatDocs = Record<string, Pick<StatDefinition, 'kind' | 'decimals'>>

export type StatOverrides = Record<string, Omit<StatDefinition, 'key'>>

/**
 * Reads `documentation/modifiers_documentation.md`: `## key` sections containing either
 * `Number with N decimal places` or `Boolean`. It does not say percent vs number, so only the
 * decimals (and flags) are taken from it.
 */
export const parseStatDocs = (text: string): StatDocs => {
  const docs: StatDocs = {}
  for (const section of text.split(/^## /m).slice(1)) {
    const key = section.split('\n', 1)[0].trim()
    const decimals = /^\* Number with (\d+) decimal places/m.exec(section)
    if (decimals) docs[key] = { decimals: Number(decimals[1]) }
    else if (/^\* Boolean/m.test(section)) docs[key] = { kind: 'flag' }
  }
  return docs
}

/**
 * A modifier's localised name as a plain label. The game writes some for its own tooltips, with a
 * trailing `: ` before the value, a `$VALUE|Y0$` or `$RIGHT|+=%$` template for where the value
 * goes, an icon that leaves `( )` behind, or spacing left over from one; we draw `label: value`
 * ourselves.
 */
export const tidyLabel = (label: string | undefined): string | undefined =>
  label
    ?.replace(/:?\s*\$[A-Za-z]+\|[^$]*\$/g, '')
    .replace(/\s*\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[:\s]+$/, '')
    .trim() || undefined

/** Combines the three sources into one definition. */
export const resolveStat = (
  key: string,
  label: string | undefined,
  docs: StatDocs,
  overrides: StatOverrides,
  /** Fallbacks below the docs, e.g. `{ kind: 'flag' }` for yes/no rules. */
  defaults: Partial<StatDefinition> = {},
): StatDefinition => ({
  key,
  label: tidyLabel(label),
  ...defaults,
  ...docs[key],
  ...overrides[key],
})

const trimmed = (n: number, decimals: number) => String(Number(n.toFixed(decimals)))

/** Formats a raw script value for a stat, e.g. `-0.5` as `-50%`. */
export const formatStatValue = (stat: StatDefinition, raw: string): string => {
  if (stat.kind === 'flag') return raw === 'no' || raw === '0' ? 'no' : 'yes'
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  // Without a known kind, `_factor` stats and fractional values are percentages (HoI4 style).
  const kind =
    stat.kind ??
    (stat.key.endsWith('_factor') || (!Number.isInteger(n) && Math.abs(n) <= 1)
      ? 'percent'
      : 'number')
  const sign = n > 0 && stat.showPlus !== false ? '+' : ''
  const digits = (value: number, decimals: number) =>
    stat.fixedDecimals ? value.toFixed(decimals) : trimmed(value, decimals)
  return kind === 'percent'
    ? `${sign}${digits(n * 100, Math.max(stat.decimals ?? 1, 1))}%`
    : `${sign}${digits(n, stat.decimals ?? 2)}`
}

export const statLabel = (stat: StatDefinition): string => stat.label ?? stat.key.replace(/_/g, ' ')

export const statTone = (stat: StatDefinition, raw: string): StatTone => {
  if (stat.kind === 'flag') {
    // Yes is green and no is red, unless the stat says that turning it on is the bad direction.
    const on = raw !== 'no' && raw !== '0'
    return on === (stat.goodWhen !== 'negative') ? 'good' : 'bad'
  }
  const n = Number(raw)
  if (!stat.goodWhen || !Number.isFinite(n) || n === 0) return 'neutral'
  return n > 0 === (stat.goodWhen === 'positive') ? 'good' : 'bad'
}
