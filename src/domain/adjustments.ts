/**
 * Things that happen in the game that the planners cannot predict, entered by the player with the
 * date they saw them: stability moved by events, modifiers from random events, and trade. Pure
 * types and helpers; the campaign turns them into steps of the country state
 * (`adjustmentSteps`) and into the trade the construction scheduler works with (`tradeOverTime`).
 */
import type { EffectLine } from './focus'
import type { Step } from './campaign/applyReward'
import { resolveStat, type StatDefinition, type StatOverrides } from './stats'
import { DEFAULT_RESOURCE_COST, type TradePoint } from './production'
import { formatDay, parseDay } from './calendar'

/** "Stability was 63% on this date." `value` is a fraction of 1, like the game scripts. */
export interface StabilityAdjustment {
  id: string
  /** `YYYY-MM-DD`, like the campaign's view date. */
  date: string
  value: number
}

/** A modifier from a random event: `value` of the stat `key`, for `days` when given. */
export interface ModifierAdjustment {
  id: string
  date: string
  name: string
  key: string
  value: number
  days?: number
}

/** Resources the country buys: `amount` units from `from` until `until` (open ended without). */
export interface TradeImport {
  id: string
  resource: string
  amount: number
  /** The date it starts. */
  from: string
  until?: string
  /** The country it is bought from, for the player's own notes. */
  partner?: string
}

/** The civs the production screen showed as received from trade, until the next entry. */
export interface TradeReceived {
  id: string
  date: string
  civs: number
}

/** Who the country is at war with from this date on (none: at peace); replaces the entry before. */
export interface WarAdjustment {
  id: string
  date: string
  /** Country tags such as `SOV`. */
  enemies: string[]
}

export interface Adjustments {
  stability: StabilityAdjustment[]
  modifiers: ModifierAdjustment[]
  imports: TradeImport[]
  received: TradeReceived[]
  wars: WarAdjustment[]
}

export type AdjustmentKind = keyof Adjustments
export type AdjustmentEntry<K extends AdjustmentKind> = Adjustments[K][number]

export const emptyAdjustments = (): Adjustments => ({
  stability: [],
  modifiers: [],
  imports: [],
  received: [],
  wars: [],
})

/** Whether anything is entered. */
export const hasAdjustments = (adj: Adjustments): boolean =>
  Object.values(adj).some((list) => list.length > 0)

/** The saved shape, made safe: missing or wrong lists become empty ones. */
export const sanitizeAdjustments = (value: unknown): Adjustments => {
  const saved = (value ?? {}) as Partial<Record<AdjustmentKind, unknown>>
  const list = <K extends AdjustmentKind>(kind: K): Adjustments[K] =>
    (Array.isArray(saved[kind]) ? saved[kind] : []) as Adjustments[K]
  return {
    stability: list('stability'),
    modifiers: list('modifiers'),
    imports: list('imports'),
    received: list('received'),
    wars: list('wars'),
  }
}

/** The stats an event modifier can change, with how they are shown. */
export const ADJUSTABLE_STATS: { key: string; label: string; kind: 'percent' | 'number' }[] = [
  { key: 'consumer_goods_factor', label: 'Consumer goods', kind: 'percent' },
  { key: 'stability_factor', label: 'Stability', kind: 'percent' },
  { key: 'war_support_factor', label: 'War support', kind: 'percent' },
  { key: 'political_power_gain', label: 'Political power gain', kind: 'number' },
  { key: 'political_power_factor', label: 'Political power factor', kind: 'percent' },
  { key: 'production_speed_buildings_factor', label: 'Construction speed', kind: 'percent' },
  { key: 'research_speed_factor', label: 'Research speed', kind: 'percent' },
  { key: 'global_building_slots_factor', label: 'Building slots', kind: 'percent' },
]

/** The definition of an adjustable stat, as the overview shows it. */
export const adjustableStat = (key: string, overrides: StatOverrides = {}): StatDefinition => {
  const known = ADJUSTABLE_STATS.find((s) => s.key === key)
  return resolveStat(key, known?.label, {}, overrides, known && { kind: known.kind })
}

/** `At war with SOV, GER` or `At peace`. */
export const warText = (w: Pick<WarAdjustment, 'enemies'>): string =>
  w.enemies.length > 0 ? `At war with ${w.enemies.join(', ')}` : 'At peace'

/**
 * The adjustments as rewards for `countryStateAt`'s `adjustments`, the shape the political power
 * purchases have. A modifier is a national spirit (timed when it has `days`); stability is an
 * effect that sets the actual value on its day (`set_actual_stability`).
 */
export const adjustmentSteps = (adj: Adjustments, overrides: StatOverrides = {}): Step[] => [
  ...adj.stability.map(
    (s): Step => ({
      focus: {
        id: `adjust:${s.id}`,
        name: `Stability ${Math.round(s.value * 1000) / 10}%`,
        effects: [{ depth: 0, key: 'set_actual_stability', value: String(s.value) }],
      },
      end: parseDay(s.date),
    }),
  ),
  ...adj.wars.map(
    (w): Step => ({
      focus: {
        id: `adjust:${w.id}`,
        name: warText(w),
        effects: [
          {
            depth: 0,
            key: 'set_enemies',
            value: w.enemies.length > 0 ? w.enemies.join(' ') : 'none',
          },
        ],
      },
      end: parseDay(w.date),
    }),
  ),
  ...adj.modifiers.map((m): Step => {
    const header: EffectLine = {
      depth: 0,
      key: m.days ? 'add_timed_idea' : 'add_ideas',
      value: `adjust:${m.id}`,
      valueName: m.name,
      ...(m.days ? { days: m.days } : {}),
    }
    const line: EffectLine = {
      depth: 1,
      key: m.key,
      value: String(m.value),
      isModifier: true,
      stat: adjustableStat(m.key, overrides),
    }
    return {
      focus: { id: `adjust:${m.id}`, name: m.name, effects: [header, line] },
      end: parseDay(m.date),
    }
  }),
]

/** The civilian factories an import costs: `cic` per unit, rounded up. */
export const importCost = (
  imp: Pick<TradeImport, 'resource' | 'amount'>,
  resourceCost: Record<string, number>,
): number => Math.ceil(imp.amount * (resourceCost[imp.resource] ?? DEFAULT_RESOURCE_COST) - 1e-9)

/**
 * The trade as change points sorted by date: a `received` entry replaces the one before it, an
 * import costs civs from its start until its end (exclusive) and brings in its resource.
 */
export const tradeOverTime = (
  adj: Pick<Adjustments, 'imports' | 'received'>,
  resourceCost: Record<string, number>,
  energyResource: string,
): TradePoint[] => {
  const dates = new Set<number>()
  for (const r of adj.received) dates.add(parseDay(r.date).getTime())
  for (const i of adj.imports) {
    dates.add(parseDay(i.from).getTime())
    if (i.until) dates.add(parseDay(i.until).getTime())
  }
  const received = [...adj.received].sort((a, b) => a.date.localeCompare(b.date))
  return [...dates]
    .sort((a, b) => a - b)
    .map((time) => {
      const date = new Date(time)
      const day = formatDay(date)
      const active = adj.imports.filter((i) => i.from <= day && (!i.until || day < i.until))
      return {
        date,
        received: received.filter((r) => r.date <= day).pop()?.civs ?? 0,
        importCost: active.reduce((n, i) => n + importCost(i, resourceCost), 0),
        coal: active.reduce((n, i) => n + (i.resource === energyResource ? i.amount : 0), 0),
      }
    })
}
