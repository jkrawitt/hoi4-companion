/**
 * Applies one reward (a completed focus's, or the game start's) to the country's running state.
 *
 * `applyReward` settles the conditions it can, sorts the lines into the ones that happen for sure
 * and the ones that might not (`rewardScopes.ts`), then offers each certain line to the handlers
 * below in turn; the first that recognises it takes it. Each handler changes only its own part of
 * `Working`, so a new kind of effect is a new handler.
 */
import { START_ID, type EffectLine } from '../focus'
import { blockEnd } from '../effects/lines'
import { ideaLineIndexes, removedIdeaLineIndexes } from '../effects/ideaLines'
import { addDays } from '../plan/focusPlan'
import { resolveConditions } from './conditions'
import { CONSTRUCTION_KEYS, classify, splitConstruction } from './rewardScopes'
import { newResearchWorking, recordResearchState, type ResearchWorking } from './researchEvents'
import { activeModifiers, addTo, countryStat, isNumeric, round } from './totals'
import { DEFAULT_POLITICS_DEFINES } from '../politics'
import type {
  ActiveIdea,
  BuildingTotal,
  ConditionalEffects,
  ConstructionBatch,
  CountryLeader,
  CountryStateOptions,
  PopularityChange,
  ResourceTotal,
  StatTotal,
} from './types'

/** A reward and when it is finished. */
export interface Step {
  focus: { id: string; name: string; effects: EffectLine[] }
  end: Date
}

/** Everything the rewards applied so far have done to the country. */
export interface Working {
  ideas: Map<string, ActiveIdea>
  statChanges: Map<string, StatTotal>
  popularity: Map<string, PopularityChange>
  conditional: ConditionalEffects[]
  buildings: Map<string, BuildingTotal>
  buildingSlots: number
  construction: ConstructionBatch[]
  resources: Map<string, ResourceTotal>
  rulingParty?: string
  /** The ruling ideology group as the scripts name it (`communism`), for conditions. */
  government?: string
  doneFocuses: Set<string>
  /** Who leads, for conditions: unknown again after `retire_country_leader`, as the game picks next. */
  identity?: { id?: string; character?: string }
  /** The ideology group the leader leads for, when known (a new leader, not a bare role). */
  leaderGroup?: string
  retiredLeaders: Set<string>
  leader?: CountryLeader
  research: ResearchWorking
  /** The characters recruited so far, whom advisors need to be hired. */
  recruited: Set<string>
}

export const newWorking = (): Working => ({
  ideas: new Map(),
  statChanges: new Map(),
  popularity: new Map(),
  conditional: [],
  buildings: new Map(),
  buildingSlots: 0,
  construction: [],
  resources: new Map(),
  doneFocuses: new Set(),
  retiredLeaders: new Set(),
  research: newResearchWorking(),
  recruited: new Set(),
})

/** What a handler needs to know about the reward it is part of. */
interface Context {
  w: Working
  step: Step
  options: CountryStateOptions
  effects: EffectLine[]
  /** Indexes of lines that add / remove an idea. */
  added: Set<number>
  removed: Set<number>
  /** Lines that belong to an idea or a leader (their modifiers), not to the reward's own changes. */
  owned: Set<number>
  /** Construction effects that happen, to be totalled once the reward is done. */
  built: EffectLine[]
  /** Set by the handlers: the reward made, or retired, a leader. */
  leaderChosen: boolean
  leaderRetired: boolean
  /** How many research bonuses the reward has given so far, to tell them apart. */
  techBonuses: number
}

type Handler = (c: Context, e: EffectLine, i: number) => boolean

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

/** The lines inside the block at `index`, moved up to depth 0. */
const childrenAt = (effects: EffectLine[], index: number): EffectLine[] => {
  const base = effects[index].depth + 1
  return effects
    .slice(index + 1, blockEnd(effects, index))
    .map((e) => ({ ...e, depth: e.depth - base }))
}

const LEADER_KEYS = new Set([
  'create_country_leader',
  'add_country_leader_role',
  'add_country_leader_trait',
])

// --- Handlers, one per kind of effect. ---

const ideas: Handler = (c, e, i) => {
  if (c.added.has(i) && e.value) {
    // A country has one law per category: a new one replaces the old.
    const law = c.options.laws?.[e.value]
    if (law) {
      for (const id of c.w.ideas.keys()) {
        if (id !== e.value && c.options.laws?.[id] === law) c.w.ideas.delete(id)
      }
    }
    if (e.slot) {
      // A politics slot that is full gives up its oldest idea: a new concern replaces the old one,
      // and an advisor needs a free slot (the planner dismisses one first).
      const capacity = c.options.politics?.slots[e.slot] ?? 1
      const held = [...c.w.ideas.values()].filter((x) => x.slot === e.slot && x.id !== e.value)
      for (const old of held.slice(0, Math.max(0, held.length - capacity + 1))) {
        c.w.ideas.delete(old.id)
      }
    }
    c.w.ideas.set(e.value, {
      id: e.value,
      name: e.valueName ?? e.value,
      focusId: c.step.focus.id,
      focusName: c.step.focus.name,
      since: c.step.end,
      until: e.key === 'add_timed_idea' && e.days ? addDays(c.step.end, e.days) : undefined,
      modifiers: childrenAt(c.effects, i).filter(
        (m) => (m.isModifier || m.isRule) && m.stat !== undefined,
      ),
      ...(e.slot && { slot: e.slot }),
      ...(e.researchBonus && { researchBonus: e.researchBonus }),
    })
    return true
  }
  if (c.removed.has(i) && e.value) {
    c.w.ideas.delete(e.value)
    return true
  }
  return false
}

const recruit: Handler = ({ w }, e) => {
  if (e.key !== 'recruit_character' || !e.value) return false
  w.recruited.add(e.value)
  return true
}

const construction: Handler = (c, e) => {
  if (e.key === null || !CONSTRUCTION_KEYS.has(e.key)) return false
  c.built.push({ ...e, depth: 0 })
  return true
}

const popularity: Handler = ({ w }, e) => {
  if (e.key !== 'add_popularity' || !e.subject || !isNumeric(e.value) || !e.stat) return false
  w.popularity.set(e.subject, {
    key: e.key,
    stat: e.stat,
    total: round((w.popularity.get(e.subject)?.total ?? 0) + Number(e.value)),
    subject: e.subject,
    subjectName: e.subjectName ?? e.subject,
  })
  return true
}

const politics: Handler = ({ w }, e) => {
  if (e.key !== 'set_politics' || !e.value) return false
  w.rulingParty = e.valueName ?? e.value
  w.government = e.value
  return true
}

const leaders: Handler = (c, e, i) => {
  const { w } = c
  const groupOf = (ideology: string | undefined) =>
    ideology ? (c.options.leaders?.groups[ideology] ?? ideology) : undefined

  if (e.key === 'retire_country_leader') {
    w.identity = undefined
    c.leaderRetired = true
    if (w.leader?.character) w.retiredLeaders.add(w.leader.character)
    return true
  }
  if (e.key === 'create_country_leader' && e.value) {
    w.leader = {
      name: e.value,
      ideology: ideologyName(e),
      traits: childrenAt(c.effects, i),
      id: e.leaderId,
    }
    w.identity = { id: e.leaderId }
    w.leaderGroup = groupOf(e.subject)
    c.leaderChosen = true
    return true
  }
  if (e.key === 'add_country_leader_trait' && e.value && w.leader) {
    const trait: EffectLine = { depth: 0, key: 'leader_trait', value: e.value }
    if (e.valueName) trait.valueName = e.valueName
    w.leader = {
      ...w.leader,
      traits: [...withoutTrait(w.leader.traits, e.value), trait, ...childrenAt(c.effects, i)],
    }
    return true
  }
  if (e.key === 'remove_country_leader_trait' && e.value && w.leader) {
    w.leader = { ...w.leader, traits: withoutTrait(w.leader.traits, e.value) }
    return true
  }
  if (e.key === 'promote_character' && e.value) {
    w.leader = {
      name: e.valueName ?? e.value,
      ideology: ideologyName(e),
      traits: [],
      character: e.value,
    }
    w.identity = { character: e.value }
    w.leaderGroup = groupOf(e.subject)
    c.leaderChosen = true
    return true
  }
  if (e.key === 'add_country_leader_role' && e.value === 'promote') {
    const scope = parentOf(c.effects, i)
    if (!scope?.key) return false
    w.leader = {
      name: scope.subjectName ?? scope.key,
      traits: childrenAt(c.effects, i),
      character: scope.key,
    }
    w.identity = { character: scope.key }
    w.leaderGroup = undefined
    c.leaderChosen = true
    return true
  }
  return false
}

const statChange: Handler = (c, e, i) => {
  if (!e.isModifier || e.isRule || !e.stat || !e.key || c.owned.has(i) || !isNumeric(e.value)) {
    return false
  }
  addTo(c.w.statChanges, e.key, e.stat, Number(e.value))
  return true
}

/**
 * Technologies handed out and research bonuses. The bonuses of a reward are numbered in the order
 * they happen, which stays the same when a `has_tech` condition settles the other way (the
 * branches that give a bonus give the same one).
 */
const research: Handler = (c, e) => {
  const r = e.research
  if (!r) return false
  const { w, step } = c
  if (r.kind === 'unlock') {
    if (step.focus.id === START_ID) w.research.startTechs.push(...r.targets)
    else w.research.grants.push({ date: step.end, techIds: r.targets })
    return true
  }
  if (r.kind !== 'tech_bonus' || !r.bonus) return false
  w.research.bonuses.push({
    ref: { focusId: step.focus.id, index: c.techBonuses++ },
    date: step.end,
    name: step.focus.name,
    bonus: r.bonus,
    uses: r.uses ?? 1,
    ahead: r.ahead ?? 0,
    targets: r.targets,
    // Without kinds (a line built by hand) the targets are taken to be categories.
    targetKinds: r.targets.map((_, i) => r.targetKinds?.[i] ?? 'category'),
    targetNames: r.targetNames,
  })
  return true
}

const HANDLERS: Handler[] = [
  research,
  ideas,
  recruit,
  construction,
  popularity,
  leaders,
  politics,
  statChange,
]

// --- What happens after a reward's lines are applied. ---

/**
 * The game picks the next leader of the ruling party when the leader is retired, or when the party
 * changes to one the leader does not lead for (unless the reward made a leader itself).
 */
const pickNextLeader = (c: Context, governmentBefore: string | undefined) => {
  const { w } = c
  const { government } = w
  if (c.leaderChosen || !government) return
  const partyChanged = government !== governmentBefore
  const leaderMismatch = w.leaderGroup !== undefined && w.leaderGroup !== government
  if (!c.leaderRetired && !(partyChanged && leaderMismatch)) return

  const next = c.options.leaders?.candidates.find(
    (cand) => cand.group === government && !w.retiredLeaders.has(cand.line.value ?? ''),
  )
  if (!next?.line.value) return
  w.leader = {
    name: next.line.valueName ?? next.line.value,
    ideology: next.line.subjectName ?? next.line.subject,
    traits: [],
    character: next.line.value,
  }
  w.identity = { character: next.line.value }
  w.leaderGroup = government
}

/** Totals the construction effects that happen: resources, buildings and building slots. */
const totalConstruction = (w: Working, built: EffectLine[]) => {
  for (const l of built) {
    if (l.key === 'add_extra_state_shared_building_slots' && isNumeric(l.value)) {
      w.buildingSlots += Number(l.value)
    }
    if (!l.subject || !isNumeric(l.value)) continue
    if (l.key === 'add_resource') {
      const total = w.resources.get(l.subject)?.total ?? 0
      w.resources.set(l.subject, {
        type: l.subject,
        name: l.subjectName ?? l.subject,
        total: round(total + Number(l.value)),
      })
    } else if (l.key === 'add_building_construction') {
      const id = `${l.subject}${l.instant ? ':instant' : ''}`
      const total = w.buildings.get(id)?.total ?? 0
      w.buildings.set(id, {
        type: l.subject,
        name: l.subjectName ?? l.subject,
        total: total + Number(l.value),
        instant: l.instant === true,
      })
    }
  }
}

/** Groups the construction lines of a reward into one batch per header block. */
const recordBatches = (w: Working, step: Step, built: EffectLine[]) => {
  let batch: ConstructionBatch | undefined
  const start = (header?: EffectLine) => {
    const key = header?.key ?? ''
    const state = /^\d+$/.test(key) ? Number(key) : undefined
    const prefer = header?.preferStates?.map(Number).filter((n) => Number.isFinite(n))
    batch = {
      focusId: step.focus.id,
      focusName: step.focus.name,
      date: step.end,
      state,
      prefer: prefer && prefer.length > 0 ? prefer : undefined,
      random: key.startsWith('random_owned_'),
      buildings: [],
      slots: 0,
      resources: [],
    }
    w.construction.push(batch)
  }
  for (const l of built) {
    const isConstruction = l.key !== null && CONSTRUCTION_KEYS.has(l.key)
    if (!isConstruction) {
      start(l)
      continue
    }
    // A loose top-level line (not under a header) gets a batch of its own.
    if (l.depth === 0 || !batch) start()
    if (!batch || !isNumeric(l.value)) continue
    if (l.key === 'add_extra_state_shared_building_slots') batch.slots += Number(l.value)
    else if (!l.subject) continue
    else if (l.key === 'add_resource') {
      batch.resources.push({
        type: l.subject,
        name: l.subjectName ?? l.subject,
        amount: Number(l.value),
      })
    } else {
      batch.buildings.push({
        type: l.subject,
        name: l.subjectName ?? l.subject,
        level: Number(l.value),
        instant: l.instant === true,
      })
    }
  }
}

/** The indexes of the lines under every line that is an idea or a leader. */
const ownedLines = (effects: EffectLine[], owners: number[]): Set<number> => {
  const owned = new Set<number>()
  for (const index of owners) {
    for (let j = index + 1; j < blockEnd(effects, index); j++) owned.add(j)
  }
  return owned
}

export const applyReward = (w: Working, step: Step, options: CountryStateOptions) => {
  const { focus } = step
  // Conditions about what the country has by now (ideas, focuses, government, popularity) are
  // settled, so the branch that applies counts like any other lines.
  const effects = resolveConditions(focus.effects, {
    hasIdea: (id) => {
      const idea = w.ideas.get(id)
      return idea !== undefined && (!idea.until || idea.until > step.end)
    },
    hasFocus: (id) => w.doneFocuses.has(id),
    government: () => w.government,
    leader: () => w.identity,
    // Only known once the start has set the popularities; the plan alone only has changes.
    popularity: (ideology) =>
      options.start?.length ? (w.popularity.get(ideology)?.total ?? 0) : undefined,
    hasTech: (id) => options.hasTech?.(id, step.end),
    tag: options.tag,
    hasDlc: options.ownedDlc ? (id) => options.ownedDlc![id] === true : undefined,
    // The actual stat: only known once the start has set it, like popularity.
    stat: (key) => {
      if (!options.start?.length) return undefined
      const active = [...w.ideas.values()].filter((idea) => !idea.until || idea.until > step.end)
      const { totals } = activeModifiers(active, w.leader?.traits ?? [])
      return countryStat(
        key,
        options.start,
        w.statChanges.get(`add_${key}`)?.total ?? 0,
        (k) => totals.get(k)?.total ?? 0,
        w.government ? (w.popularity.get(w.government)?.total ?? 0) : 0,
        (options.politics?.defines ?? DEFAULT_POLITICS_DEFINES).partyStability,
      )
    },
  })

  const { applied, conditional: skipped, states } = classify(effects, options.tag)
  const built: EffectLine[] = []
  // In the order they stand in the reward, which is the order the game builds in.
  const blocks = [
    ...states.map((block) => ({ block, state: true })),
    ...skipped.map((block) => ({ block, state: false })),
  ].sort((a, b) => effects.indexOf(a.block[0]) - effects.indexOf(b.block[0]))
  for (const { block, state } of blocks) {
    const { built: moved, rest } = splitConstruction(block)
    built.push(...moved)
    if (!state && rest.length > 0) {
      w.conditional.push({ focusId: focus.id, focusName: focus.name, lines: rest })
    }
  }

  const added = new Set(ideaLineIndexes(effects))
  const removed = new Set(removedIdeaLineIndexes(effects))
  const leaderLines = effects.flatMap((e, i) => (e.key && LEADER_KEYS.has(e.key) ? [i] : []))
  const c: Context = {
    w,
    step,
    options,
    effects,
    added,
    removed,
    // The modifier lines under an idea belong to it, and a leader's traits and their stats to the
    // leader: neither is one of the focus's own stat changes.
    owned: ownedLines(effects, [...added, ...removed, ...leaderLines]),
    built,
    leaderChosen: false,
    leaderRetired: false,
    techBonuses: 0,
  }
  const governmentBefore = w.government

  effects.forEach((e, i) => {
    if (!applied.has(i)) return
    HANDLERS.some((handle) => handle(c, e, i))
  })

  pickNextLeader(c, governmentBefore)
  w.doneFocuses.add(focus.id)
  totalConstruction(w, built)
  recordBatches(w, step, built)
  recordResearchState(w.research, step.end, w.statChanges.get('add_research_slot')?.total ?? 0, {
    ideas: [...w.ideas.values()],
    traits: w.leader?.traits ?? [],
    stabilityBase: w.statChanges.get('add_stability')?.total ?? 0,
    rulingPopularity: (w.government && w.popularity.get(w.government)?.total) || 0,
  })
}
