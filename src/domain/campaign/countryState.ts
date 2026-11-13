/**
 * What the plan has done to a country by a given date: the part of the app that turns the focus
 * plan (and, later, other planners) into one picture.
 *
 * A completed focus's reward counts as applied when it sits at the top level or inside a
 * `hidden_effect` (which still happens). Rewards inside `if`/`else`/`random_*` blocks may or may not
 * happen, so they are only listed (`conditional`). Rewards inside another country's scope or a
 * state scope change something other than this country and are skipped.
 */
import { START_ID } from '../focus'
import type { EffectLine, FocusSchedule, LeaderData, ScheduledFocus } from '../focus'
import { blockEnd, isCountryTag, opensBlock } from '../effects/lines'
import { ideaLineIndexes, removedIdeaLineIndexes } from '../effects/ideaLines'
import { resolveConditions } from './conditions'
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

export interface CountryLeader {
  name: string
  /** The leader's own `id` when made by `create_country_leader`; characters have none. */
  id?: string
  /** The character leading, when the leader is one. */
  character?: string
  /** The leader's own ideology, e.g. `Conservatism`. */
  ideology?: string
  /** `leader_trait` lines with their stats beneath, at depth 0. */
  traits: EffectLine[]
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

/** Buildings built by focuses, summed per type; instant and queued builds are counted apart. */
export interface BuildingTotal {
  type: string
  name: string
  total: number
  instant: boolean
}

export interface ResourceTotal {
  type: string
  name: string
  total: number
}

export interface CountryState {
  date: Date
  /** Focuses finished by `date`, in order. */
  completed: ScheduledFocus[]
  /** The first focus not finished yet. */
  next?: ScheduledFocus
  ideas: ActiveIdea[]
  /** Stats such as stability and political power: the starting value plus rewards so far. */
  statChanges: StatTotal[]
  /** The summed numeric modifiers of the active ideas. */
  modifierTotals: StatTotal[]
  /** The yes/no rules of the active ideas. */
  rules: RuleValue[]
  /** Popularity per ideology (the start plus changes), as a fraction of 1 like the game scripts. */
  popularity: PopularityChange[]
  rulingParty?: string
  leader?: CountryLeader
  /** The production of each resource added by completed focuses, summed. */
  resources: ResourceTotal[]
  /** The buildings added by completed focuses, summed per type. */
  buildings: BuildingTotal[]
  /** Extra building slots added by completed focuses, summed. */
  buildingSlots: number
  conditional: ConditionalEffects[]
}

export interface CountryStateOptions {
  /** The country's own tag, so scopes naming it are not mistaken for another country's. */
  tag?: string
  /** What the country starts with, applied first like a reward; see `parsers/countryStart.ts`. */
  start?: EffectLine[]
  /**
   * Who the game picks as leader when one is retired or the ruling party changes under them. Without
   * it the leader stays as the plan last set it.
   */
  leaders?: LeaderData
  /** When the starting state applies, i.e. the campaign's start date. */
  startDate?: Date
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
const CONSTRUCTION_KEYS = new Set([
  'add_resource',
  'add_building_construction',
  'add_extra_state_shared_building_slots',
])

/**
 * Takes the resource and building effects out of a `random_owned_*state` block, which picks one of
 * the country's own states, so they do happen. Returns them under the block's header (which names
 * the states it prefers), and what is left of the block for the conditional list.
 */
const splitConstruction = (block: EffectLine[]): { built: EffectLine[]; rest: EffectLine[] } => {
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

const parentOf = (effects: EffectLine[], index: number): EffectLine | undefined => {
  for (let i = index - 1; i >= 0; i--) {
    if (effects[i].depth < effects[index].depth) return effects[i]
  }
  return undefined
}

/** A leader's ideology: `subjectName` when it has a localised one, else the id as words. */
const ideologyName = (e: EffectLine): string | undefined =>
  e.subject ? (e.subjectName ?? e.subject.replace(/_/g, ' ')) : undefined

/** The leader's trait lines without trait `id` and the stat lines beneath it. */
const withoutTrait = (traits: EffectLine[], id: string): EffectLine[] => {
  const start = traits.findIndex((t) => t.key === 'leader_trait' && t.value === id)
  return start === -1
    ? traits
    : [...traits.slice(0, start), ...traits.slice(blockEnd(traits, start))]
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
  // The starting state goes first, as if it were a reward finished on the start date.
  const steps = [
    ...(options.start?.length
      ? [
          {
            focus: { id: START_ID, name: 'Game start', effects: options.start },
            end: options.startDate ?? date,
          },
        ]
      : []),
    ...completed,
  ]

  const ideas = new Map<string, ActiveIdea>()
  const statChanges = new Map<string, StatTotal>()
  const popularity = new Map<string, PopularityChange>()
  const conditional: ConditionalEffects[] = []
  const buildings = new Map<string, BuildingTotal>()
  let buildingSlots = 0
  const resources = new Map<string, ResourceTotal>()
  let rulingParty: string | undefined
  /** The ruling ideology group as the scripts name it (`communism`), for conditions. */
  let government: string | undefined
  const doneFocuses = new Set<string>()
  /** Who leads, for conditions: unknown again after `retire_country_leader`, as the game picks next. */
  let identity: { id?: string; character?: string } | undefined
  /** The ideology group the leader leads for, when known (a new leader, not a bare role). */
  let leaderGroup: string | undefined
  const retiredLeaders = new Set<string>()
  const groupOf = (ideology: string | undefined) =>
    ideology ? (options.leaders?.groups[ideology] ?? ideology) : undefined
  let leader: CountryLeader | undefined

  for (const item of steps) {
    const { focus } = item
    // Conditions about what the country has by now (ideas, focuses, government, popularity) are
    // settled, so the branch that applies counts like any other lines.
    const effects = resolveConditions(focus.effects, {
      hasIdea: (id) => {
        const idea = ideas.get(id)
        return idea !== undefined && (!idea.until || idea.until > item.end)
      },
      hasFocus: (id) => doneFocuses.has(id),
      government: () => government,
      leader: () => identity,
      // Only known once the start has set the popularities; the plan alone only has changes.
      popularity: (ideology) =>
        options.start?.length ? (popularity.get(ideology)?.total ?? 0) : undefined,
    })
    const { applied, conditional: skipped, states } = classify(effects, options.tag)
    const built: EffectLine[] = []
    for (const block of states) built.push(...splitConstruction(block).built)
    for (const block of skipped) {
      const { built: moved, rest } = splitConstruction(block)
      built.push(...moved)
      if (rest.length > 0) {
        conditional.push({ focusId: focus.id, focusName: focus.name, lines: rest })
      }
    }

    const modifiersOf = (index: number): EffectLine[] => {
      const base = effects[index].depth + 1
      return effects
        .slice(index + 1, blockEnd(effects, index))
        .filter((e) => (e.isModifier || e.isRule) && e.stat !== undefined)
        .map((e) => ({ ...e, depth: e.depth - base }))
    }

    const governmentBefore = government
    let leaderChosen = false
    let leaderRetired = false
    const added = new Set(ideaLineIndexes(effects))
    const removed = new Set(removedIdeaLineIndexes(effects))
    // The modifier lines under an idea belong to it, not to the focus's own stat changes.
    const inIdea = new Set<number>()
    for (const index of [...added, ...removed]) {
      for (let j = index + 1; j < blockEnd(effects, index); j++) inIdea.add(j)
    }

    const traitsOf = (index: number): EffectLine[] => {
      const base = effects[index].depth + 1
      return effects
        .slice(index + 1, blockEnd(effects, index))
        .map((e) => ({ ...e, depth: e.depth - base }))
    }
    // A leader's traits and their stats belong to the leader, not to the focus's own changes.
    for (let i = 0; i < effects.length; i++) {
      if (
        effects[i].key === 'create_country_leader' ||
        effects[i].key === 'add_country_leader_role' ||
        effects[i].key === 'add_country_leader_trait'
      ) {
        for (let j = i + 1; j < blockEnd(effects, i); j++) inIdea.add(j)
      }
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
      } else if (e.key !== null && CONSTRUCTION_KEYS.has(e.key)) {
        built.push({ ...e, depth: 0 })
      } else if (e.key === 'add_popularity' && e.subject && isNumeric(e.value) && e.stat) {
        popularity.set(e.subject, {
          key: e.key,
          stat: e.stat,
          total: round((popularity.get(e.subject)?.total ?? 0) + Number(e.value)),
          subject: e.subject,
          subjectName: e.subjectName ?? e.subject,
        })
      } else if (e.key === 'retire_country_leader') {
        identity = undefined
        leaderRetired = true
        if (leader?.character) retiredLeaders.add(leader.character)
      } else if (e.key === 'set_politics' && e.value) {
        rulingParty = e.valueName ?? e.value
        government = e.value
      } else if (e.key === 'create_country_leader' && e.value) {
        leader = { name: e.value, ideology: ideologyName(e), traits: traitsOf(i), id: e.leaderId }
        identity = { id: e.leaderId }
        leaderGroup = groupOf(e.subject)
        leaderChosen = true
      } else if (e.key === 'add_country_leader_trait' && e.value && leader) {
        const trait: EffectLine = { depth: 0, key: 'leader_trait', value: e.value }
        if (e.valueName) trait.valueName = e.valueName
        leader = {
          ...leader,
          traits: [...withoutTrait(leader.traits, e.value), trait, ...traitsOf(i)],
        }
      } else if (e.key === 'remove_country_leader_trait' && e.value && leader) {
        leader = { ...leader, traits: withoutTrait(leader.traits, e.value) }
      } else if (e.key === 'promote_character' && e.value) {
        leader = {
          name: e.valueName ?? e.value,
          ideology: ideologyName(e),
          traits: [],
          character: e.value,
        }
        identity = { character: e.value }
        leaderGroup = groupOf(e.subject)
        leaderChosen = true
      } else if (e.key === 'add_country_leader_role' && e.value === 'promote') {
        const scope = parentOf(effects, i)
        if (scope?.key) {
          leader = {
            name: scope.subjectName ?? scope.key,
            traits: traitsOf(i),
            character: scope.key,
          }
          identity = { character: scope.key }
          leaderGroup = undefined
          leaderChosen = true
        }
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
    // The game picks the next leader of the ruling party when the leader is retired, or when the
    // party changes to one the leader does not lead for (unless the reward made a leader itself).
    if (
      !leaderChosen &&
      government &&
      (leaderRetired ||
        (government !== governmentBefore &&
          leaderGroup !== undefined &&
          leaderGroup !== government))
    ) {
      const next = options.leaders?.candidates.find(
        (c) => c.group === government && !retiredLeaders.has(c.line.value ?? ''),
      )
      if (next?.line.value) {
        leader = {
          name: next.line.valueName ?? next.line.value,
          ideology: next.line.subjectName ?? next.line.subject,
          traits: [],
          character: next.line.value,
        }
        identity = { character: next.line.value }
        leaderGroup = government
      }
    }
    doneFocuses.add(focus.id)
    for (const l of built) {
      if (l.key === 'add_extra_state_shared_building_slots' && isNumeric(l.value)) {
        buildingSlots += Number(l.value)
      }
      if (!l.subject || !isNumeric(l.value)) continue
      if (l.key === 'add_resource') {
        const total = resources.get(l.subject)?.total ?? 0
        resources.set(l.subject, {
          type: l.subject,
          name: l.subjectName ?? l.subject,
          total: round(total + Number(l.value)),
        })
      } else if (l.key === 'add_building_construction') {
        const id = `${l.subject}${l.instant ? ':instant' : ''}`
        const total = buildings.get(id)?.total ?? 0
        buildings.set(id, {
          type: l.subject,
          name: l.subjectName ?? l.subject,
          total: total + Number(l.value),
          instant: l.instant === true,
        })
      }
    }
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

  // The leader's traits change the country like a national spirit does.
  for (const m of leader?.traits ?? []) {
    if (m.isModifier && !m.isRule && m.key && m.stat && isNumeric(m.value)) {
      addTo(modifierTotals, m.key, m.stat, Number(m.value))
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
    resources: [...resources.values()],
    buildings: [...buildings.values()],
    buildingSlots,
    conditional,
  }
}
