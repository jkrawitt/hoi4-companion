import { fromGameDay, wholeDay } from '../calendar'
import type { FocusSchedule } from '../plan/types'
import type { PoliticalOption, PoliticsSchedule } from '../politics'
import type { ConstructionSchedule, ProductionData } from '../production'
import type { ResearchSchedule, Technology } from '../research'
import { adjustableStat, importCost, type Adjustments } from '../adjustments'
import { formatStatValue, statLabel } from '../stats'

export type TimelineKind = 'focus' | 'research' | 'construction' | 'politics' | 'adjustment'

export interface TimelineEntry {
  /**
   * Stable across plan changes (no dates in it), so an action checked off in the timeline stays
   * checked when the plan around it moves.
   */
  id: string
  kind: TimelineKind
  text: string
  detail?: string
  /** The game does it by itself (a build a focus queues). */
  automatic?: boolean
}

export interface TimelineDay {
  date: Date
  day: number
  /** What finished on the day. */
  done: TimelineEntry[]
  /** What starts on the day, and so what the player should do. */
  todo: TimelineEntry[]
}

export interface TimelineInput {
  focusSchedule: FocusSchedule
  research?: ResearchSchedule
  techs: Record<string, Technology>
  construction?: ConstructionSchedule
  production?: ProductionData
  politics?: PoliticsSchedule
  options: PoliticalOption[]
  /** What the player entered from the game; listed as done on its dates. */
  adjustments?: Adjustments
  resourceCost?: Record<string, number>
}

export interface Timeline {
  days: TimelineDay[]
  /** Counts of what never happens, for a footer. */
  unscheduled: { research: number; politics: number; construction: number }
}

const KIND_ORDER: Record<TimelineKind, number> = {
  focus: 0,
  research: 1,
  construction: 2,
  politics: 3,
  adjustment: 4,
}

export const buildTimeline = (input: TimelineInput): Timeline => {
  type Row = { entry: TimelineEntry; order: number }
  const byDay = new Map<number, { done: Row[]; todo: Row[] }>()
  const add = (date: Date, list: 'done' | 'todo', entry: TimelineEntry, order: number) => {
    const day = wholeDay(date)
    let bucket = byDay.get(day)
    if (!bucket) byDay.set(day, (bucket = { done: [], todo: [] }))
    bucket[list].push({ entry, order })
  }

  for (const [i, item] of input.focusSchedule.items.entries()) {
    const name = item.focus.name
    add(
      item.end,
      'done',
      { id: `focus-done:${item.focus.id}`, kind: 'focus', text: `Focus ${name} completed` },
      i,
    )
    add(
      item.start,
      'todo',
      {
        id: `focus:${item.focus.id}`,
        kind: 'focus',
        text: `Start focus ${name}`,
        detail: `${Math.round(item.durationDays * 10) / 10} days`,
      },
      i,
    )
  }

  for (const item of input.research?.items ?? []) {
    if (item.slot < 0) continue
    const name = input.techs[item.techId]?.name ?? item.techId
    const slot = `slot ${item.slot + 1}`
    const order = item.slot * 1000 + item.index
    add(
      item.end,
      'done',
      {
        id: `research-done:${item.techId}`,
        kind: 'research',
        text: `${name} researched (${slot})`,
      },
      order,
    )
    const details: string[] = []
    if (item.bonusUsed) details.push('using a bonus')
    if (item.ahead.years > 0) details.push(`${Math.round(item.ahead.years * 10) / 10} years early`)
    add(
      item.start,
      'todo',
      {
        id: `research:${item.techId}`,
        kind: 'research',
        text: `Research ${name} in ${slot}`,
        detail: details.length ? details.join(', ') : undefined,
      },
      order,
    )
  }

  const buildingName = (id: string) =>
    input.production?.buildings.find((b) => b.id === id)?.name ?? id
  const stateName = (id: number) =>
    input.production?.states.find((s) => s.id === id)?.name ?? `State ${id}`
  let constructionUnscheduled = 0
  for (const [i, item] of (input.construction?.items ?? []).entries()) {
    if (item.levels.length === 0 && item.issues.length > 0) constructionUnscheduled++
    const building = buildingName(item.item.building)
    const state = stateName(item.item.state)
    const automatic = item.source === 'focus'
    const order = (automatic ? 100000 : 0) + i
    for (const [k, level] of item.levels.entries()) {
      const progress = `${k + 1}/${item.item.levels}`
      const key = `${item.source}:${item.source === 'focus' ? item.focusName : item.index}:${item.item.building}:${item.item.state}:${k}`
      add(
        level.end,
        'done',
        {
          id: `construction-done:${key}`,
          kind: 'construction',
          text: `${building} level ${progress} built in ${state}`,
          automatic,
        },
        order,
      )
      add(
        level.start,
        'todo',
        {
          id: `construction:${key}`,
          kind: 'construction',
          text: `Build ${building} in ${state} (${progress}, ${level.civs} civs)`,
          detail: automatic && item.focusName ? `from ${item.focusName}` : undefined,
          automatic,
        },
        order,
      )
    }
  }

  const optionName = (id: string) => input.options.find((o) => o.id === id)?.name ?? id
  for (const item of input.politics?.items ?? []) {
    const name = optionName(item.optionId)
    add(
      item.date,
      'todo',
      {
        id: `politics:${item.index}:${item.optionId}${item.dismiss ? ':dismiss' : ''}`,
        kind: 'politics',
        text: item.dismiss ? `Dismiss ${name}` : `Buy ${name} (${Math.round(item.cost)} PP)`,
        detail: `${Math.round(item.balanceAfter)} PP left`,
      },
      item.index,
    )
  }

  const adj = input.adjustments
  const parseDay = (text: string) => new Date(`${text}T00:00:00Z`)
  for (const [i, s] of (adj?.stability ?? []).entries()) {
    add(
      parseDay(s.date),
      'done',
      {
        id: `adjustment:${s.id}`,
        kind: 'adjustment',
        text: `Stability set to ${Math.round(s.value * 1000) / 10}%`,
      },
      i,
    )
  }
  for (const [i, m] of (adj?.modifiers ?? []).entries()) {
    const stat = adjustableStat(m.key)
    add(
      parseDay(m.date),
      'done',
      {
        id: `adjustment:${m.id}`,
        kind: 'adjustment',
        text:
          `Event modifier ${m.name} (${formatStatValue(stat, String(m.value))} ${statLabel(stat).toLowerCase()})` +
          (m.days ? ` for ${m.days} days` : ''),
      },
      100 + i,
    )
  }
  for (const [i, r] of (adj?.received ?? []).entries()) {
    add(
      parseDay(r.date),
      'done',
      {
        id: `adjustment:${r.id}`,
        kind: 'adjustment',
        text: `Trade: ${r.civs >= 0 ? '+' : ''}${r.civs} civs received`,
      },
      200 + i,
    )
  }
  for (const [i, t] of (adj?.imports ?? []).entries()) {
    add(
      parseDay(t.from),
      'done',
      {
        id: `adjustment:${t.id}`,
        kind: 'adjustment',
        text: `Importing ${t.amount} ${t.resource} (${importCost(t, input.resourceCost ?? {})} civs)`,
        detail: t.until ? `until ${t.until}` : undefined,
      },
      300 + i,
    )
  }

  const sortRows = (rows: Row[]) =>
    rows
      .map((r, i) => ({ ...r, i }))
      .sort(
        (a, b) =>
          KIND_ORDER[a.entry.kind] - KIND_ORDER[b.entry.kind] || a.order - b.order || a.i - b.i,
      )
      .map((r) => r.entry)

  const days = [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, rows]) => ({
      date: fromGameDay(day),
      day,
      done: sortRows(rows.done),
      todo: sortRows(rows.todo),
    }))

  return {
    days,
    unscheduled: {
      research: input.research?.unscheduled.length ?? 0,
      politics: input.politics?.unscheduled.length ?? 0,
      construction: constructionUnscheduled,
    },
  }
}
