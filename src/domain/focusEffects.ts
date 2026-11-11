import type { EffectLine } from './focus'
import { formatStatValue, statLabel, statTone, type StatTone } from './stats'
import type { ScriptBlock } from './paradoxScript'

/** Flattens a script block into depth-annotated lines. */
export const flattenEffects = (block: ScriptBlock, depth = 0): EffectLine[] =>
  block.flatMap((entry): EffectLine[] => {
    if (typeof entry.value === 'string') {
      return [{ depth, key: entry.key, value: entry.value }]
    }
    return [{ depth, key: entry.key }, ...flattenEffects(entry.value, depth + 1)]
  })

/**
 * Compound effects (`key = { field = x field = y }`) that read better as one line. Each
 * collapser gets the header line and its fields, and returns the replacement line, or null to
 * leave the effect as it was (e.g. when it has fields we do not know about).
 */
const COLLAPSERS: Record<
  string,
  (line: EffectLine, field: (key: string) => string | undefined, count: number) => EffectLine | null
> = {
  // `Communist popularity: +10%`, formatted like any other stat change.
  add_popularity: (line, field, count) => {
    const ideology = field('ideology')
    const popularity = field('popularity')
    return count === 2 && ideology && popularity
      ? { depth: line.depth, key: line.key, value: popularity, subject: ideology, isModifier: true }
      : null
  },
  add_opinion_modifier: (line, field, count) => {
    const target = field('target')
    const modifier = field('modifier')
    return count === 2 && target && modifier
      ? { depth: line.depth, key: line.key, value: modifier, subject: target }
      : null
  },
  // `Gain Conquer (Focus) wargoal on Soviet Union`. `value` is the wargoal type, `subject` its
  // target. The `generator` states are not shown.
  create_wargoal: (line, field, count) => {
    const type = field('type')
    const target = field('target') ?? field('target_country')
    return type && target && count <= 6
      ? { depth: line.depth, key: line.key, value: type, subject: target }
      : null
  },
  // `Event: <title>`. The block form (`country_event = { id = X hours = 12 }`) carries a delay,
  // which is not shown, so any other field is ignored.
  country_event: (line, field, count) => {
    const id = field('id')
    return id && count <= 4 ? { depth: line.depth, key: line.key, value: id } : null
  },
  // `Gains License German Equipment when dealing with German Reich`.
  add_relation_modifier: (line, field, count) => {
    const target = field('target')
    const modifier = field('modifier')
    return count === 2 && target && modifier
      ? { depth: line.depth, key: line.key, value: modifier, subject: target }
      : null
  },
  // `2x 35% cost reduction for: Land Doctrine`.
  add_doctrine_cost_reduction: (line, field, count) => {
    const reduction = Number(field('cost_reduction'))
    const category = field('category')
    const uses = field('uses') === undefined ? 1 : Number(field('uses'))
    return count >= 3 && count <= 4 && category && Number.isFinite(reduction) && uses > 0
      ? {
          depth: line.depth,
          key: line.key,
          value: category,
          doctrine: { reduction, uses, name: field('name') },
        }
      : null
  },
  // `Add production of 8 Oil`; `subject` is the resource type.
  add_resource: (line, field, count) => {
    const type = field('type')
    const amount = field('amount')
    return count === 2 && type && Number.isFinite(Number(amount))
      ? { depth: line.depth, key: line.key, value: amount, subject: type }
      : null
  },
  // `Military access with Romania: yes`, under the scope header of the country giving it.
  diplomatic_relation: (line, field, count) => {
    const country = field('country')
    const relation = field('relation')
    const active = field('active')
    return count === 3 && country && relation && active
      ? {
          depth: line.depth,
          key: line.key,
          value: relation,
          subject: country,
          active: active !== 'no',
        }
      : null
  },
}

export const collapseEffects = (effects: EffectLine[]): EffectLine[] => {
  const result: EffectLine[] = []
  for (let i = 0; i < effects.length; i++) {
    const line = effects[i]
    const collapse =
      line.key !== null && line.value === undefined ? COLLAPSERS[line.key] : undefined
    if (collapse) {
      const fields: EffectLine[] = []
      for (let j = i + 1; j < effects.length && effects[j].depth > line.depth; j++) {
        fields.push(effects[j])
      }
      const collapsed = collapse(
        line,
        (key) => fields.find((f) => f.key === key)?.value,
        fields.length,
      )
      if (collapsed) {
        result.push(collapsed)
        i += fields.length
        continue
      }
    }
    result.push(line)
  }
  return result
}

/**
 * `limit = { X = { has_full_control_of_state = PREV } }` inside `random_owned_controlled_state`
 * says nothing new, since the state is already owned and controlled by that country.
 */
const isImpliedLimit = (body: EffectLine[]): boolean =>
  body.length === 2 &&
  body[0].key !== null &&
  body[0].value === undefined &&
  body[1].key === 'has_full_control_of_state' &&
  body[1].value === 'PREV'

/**
 * Tidies `random_owned_controlled_state = { prioritize = { 46 } limit = { ... } ... }`: the
 * prioritized state ids move onto the header line (`preferStates`), and a `limit` that only
 * restates ownership is dropped. Any other limit is kept, since what it means varies by focus.
 */
export const simplifyRandomStates = (effects: EffectLine[]): EffectLine[] => {
  const result: EffectLine[] = []
  for (let i = 0; i < effects.length; i++) {
    const line = effects[i]
    if (line.key !== 'random_owned_controlled_state' || line.value !== undefined) {
      result.push(line)
      continue
    }
    let end = i + 1
    while (end < effects.length && effects[end].depth > line.depth) end++
    const body = effects.slice(i + 1, end)
    const kept: EffectLine[] = []
    const prefer: string[] = []
    for (let j = 0; j < body.length; j++) {
      const child = body[j]
      if (
        child.depth === line.depth + 1 &&
        child.value === undefined &&
        (child.key === 'prioritize' || child.key === 'limit')
      ) {
        let k = j + 1
        while (k < body.length && body[k].depth > child.depth) k++
        const inner = body.slice(j + 1, k)
        if (child.key === 'prioritize') {
          prefer.push(...inner.flatMap((s) => (s.key === null && s.value ? [s.value] : [])))
          j = k - 1
          continue
        }
        if (isImpliedLimit(inner)) {
          j = k - 1
          continue
        }
      }
      kept.push(child)
    }
    result.push(prefer.length > 0 ? { ...line, preferStates: prefer } : line)
    result.push(...simplifyRandomStates(kept))
    i = end - 1
  }
  return result
}

/** Marks everything inside a `hidden_effect = { ... }` block, which the game does not show. */
export const markHidden = (effects: EffectLine[]): EffectLine[] => {
  let hiddenDepth: number | null = null
  return effects.map((line) => {
    if (hiddenDepth !== null && line.depth <= hiddenDepth) hiddenDepth = null
    if (hiddenDepth === null && line.key === 'hidden_effect' && line.value === undefined) {
      hiddenDepth = line.depth
    }
    return hiddenDepth === null ? line : { ...line, hidden: true }
  })
}

/** Indexes of the lines naming an idea, from `add_ideas = X` or `add_ideas = { X Y }`. */
export const ideaLineIndexes = (effects: EffectLine[]): number[] => {
  const indexes: number[] = []
  let addIdeasDepth: number | null = null
  effects.forEach((e, i) => {
    if (addIdeasDepth !== null && e.depth <= addIdeasDepth) addIdeasDepth = null
    if (e.key === 'add_ideas') {
      if (e.value !== undefined) indexes.push(i)
      else addIdeasDepth = e.depth
    } else if (addIdeasDepth !== null && e.key === null && e.value !== undefined) {
      indexes.push(i)
    }
  })
  return indexes
}

export const ideaIdsOf = (effects: EffectLine[]): string[] =>
  ideaLineIndexes(effects).map((i) => effects[i].value!)

const humanize = (key: string) => key.replace(/_/g, ' ')

/** Words that stand for the country taking the focus when used as an effect target. */
const OWN_SCOPES = new Set(['ROOT', 'THIS', 'PREV', 'FROM'])
export const isOwnScope = (word: string) => OWN_SCOPES.has(word)

/** Country tags such as `SOV`, used as scope blocks (`SOV = { ... }`). */
export const isCountryTag = (key: string | null): key is string =>
  key !== null && /^[A-Z]{3}$/.test(key)

const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`

/** Turns a flattened effect line into display text, e.g. `add ideas: Some Idea`. */
export const formatEffect = (e: EffectLine): string => {
  if (e.key === 'add_opinion_modifier' && e.subject) {
    const who = e.subjectName ?? (OWN_SCOPES.has(e.subject) ? 'us' : e.subject)
    const details = [e.valueName ?? humanize(e.value ?? '')]
    if (e.opinion?.months) details.push(`${e.opinion.months} months`)
    const change = e.opinion ? `${signed(e.opinion.value)} ` : ''
    return `Opinion of ${who}: ${change}(${details.join(', ')})`
  }
  if (e.key === 'random_owned_controlled_state' && e.value === undefined) {
    const prefers = e.preferStates
      ? ` (prioritize ${(e.preferNames ?? e.preferStates.map((id) => `state ${id}`)).join(', ')})`
      : ''
    return `Random owned and controlled state${prefers}:`
  }
  if (e.key === 'add_resource' && e.subject && e.value !== undefined) {
    const name = e.subjectName ?? humanize(e.subject).replace(/^./, (c) => c.toUpperCase())
    const amount = Number(e.value)
    return `${amount < 0 ? 'Remove' : 'Add'} production of ${Math.abs(amount)} ${name}`
  }
  if (e.doctrine && e.value !== undefined) {
    const percent = Number((e.doctrine.reduction * 100).toFixed(1))
    return `${e.doctrine.uses}x ${percent}% cost reduction for: ${e.valueName ?? humanize(e.value)}`
  }
  if (e.key === 'create_wargoal' && e.subject && e.value !== undefined) {
    const who = e.subjectName ?? (OWN_SCOPES.has(e.subject) ? 'us' : e.subject)
    return `Gain ${e.valueName ?? humanize(e.value)} wargoal on ${who}`
  }
  if (e.key === 'country_event' && e.value !== undefined) {
    return `Event: ${e.eventTitle ?? e.value}`
  }
  if (e.key === 'add_relation_modifier' && e.subject && e.value !== undefined) {
    const who = e.subjectName ?? (OWN_SCOPES.has(e.subject) ? 'us' : e.subject)
    return `Gains ${e.valueName ?? humanize(e.value)} when dealing with ${who}`
  }
  if (e.key === 'diplomatic_relation' && e.subject) {
    const who = e.subjectName ?? (OWN_SCOPES.has(e.subject) ? 'us' : e.subject)
    return `${e.valueName ?? humanize(e.value ?? '')} with ${who}: ${e.active === false ? 'no' : 'yes'}`
  }
  // The game shows this text instead of describing the effect itself, so we show it as is.
  if (e.key === 'custom_effect_tooltip' && e.value !== undefined) {
    return (e.valueName ?? e.value).trim()
  }
  if (e.key === 'hidden_effect' && e.value === undefined) return 'Hidden effect:'
  if (e.value === undefined && e.subjectName) return `${e.subjectName}:`
  if (e.isModifier && e.key !== null && e.value !== undefined) {
    const stat = e.stat ?? { key: e.key }
    return `${statLabel(stat)}: ${formatStatValue(stat, e.value)}`
  }
  const label = humanize(e.key ?? '')
  if (e.value === undefined) return `${label}:`
  const value = e.valueName ?? e.value
  return e.key === null ? value : `${label}: ${value}`
}

/** Whether a line is an improvement, a setback, or neither, for colouring. */
export const effectTone = (e: EffectLine): StatTone =>
  e.doctrine
    ? 'good'
    : e.key === 'add_resource' && e.value !== undefined
      ? Number(e.value) > 0
        ? 'good'
        : Number(e.value) < 0
          ? 'bad'
          : 'neutral'
      : e.opinion
        ? e.opinion.value > 0
          ? 'good'
          : e.opinion.value < 0
            ? 'bad'
            : 'neutral'
        : e.isModifier && e.stat && e.value !== undefined
          ? statTone(e.stat, e.value)
          : 'neutral'

/** Localisation keys that may hold the display name of a modifier, most specific first. */
export const modifierNameKeys = (key: string): string[] => [`MODIFIER_${key.toUpperCase()}`, key]
