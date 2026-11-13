/**
 * Turning an effect line into the text and colour the UI shows.
 *
 * Most effects have their own wording, keyed by effect name in `FORMATTERS`; add one there. A
 * formatter returns null when the line is not the shape it expects, which falls through to the
 * generic wording at the bottom, so an effect we only partly understand still reads sensibly.
 */
import type { EffectLine } from '../focus'
import { formatStatValue, statLabel, statTone, type StatTone } from '../stats'
import { capitalize, humanize, isOwnScope, percentOf, signed } from './lines'

/** The display text of `value`: its localised name, or the key read as words. */
const valueOf = (e: EffectLine): string =>
  e.valueName ?? (e.value === undefined ? '' : humanize(e.value))

/** The display text of `subject`: its localised name, or the key read as words. */
const subjectOf = (e: EffectLine): string =>
  e.subject ? (e.subjectName ?? humanize(e.subject)) : ''

/** Who an effect is directed at; our own country reads as "us". */
const whoOf = (e: EffectLine): string =>
  e.subjectName ?? (e.subject && isOwnScope(e.subject) ? 'us' : (e.subject ?? ''))

/** Effects the game shows as a plain labelled line, `<label>: <value>`. */
const LABELLED_EFFECTS: Record<string, string> = {
  unlock_decision_tooltip: 'Unlocks decision',
  unlock_decision_category_tooltip: 'Unlocks decision category',
  show_ideas_tooltip: 'Idea',
  create_unit: 'Create unit',
  leader_trait: 'Leader trait',
  add_country_leader_trait: 'Add leader trait',
  remove_country_leader_trait: 'Remove leader trait',
  remove_advisor_role: 'Remove advisor role',
  retire_character: 'Retire',
  set_cosmetic_tag: 'Country name becomes',
  add_claim_by: 'Claim added for',
}

type Formatter = (e: EffectLine) => string | null

const labelled = (labels: Record<string, string>): Record<string, Formatter> =>
  Object.fromEntries(
    Object.entries(labels).map(([key, label]) => [
      key,
      (e: EffectLine) => (e.value === undefined ? null : `${label}: ${valueOf(e)}`),
    ]),
  )

/** A conditional header, whose folded-in `limit` reads as its condition. */
const header =
  (withCondition: (condition: string) => string, bare: string): Formatter =>
  (e) =>
    e.value !== undefined ? null : e.condition ? withCondition(e.condition) : bare

/** An effect whose wording only makes sense with both a value and a subject. */
const aboutSubject =
  (text: (e: EffectLine) => string): Formatter =>
  (e) =>
    e.subject && e.value !== undefined ? text(e) : null

/** An effect that reads as a single yes/no action, written `<effect> = yes`. */
const action =
  (text: string): Formatter =>
  (e) =>
    e.value === 'yes' ? text : null

/** An effect named by its value alone, e.g. `Create design: IAR 80`. */
const named =
  (prefix: string): Formatter =>
  (e) =>
    e.value === undefined ? null : `${prefix}: ${e.value}`

const FORMATTERS: Record<string, Formatter> = {
  ...labelled(LABELLED_EFFECTS),

  add_opinion_modifier: (e) => {
    if (!e.subject) return null
    const details = [valueOf(e)]
    if (e.opinion?.months) details.push(`${e.opinion.months} months`)
    const change = e.opinion ? `${signed(e.opinion.value)} ` : ''
    return `Opinion of ${whoOf(e)}: ${change}(${details.join(', ')})`
  },
  remove_opinion_modifier: aboutSubject(
    (e) => `Remove ${valueOf(e)} opinion modifier with ${whoOf(e)}`,
  ),
  add_relation_modifier: aboutSubject((e) => `Gains ${valueOf(e)} when dealing with ${whoOf(e)}`),
  create_wargoal: aboutSubject((e) => `Gain ${valueOf(e)} wargoal on ${whoOf(e)}`),

  random_owned_controlled_state: (e) => {
    if (e.value !== undefined) return null
    const names = e.preferNames ?? e.preferStates?.map((id) => `state ${id}`)
    return `Random owned and controlled state${names ? ` (prioritize ${names.join(', ')})` : ''}:`
  },
  add_resource: aboutSubject((e) => {
    const name = e.subjectName ?? capitalize(humanize(e.subject!))
    const amount = Number(e.value)
    return `${amount < 0 ? 'Remove' : 'Add'} production of ${Math.abs(amount)} ${name}`
  }),
  add_building_construction: aboutSubject(
    (e) =>
      `Build ${e.value} ${e.subjectName ?? humanize(e.subject!)}${e.instant ? ' (instantly)' : ''}`,
  ),

  if: header((c) => `If ${c}:`, 'If:'),
  else_if: header((c) => `Otherwise, if ${c}:`, 'Otherwise, if:'),
  else: (e) => (e.value === undefined ? 'Otherwise:' : null),
  every_other_country: header((c) => `Every other country where ${c}:`, 'Every other country:'),
  hidden_effect: (e) => (e.value === undefined ? 'Hidden effect:' : null),

  set_politics: (e) =>
    e.value === undefined
      ? null
      : `Ruling party: ${valueOf(e)}${e.active === false ? ' (no elections)' : ''}`,
  set_political_party: aboutSubject((e) => `Set ${subjectOf(e)} popularity: ${Number(e.value)}%`),
  set_party_name: aboutSubject((e) => `Rename ${subjectOf(e)} party: ${valueOf(e)}`),
  set_autonomy: aboutSubject((e) => `Autonomy of ${subjectOf(e)}: ${valueOf(e)}`),
  promote_character: (e) => {
    const ideology = e.subject ? ` (${subjectOf(e)})` : ''
    return `Promote ${e.value === undefined ? 'a new leader' : valueOf(e)} to country leader${ideology}`
  },
  // The leader's sub-ideology (`despotism`) is only a label with no effect of its own.
  create_country_leader: (e) => (e.value === undefined ? null : `${e.value} Becomes Leader`),
  create_corps_commander: named('Create corps commander'),
  create_equipment_variant: named('Create design'),
  create_faction_from_template: (e) =>
    e.value === undefined ? null : `Create faction: ${valueOf(e)}`,
  add_country_leader_role: (e) =>
    e.value === 'promote' ? 'Becomes country leader' : 'Gains a country leader role',
  retire_country_leader: action('Retire country leader'),
  remove_unit_leader_role: action('Remove unit leader role'),
  promote_leader: action('Promote to country leader'),

  add_breakthrough_progress: aboutSubject(
    (e) => `${subjectOf(e)} breakthrough progress: ${signed(percentOf(Number(e.value)))}%`,
  ),
  country_event: (e) => (e.value === undefined ? null : `Event: ${e.eventTitle ?? e.value}`),
  news_event: (e) => (e.value === undefined ? null : `News: ${e.eventTitle ?? e.value}`),
  add_timed_idea: (e) =>
    e.value === undefined ? null : `Add timed idea: ${e.valueName ?? e.value} (${e.days} days)`,
  diplomatic_relation: (e) =>
    e.subject ? `${valueOf(e)} with ${whoOf(e)}: ${e.active === false ? 'no' : 'yes'}` : null,
  // The game shows this text instead of describing the effect itself, so we show it as is.
  custom_effect_tooltip: (e) => (e.value === undefined ? null : (e.valueName ?? e.value).trim()),
}

/**
 * A comparison kept with its operator, from a condition rather than an effect. Handled before
 * the formatters, since the operator changes how any key reads.
 */
const comparisonText = (e: EffectLine): string | null => {
  if (!e.operator || e.key === null || e.value === undefined) return null
  // `communism > party_popularity@fascism`: one ideology's popularity against another's.
  const other = /^party_popularity@(.+)$/.exec(e.value)
  if (!other) return `${humanize(e.key)} ${e.operator} ${e.valueName ?? e.value}`
  const left = e.subjectName ?? humanize(e.key)
  const right = e.valueName ?? humanize(other[1])
  return `${left} popularity ${e.operator} ${right} popularity`
}

/** `Unlocks technology: X`, `2x 100% research bonus for: Y`, `Doctrine mastery: +20% ...`. */
const researchText = (r: NonNullable<EffectLine['research']>): string => {
  const targets = (r.targetNames ?? r.targets.map(humanize)).join(', ')
  if (r.kind === 'unlock') return `Unlocks technology: ${targets}`
  const bonus = percentOf(r.bonus ?? 0)
  if (r.kind === 'mastery') {
    return `Doctrine mastery: +${bonus}% for ${r.days} days on ${targets}`
  }
  const ahead = r.ahead ? `, ignores ${r.ahead} years of ahead-of-time penalty` : ''
  return `${r.uses ?? 1}x ${bonus}% research bonus for: ${targets}${ahead}`
}

/** `2x 35% cost reduction for: Land Doctrine`. */
const doctrineText = (e: EffectLine): string | null =>
  e.doctrine && e.value !== undefined
    ? `${e.doctrine.uses}x ${percentOf(e.doctrine.reduction)}% cost reduction for: ${valueOf(e)}`
    : null

/** How any other line reads: a scope header, a stat change, or plain `<key>: <value>`. */
const genericText = (e: EffectLine): string => {
  if (e.value === undefined && e.subjectName) return `${e.subjectName}:`
  if (e.isModifier && e.key !== null && e.value !== undefined) {
    const stat = e.stat ?? { key: e.key }
    return `${statLabel(stat)}: ${formatStatValue(stat, e.value)}`
  }
  if (e.value === undefined) return `${humanize(e.key ?? '')}:`
  const value = e.valueName ?? e.value
  return e.key === null ? value : `${humanize(e.key)}: ${value}`
}

/** Turns a flattened effect line into display text, e.g. `add ideas: Some Idea`. */
export const formatEffect = (e: EffectLine): string =>
  comparisonText(e) ??
  (e.key === null ? null : (FORMATTERS[e.key]?.(e) ?? null)) ??
  (e.research ? researchText(e.research) : null) ??
  doctrineText(e) ??
  genericText(e)

/** Effects that are always an improvement, whatever their value. */
const ALWAYS_GOOD_KEYS = new Set(['add_building_construction', 'add_breakthrough_progress'])

const signTone = (n: number): StatTone => (n > 0 ? 'good' : n < 0 ? 'bad' : 'neutral')

/** Whether a line is an improvement, a setback, or neither, for colouring. */
export const effectTone = (e: EffectLine): StatTone => {
  if (e.doctrine || e.research || (e.key !== null && ALWAYS_GOOD_KEYS.has(e.key))) return 'good'
  if (e.key === 'add_resource' && e.value !== undefined) return signTone(Number(e.value))
  if (e.opinion) return signTone(e.opinion.value)
  if (e.isModifier && e.stat && e.value !== undefined) return statTone(e.stat, e.value)
  return 'neutral'
}
