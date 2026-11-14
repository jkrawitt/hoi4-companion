/**
 * Reading what political power buys out of the game's files: laws (`common/ideas/_economic.txt`,
 * `_manpower.txt`), designers and industrial concerns (the country's ideas file and
 * `zzz_generic.txt`), advisors (the `advisor` block of a `common/characters` entry) and the slots
 * (`common/idea_tags`). Each is a `RawOption`: a `PoliticalOption` plus what the importer still has
 * to settle (`allowed`) before it is kept.
 */
import type { Check, EffectLine } from '../focus'
import { checkOfLines } from '../effects/conditions'
import { flattenEffects } from '../effects/lines'
import {
  DEFAULT_POLITICS_DEFINES,
  groupOfSlot,
  type PoliticalOption,
  type PoliticsDefines,
} from '../politics'
import { parseStaticModifiers } from './staticModifiers'
import { isAiModifier } from './statBlocks'
import {
  getAll,
  getBlock,
  getString,
  getStrings,
  parseScript,
  type ScriptBlock,
} from './paradoxScript'

/** What an idea costs when it does not say (the category's `cost` in `idea_tags`). */
export const DEFAULT_COST = 150

export interface RawOption extends PoliticalOption {
  /** The `allowed` block; an option that can never be allowed for the country is dropped. */
  allowed?: Check
  /**
   * `allowed` asks `has_allowed_idea_with_traits = { idea = X }`: a generic option that steps aside
   * when the country has one of its own with trait X. The trait, or '' when the block names none.
   */
  fallback?: string
  /** Designers: the `traits` of the idea, which a generic fallback is matched against. */
  ideaTraits?: string[]
  /** The `available` block as lines, to be written out in English. */
  availableLines?: EffectLine[]
  /** Advisors: the ids of the traits, whose stats the importer reads. */
  traits?: string[]
}

export interface IdeaSlots {
  /** How many ideas each slot holds. */
  slots: Record<string, number>
  lawSlots: string[]
  designerSlots: string[]
}

/** The politics screen's slots, from the `government`, `research_production` and `military_staff` categories. */
export const parseIdeaSlots = (text: string): IdeaSlots => {
  const categories = getBlock(parseScript(text), 'idea_categories') ?? []
  const slots: Record<string, number> = {}
  let lawSlots: string[] = []
  let designerSlots: string[] = []
  for (const category of categories) {
    if (typeof category.value === 'string') continue
    const own = getStrings(category.value, 'slot')
    if (category.key === 'government') lawSlots = own
    else if (category.key === 'research_production') designerSlots = own
    else if (category.key !== 'military_staff') continue
    for (const slot of [...own, ...getStrings(category.value, 'character_slot')]) {
      slots[slot] = (slots[slot] ?? 0) + 1
    }
  }
  return { slots, lawSlots, designerSlots }
}

/** The numeric fields of a block as a record (`research_bonus = { armor = 0.15 }`). */
const numbersOf = (block: ScriptBlock | undefined): Record<string, number> =>
  Object.fromEntries(
    (block ?? []).flatMap((e) =>
      e.key !== null && typeof e.value === 'string' && Number.isFinite(Number(e.value))
        ? [[e.key, Number(e.value)]]
        : [],
    ),
  )

/** The scripted triggers of `common/scripted_triggers`, by name: `PHI_SEA = { original_tag = PHI ... }`. */
export type ScriptedTriggers = Record<string, ScriptBlock>

/** Every top-level block of a `common/scripted_triggers` file. */
export const parseScriptedTriggers = (text: string): ScriptedTriggers =>
  Object.fromEntries(
    parseScript(text).flatMap((e) =>
      e.key !== null && typeof e.value !== 'string' ? [[e.key, e.value]] : [],
    ),
  )

/**
 * `block` with each scripted trigger written out: `PHI_SEA = yes` becomes `AND = { <its body> }`
 * and `= no` becomes `NOT = { ... }`, so the conditions inside can be answered.
 */
const expandTriggers = (block: ScriptBlock, triggers: ScriptedTriggers, depth = 0): ScriptBlock =>
  block.map((e) => {
    if (typeof e.value !== 'string') {
      return { ...e, value: expandTriggers(e.value, triggers, depth) }
    }
    const body = e.key !== null && depth < 5 ? triggers[e.key] : undefined
    if (!body || (e.value !== 'yes' && e.value !== 'no')) return e
    const value = expandTriggers(body, triggers, depth + 1)
    return { key: e.value === 'yes' ? 'AND' : 'NOT', operator: '=', value }
  })

const triggerOf = (
  block: ScriptBlock | undefined,
  triggers: ScriptedTriggers,
): { check?: Check; lines: EffectLine[] } => {
  if (!block || block.length === 0) return { lines: [] }
  const lines = flattenEffects(expandTriggers(block, triggers))
  return { check: checkOfLines(lines), lines }
}

/** The trait `has_allowed_idea_with_traits = { idea = X }` asks about, '' if none named, or undefined. */
const allowedIdeaTrait = (block: ScriptBlock | undefined): string | undefined => {
  for (const e of block ?? []) {
    if (typeof e.value !== 'object') continue
    if (e.key?.toLowerCase() === 'has_allowed_idea_with_traits') return getString(e.value, 'idea') ?? ''
    const inner = allowedIdeaTrait(e.value)
    if (inner !== undefined) return inner
  }
  return undefined
}

/** One idea of a law or designer category as an option (without a name, which the importer adds). */
const ideaOption = (
  id: string,
  block: ScriptBlock,
  slot: string,
  kind: 'law' | 'designer',
  lawSlots: Set<string>,
  triggers: ScriptedTriggers,
): RawOption => {
  const allowed = getBlock(block, 'allowed')
  const available = triggerOf(getBlock(block, 'available'), triggers)
  const researchBonus = numbersOf(getBlock(block, 'research_bonus'))
  const cost = Number(getString(block, 'cost'))
  const level = Number(getString(block, 'level'))
  const fallback = allowedIdeaTrait(allowed)
  const ideaTraits = (getBlock(block, 'traits') ?? []).flatMap((t) =>
    t.key === null && typeof t.value === 'string' ? [t.value] : [],
  )
  return {
    id,
    name: id,
    kind,
    slot,
    group: groupOfSlot(slot, lawSlots),
    cost: Number.isFinite(cost) ? cost : DEFAULT_COST,
    ...(getString(block, 'default') === 'yes' && { default: true }),
    ...(Number.isFinite(level) && { level }),
    modifiers: [
      ...flattenEffects(getBlock(block, 'modifier') ?? [])
        .filter((l) => !isAiModifier(l.key))
        .map((l) => ({ ...l, isModifier: true })),
      ...flattenEffects(getBlock(block, 'rule') ?? []).map((l) => ({
        ...l,
        isModifier: true,
        isRule: true,
      })),
    ],
    ...(Object.keys(researchBonus).length > 0 && { researchBonus }),
    ...(allowed && { allowed: triggerOf(allowed, triggers).check }),
    ...(fallback !== undefined && { fallback }),
    ...(ideaTraits.length > 0 && { ideaTraits }),
    ...(available.check && { available: available.check, availableLines: available.lines }),
  }
}

/** The idea blocks of the category blocks named in `slots`, across every `ideas = { ... }` file. */
const ideasInSlots = (
  text: string,
  slots: Set<string>,
  kind: 'law' | 'designer',
  lawSlots: Set<string>,
  triggers: ScriptedTriggers,
): RawOption[] =>
  (getBlock(parseScript(text), 'ideas') ?? []).flatMap((category) =>
    category.key === null || typeof category.value === 'string' || !slots.has(category.key)
      ? []
      : category.value.flatMap((idea) =>
          idea.key === null || typeof idea.value === 'string'
            ? []
            : [ideaOption(idea.key, idea.value, category.key!, kind, lawSlots, triggers)],
        ),
  )

/** The laws of a `common/ideas` file: ideas of the categories that are law slots. */
export const parseLaws = (
  text: string,
  lawSlots: string[],
  triggers: ScriptedTriggers = {},
): RawOption[] => ideasInSlots(text, new Set(lawSlots), 'law', new Set(lawSlots), triggers)

/** The designers and industrial concerns of a `common/ideas` file. */
export const parseDesigners = (
  text: string,
  designerSlots: string[],
  triggers: ScriptedTriggers = {},
): RawOption[] => ideasInSlots(text, new Set(designerSlots), 'designer', new Set(), triggers)

const LEDGERS = new Set(['army', 'navy', 'air'])

/** The advisors of a `common/characters` file: every character with an `advisor` block. */
export const parseAdvisors = (text: string, triggers: ScriptedTriggers = {}): RawOption[] =>
  (getBlock(parseScript(text), 'characters') ?? []).flatMap((character) => {
    if (character.key === null || typeof character.value === 'string') return []
    return getAll(character.value, 'advisor').flatMap((entry): RawOption[] => {
      if (typeof entry.value === 'string') return []
      const advisor = entry.value
      const slot = getString(advisor, 'slot')
      if (!slot) return []
      const cost = Number(getString(advisor, 'cost'))
      const ledger = getString(advisor, 'ledger') ?? slot.replace(/_chief$/, '')
      const allowed = getBlock(advisor, 'allowed')
      const available = triggerOf(getBlock(advisor, 'available'), triggers)
      const traits = getBlock(advisor, 'traits') ?? []
      return [
        {
          id: getString(advisor, 'idea_token') ?? character.key!,
          name: character.key!,
          kind: 'advisor',
          slot,
          group: groupOfSlot(slot, new Set()),
          cost: Number.isFinite(cost) ? cost : DEFAULT_COST,
          ...(LEDGERS.has(ledger) && { ledger: ledger as 'army' | 'navy' | 'air' }),
          character: character.key!,
          modifiers: [],
          traits: traits.flatMap((t) =>
            t.key === null && typeof t.value === 'string' ? [t.value] : [],
          ),
          ...(allowed && { allowed: triggerOf(allowed, triggers).check }),
          ...(available.check && { available: available.check, availableLines: available.lines }),
        },
      ]
    })
  })

/**
 * The political power numbers: `BASE_POLITICAL_POWER_INCREASE`, `POLITICAL_POWER_UPPER_CAP` and
 * `BASE_STABILITY_PARTY_POPULARITY_FACTOR` from the defines, and from the static modifiers the
 * stability modifiers' and `gain_focus`'s political power. Each falls back to the game's value.
 */
export const parsePoliticsDefines = (text: string, staticModifiersText = ''): PoliticsDefines => {
  const d = DEFAULT_POLITICS_DEFINES
  const read = (name: string, fallback: number) => {
    const found = new RegExp(`\\b${name}\\s*=\\s*(-?[\\d.]+)`).exec(text)
    return found && Number.isFinite(Number(found[1])) ? Number(found[1]) : fallback
  }
  const statics = parseStaticModifiers(
    staticModifiersText,
    new Set(['stability_good_modifier', 'stability_bad_modifier', 'gain_focus']),
  )
  const stat = (modifier: string, key: string, fallback: number) => {
    const line = statics[modifier]?.find((l) => l.key === key)
    return line ? Number(line.value) : fallback
  }
  return {
    baseGain: read('BASE_POLITICAL_POWER_INCREASE', d.baseGain),
    cap: read('POLITICAL_POWER_UPPER_CAP', d.cap),
    partyStability: read('BASE_STABILITY_PARTY_POPULARITY_FACTOR', d.partyStability),
    stabilityGood: stat('stability_good_modifier', 'political_power_factor', d.stabilityGood),
    stabilityBad: stat('stability_bad_modifier', 'political_power_factor', d.stabilityBad),
    focusCost: stat('gain_focus', 'political_power_cost', d.focusCost),
  }
}
