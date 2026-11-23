/**
 * Applies one reward (a completed focus's, or the game start's) to the country's running state.
 * The state itself and its stat formulas are in `working.ts`, popularity shifts in `popularity.ts`,
 * the balance-of-power spirit in `drift.ts` and the construction totals in `rewardConstruction.ts`.
 *
 * `applyReward` settles the conditions it can, sorts the lines into the ones that happen for sure
 * and the ones that might not (`rewardScopes.ts`), then offers each certain line to the handlers
 * below in turn; the first that recognises it takes it. Each handler changes only its own part of
 * `Working`, so a new kind of effect is a new handler.
 */
import { START_ID, type EffectLine, type Step } from '../focus'
import { blockEnd } from '../effects/lines'
import { ideaLineIndexes, removedIdeaLineIndexes } from '../effects/ideaLines'
import { addDays } from '../plan/focusPlan'
import { clampBalance } from '../balanceOfPower'
import { evaluateCheck } from '../checks'
import { annotateConditions, resolveConditions } from './conditions'
import { countryConditions, factsOfWorking } from './countryConditions'
import { syncBalanceOfPower } from './drift'
import { shiftPopularity } from './popularity'
import { recordBatches, totalConstruction } from './rewardConstruction'
import { CONSTRUCTION_KEYS, classify, splitConstruction } from './rewardScopes'
import { addTo, isNumeric, round } from './totals'
import type { CountryStateOptions } from './types'
import { rawStatNow, snapshotResearch, type Working } from './working'

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
  'promote_character',
])

// --- Handlers, one per kind of effect. ---

const ideas: Handler = (c, e, i) => {
  // `show_ideas_tooltip` only shows an idea in the tooltip (a focus unlocking an advisor, say):
  // nothing is added. What it unlocks is bought through the political power plan.
  if (e.key === 'show_ideas_tooltip') return c.added.has(i)
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

/**
 * The parties' popularity always adds up to 100%: the start sets each one, and a later change to
 * one party is taken from the others in proportion to their share (`shiftPopularity`). Without the
 * start there is only the changes, which are added as they are.
 */
const popularity: Handler = ({ w, step, options }, e) => {
  if (e.key !== 'add_popularity' || !e.subject || !isNumeric(e.value) || !e.stat) return false
  const known = w.popularity.has(e.subject)
  if (step.focus.id === START_ID || !options.start?.length || !known) {
    w.popularity.set(e.subject, {
      key: e.key,
      stat: e.stat,
      total: round((w.popularity.get(e.subject)?.total ?? 0) + Number(e.value)),
      subject: e.subject,
      subjectName: e.subjectName ?? e.subject,
    })
  } else {
    shiftPopularity(w, e.subject, Number(e.value))
  }
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
    // The traits listed beneath the line, or those of the character's role as the importer read
    // them (a reward only names the character).
    const listed = childrenAt(c.effects, i)
    const known = c.options.leaders?.candidates.find(
      (cand) => cand.line.value === e.value && (!e.subject || cand.line.subject === e.subject),
    )
    w.leader = {
      name: e.valueName ?? e.value,
      ideology: ideologyName(e),
      traits: listed.length > 0 ? listed : (known?.traits ?? []),
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
 * `set_actual_stability` (what the player saw in game): moves the `add_stability` total by the
 * difference between the target and the stability now, so the actual stability is the target on
 * that day whatever the plan did before. The current value is not kept between 0 and 1, so a value
 * pinned at the edge does not throw the difference off.
 */
const setActualStability: Handler = (c, e) => {
  if (e.key !== 'set_actual_stability' || !isNumeric(e.value)) return false
  const { w, step, options } = c
  const current = rawStatNow(w, options, 'stability', step.end)
  const stat = w.statChanges.get('add_stability')?.stat ?? {
    key: 'add_stability',
    label: 'Stability',
    kind: 'percent' as const,
    goodWhen: 'positive' as const,
  }
  addTo(w.statChanges, 'add_stability', stat, Number(e.value) - current)
  return true
}

/** `set_country_flag = X` and `clr_country_flag = X`, which conditions about the flag read. */
const countryFlags: Handler = (c, e) => {
  if ((e.key !== 'set_country_flag' && e.key !== 'clr_country_flag') || !e.value) return false
  c.w.flags.set(e.value, e.key === 'set_country_flag')
  return true
}

/** `set_enemies = SOV GER` (or `none`): the player's entry of who the country is at war with. */
const setEnemies: Handler = (c, e) => {
  if (e.key !== 'set_enemies' || e.value === undefined) return false
  c.w.enemies = e.value === 'none' ? [] : e.value.split(/\s+/).filter(Boolean)
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

/**
 * The country's balance of power (`set_power_balance`, `add_power_balance_value`): the value moves
 * here, and `syncBalanceOfPower` makes the range it is in a national spirit after the reward.
 */
const powerBalance: Handler = (c, e, i) => {
  const bop = c.options.balanceOfPower
  if (!bop) return false
  if (e.key === 'set_power_balance' && e.value === undefined) {
    const fields = childrenAt(c.effects, i)
    if (fields.find((f) => f.key === 'id')?.value !== bop.id) return false
    const value = fields.find((f) => f.key === 'set_value')?.value
    if (isNumeric(value)) c.w.balance = clampBalance(Number(value))
    else if (fields.some((f) => f.key === 'set_default' && f.value === 'yes')) {
      c.w.balance = bop.initial
    } else return false
    return true
  }
  if (e.key === 'add_power_balance_value' && e.subject === bop.id && isNumeric(e.value)) {
    c.w.balance = clampBalance((c.w.balance ?? bop.initial) + Number(e.value))
    return true
  }
  return false
}

const HANDLERS: Handler[] = [
  powerBalance,
  research,
  ideas,
  recruit,
  construction,
  popularity,
  leaders,
  politics,
  setActualStability,
  setEnemies,
  countryFlags,
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
    traits: next.traits ?? [],
    character: next.line.value,
  }
  w.identity = { character: next.line.value }
  w.leaderGroup = government
}

/** The indexes of the lines under every line that is an idea or a leader. */
const ownedLines = (effects: EffectLine[], owners: number[]): Set<number> => {
  const owned = new Set<number>()
  for (const index of owners) {
    for (let j = index + 1; j < blockEnd(effects, index); j++) owned.add(j)
  }
  return owned
}

export const applyReward = (
  w: Working,
  step: Step,
  options: CountryStateOptions,
  /** Whether this is a planned focus, whose reward is kept with its branches marked. */
  annotate = false,
) => {
  const { focus } = step
  // Conditions about what the country has by now (ideas, focuses, government, popularity) are
  // settled, so the branch that applies counts like any other lines.
  const ctx = countryConditions(factsOfWorking(w, options, step.end), options)
  // A focus whose `bypass` holds as it starts is skipped: it gives no reward (assumed to still
  // count as done for what needs it; its duration is not changed).
  if (focus.bypass && annotate && evaluateCheck(focus.bypass, ctx) === true) {
    w.bypassed.add(focus.id)
    w.doneFocuses.add(focus.id)
    return
  }
  const effects = resolveConditions(focus.effects, ctx)
  if (annotate) w.focusEffects[focus.id] = annotateConditions(focus.effects, ctx)

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
  syncBalanceOfPower(w, options, {
    focusId: step.focus.id,
    focusName: step.focus.name,
    end: step.end,
  })
  w.doneFocuses.add(focus.id)
  totalConstruction(w, built)
  recordBatches(w, step, built)
  snapshotResearch(w, options, step.end)
}
