/**
 * What the plan has done to a country by a given date: the part of the app that turns the focus
 * plan (and, later, other planners) into one picture.
 *
 * A completed focus's reward counts as applied when it sits at the top level or inside a
 * `hidden_effect` (which still happens). Rewards inside `if`/`else`/`random_*` blocks may or may not
 * happen, so they are only listed (`conditional`). Rewards inside another country's scope or a
 * state scope change something other than this country and are skipped.
 */
import type { EffectLine, FocusSchedule, ScheduledFocus } from '../focus'
import { blockEnd, isCountryTag, opensBlock } from '../effects/lines'
import { ideaLineIndexes, removedIdeaLineIndexes } from '../effects/ideaLines'
import { addDays } from '../plan/focusPlan'
import type { StatDefinition } from '../stats'

export interface ActiveIdea {
  id: string
  name: string
  focusId: string
  focusName: string
  since: Date
  /** When a timed idea runs out. */
  until?: Date
  /** The idea's modifier and rule lines, at depth 0. */
  modifiers: EffectLine[]
}

export interface StatTotal {
  key: string
  stat: StatDefinition
  total: number
}

export interface RuleValue {
  key: string
  stat: StatDefinition
  value: string
}

export interface PopularityChange extends StatTotal {
  subject: string
  subjectName: string
}

export interface ConditionalEffects {
  focusId: string
  focusName: string
  lines: EffectLine[]
}

export interface CountryState {
  date: Date
  /** Focuses finished by `date`, in order. */
  completed: ScheduledFocus[]
  /** The first focus not finished yet. */
  next?: ScheduledFocus
  ideas: ActiveIdea[]
  /** One-off stat changes from rewards, e.g. stability and political power. */
  statChanges: StatTotal[]
  /** The summed numeric modifiers of the active ideas. */
  modifierTotals: StatTotal[]
  /** The yes/no rules of the active ideas. */
  rules: RuleValue[]
  /** Popularity change per ideology, as a fraction of 1 like the game scripts. */
  popularity: PopularityChange[]
  rulingParty?: string
  leader?: string
  conditional: ConditionalEffects[]
}

export interface CountryStateOptions {
  /** The country's own tag, so scopes naming it are not mistaken for another country's. */
  tag?: string
}

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
const classify = (effects: EffectLine[], tag: string | undefined) => {
  const applied = new Set<number>()
  const conditional: EffectLine[][] = []
  let i = 0
  while (i < effects.length) {
    const line = effects[i]
    if (opensBlock(line) && CONDITIONAL_HEADERS.test(line.key)) {
      const end = blockEnd(effects, i)
      conditional.push(effects.slice(i, end))
      i = end
    } else if (opensBlock(line) && isForeignScope(line.key, tag)) {
      i = blockEnd(effects, i)
    } else {
      // Plain effects, and blocks (hidden_effect, own scopes, add_ideas) that are looked into.
      applied.add(i)
      i++
    }
  }
  return { applied, conditional }
}

const parentOf = (effects: EffectLine[], index: number): EffectLine | undefined => {
  for (let i = index - 1; i >= 0; i--) {
    if (effects[i].depth < effects[index].depth) return effects[i]
  }
  return undefined
}

const round = (n: number) => Number(n.toFixed(6))

/** Adds `amount` to the total for `key`, keeping the order keys first appeared in. */
const addTo = (
  totals: Map<string, StatTotal>,
  key: string,
  stat: StatDefinition,
  amount: number,
) => {
  const existing = totals.get(key)
  if (existing) existing.total = round(existing.total + amount)
  else totals.set(key, { key, stat, total: round(amount) })
}

const isNumeric = (value: string | undefined): value is string =>
  value !== undefined && value !== '' && Number.isFinite(Number(value))

export const countryStateAt = (
  schedule: FocusSchedule,
  date: Date,
  options: CountryStateOptions = {},
): CountryState => {
  const completed = schedule.items.filter((item) => item.end <= date)
  const next = schedule.items.find((item) => item.end > date)

  const ideas = new Map<string, ActiveIdea>()
  const statChanges = new Map<string, StatTotal>()
  const popularity = new Map<string, PopularityChange>()
  const conditional: ConditionalEffects[] = []
  let rulingParty: string | undefined
  let leader: string | undefined

  for (const item of completed) {
    const { focus } = item
    const effects = focus.effects
    const { applied, conditional: skipped } = classify(effects, options.tag)
    for (const lines of skipped) {
      conditional.push({ focusId: focus.id, focusName: focus.name, lines })
    }

    const modifiersOf = (index: number): EffectLine[] => {
      const base = effects[index].depth + 1
      return effects
        .slice(index + 1, blockEnd(effects, index))
        .filter((e) => (e.isModifier || e.isRule) && e.stat !== undefined)
        .map((e) => ({ ...e, depth: e.depth - base }))
    }

    const added = new Set(ideaLineIndexes(effects))
    const removed = new Set(removedIdeaLineIndexes(effects))
    // The modifier lines under an idea belong to it, not to the focus's own stat changes.
    const inIdea = new Set<number>()
    for (const index of [...added, ...removed]) {
      for (let j = index + 1; j < blockEnd(effects, index); j++) inIdea.add(j)
    }

    effects.forEach((e, i) => {
      if (!applied.has(i)) return
      if (added.has(i) && e.value) {
        ideas.set(e.value, {
          id: e.value,
          name: e.valueName ?? e.value,
          focusId: focus.id,
          focusName: focus.name,
          since: item.end,
          until: e.key === 'add_timed_idea' && e.days ? addDays(item.end, e.days) : undefined,
          modifiers: modifiersOf(i),
        })
      } else if (removed.has(i) && e.value) {
        ideas.delete(e.value)
      } else if (e.key === 'add_popularity' && e.subject && isNumeric(e.value) && e.stat) {
        popularity.set(e.subject, {
          key: e.key,
          stat: e.stat,
          total: round((popularity.get(e.subject)?.total ?? 0) + Number(e.value)),
          subject: e.subject,
          subjectName: e.subjectName ?? e.subject,
        })
      } else if (e.key === 'set_politics' && e.value) {
        rulingParty = e.valueName ?? e.value
      } else if (e.key === 'create_country_leader' && e.value) {
        leader = e.value
      } else if (e.key === 'promote_character' && e.value) {
        leader = e.valueName ?? e.value
      } else if (e.key === 'add_country_leader_role' && e.value === 'promote') {
        const scope = parentOf(effects, i)
        if (scope?.key) leader = scope.subjectName ?? scope.key
      } else if (
        e.isModifier &&
        !e.isRule &&
        e.stat &&
        e.key &&
        !inIdea.has(i) &&
        isNumeric(e.value)
      ) {
        addTo(statChanges, e.key, e.stat, Number(e.value))
      }
    })
  }

  const active = [...ideas.values()].filter((idea) => !idea.until || idea.until > date)

  const modifierTotals = new Map<string, StatTotal>()
  const rules = new Map<string, RuleValue>()
  for (const idea of active) {
    for (const m of idea.modifiers) {
      if (!m.key || !m.stat || m.value === undefined) continue
      if (m.isRule) rules.set(m.key, { key: m.key, stat: m.stat, value: m.value })
      else if (isNumeric(m.value)) addTo(modifierTotals, m.key, m.stat, Number(m.value))
    }
  }

  return {
    date,
    completed,
    next,
    ideas: active,
    statChanges: [...statChanges.values()],
    modifierTotals: [...modifierTotals.values()],
    rules: [...rules.values()],
    popularity: [...popularity.values()],
    rulingParty,
    leader,
    conditional,
  }
}
