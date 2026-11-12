import type { EffectLine } from './focus'
import { formatStatValue, statLabel, statTone, type StatTone } from './stats'
import type { ScriptBlock } from './paradoxScript'

/** Flattens a script block into depth-annotated lines. */
export const flattenEffects = (block: ScriptBlock, depth = 0): EffectLine[] =>
  block.flatMap((entry): EffectLine[] => {
    if (typeof entry.value === 'string') {
      return [
        entry.operator && entry.operator !== '='
          ? { depth, key: entry.key, value: entry.value, operator: entry.operator }
          : { depth, key: entry.key, value: entry.value },
      ]
    }
    // Script keywords are case-insensitive, and the game files write `IF` as well as `if`.
    const key = entry.key === 'IF' ? 'if' : entry.key
    return [{ depth, key }, ...flattenEffects(entry.value, depth + 1)]
  })

const collapseEvent = (
  line: EffectLine,
  field: (key: string) => string | undefined,
  count: number,
): EffectLine | null => {
  const id = field('id')
  return id && count <= 4 ? { depth: line.depth, key: line.key, value: id } : null
}

/**
 * `key = number` effects that are stat changes (`add_stability = -0.05`). They are shown through
 * the stat pipeline, so how each looks (label, percent or number) lives in `statOverrides.ts`.
 */
const STAT_EFFECT_KEYS = new Set([
  'add_stability',
  'add_political_power',
  'add_research_slot',
  'army_experience',
  'air_experience',
  'navy_experience',
  'add_extra_state_shared_building_slots',
])

/** Effects with nothing for a player to see; the game only uses them for its own bookkeeping. */
const BOOKKEEPING_KEYS = new Set([
  'set_country_flag',
  'set_state_flag',
  'clr_country_flag',
  'log', // writes to the game's debug log
])

/**
 * Blocks that only define something for the game's own use. A division template is set up for
 * the `create_unit` that follows it, and the focus's tooltip already describes the unit.
 */
const DROPPED_BLOCKS = new Set([
  'division_template',
  // Script arrays are the game's own bookkeeping (e.g. which countries a faction targets).
  'remove_from_array',
  'add_to_array',
])

/**
 * Compound effects (`key = { field = x field = y }`) that read better as one line. Each
 * collapser gets the header line and its fields, and returns the replacement line, or null to
 * leave the effect as it was (e.g. when it has fields we do not know about).
 */
const COLLAPSERS: Record<
  string,
  (
    line: EffectLine,
    field: (key: string) => string | undefined,
    count: number,
    fields: EffectLine[],
  ) => EffectLine | null
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
  // `Event: <title>` and `News: <title>`. The block form (`country_event = { id = X hours = 12 }`)
  // carries a delay, which is not shown, so any other field is ignored.
  country_event: (line, field, count) => collapseEvent(line, field, count),
  news_event: (line, field, count) => collapseEvent(line, field, count),
  // `Remove <modifier> opinion modifier with <country>`.
  remove_opinion_modifier: (line, field, count) => {
    const target = field('target')
    const modifier = field('modifier')
    return count === 2 && target && modifier
      ? { depth: line.depth, key: line.key, value: modifier, subject: target }
      : null
  },
  // `Add timed idea: <name> (360 days)`; the idea's modifiers are listed beneath.
  add_timed_idea: (line, field, count) => {
    const idea = field('idea')
    const days = Number(field('days'))
    return count === 2 && idea && Number.isFinite(days)
      ? { depth: line.depth, key: line.key, value: idea, days }
      : null
  },
  // `set_rule = { can_create_factions = yes }` becomes a yes/no rule line, like an idea's `rule`.
  set_rule: (line, _field, count, fields) =>
    count === 1 && fields[0].key && fields[0].value !== undefined
      ? {
          depth: line.depth,
          key: fields[0].key,
          value: fields[0].value,
          isModifier: true,
          isRule: true,
        }
      : null,
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
  // `2x 100% research bonus for: Industry`; `research.targets` are the categories or
  // technologies, and the bonus' own `name` is not shown.
  add_tech_bonus: (line, field, _count, fields) => {
    const bonus = Number(field('bonus'))
    const own = fields.filter((f) => f.depth === line.depth + 1)
    const targets = own.filter((f) => f.key === 'category' || f.key === 'technology')
    if (!Number.isFinite(bonus) || targets.length === 0) return null
    return {
      depth: line.depth,
      key: line.key,
      research: {
        kind: 'tech_bonus',
        bonus,
        uses: field('uses') === undefined ? undefined : Number(field('uses')),
        ahead:
          field('ahead_reduction') === undefined ? undefined : Number(field('ahead_reduction')),
        targets: targets.map((f) => f.value!),
      },
    }
  },
  // `Doctrine mastery: +20% for 240 days on <track or doctrine>`.
  add_mastery_bonus: (line, field) => {
    const bonus = Number(field('bonus'))
    const target = field('track') ?? field('grand_doctrine')
    return Number.isFinite(bonus) && target
      ? {
          depth: line.depth,
          key: line.key,
          research: { kind: 'mastery', bonus, days: Number(field('days')), targets: [target] },
        }
      : null
  },
  // `Unlocks technology: Mountain Gun` (`set_technology = { mountain_gun = 1 }`).
  set_technology: (line, _field, _count, fields) => {
    const targets = fields.filter((f) => f.depth === line.depth + 1 && f.value === '1')
    return targets.length > 0 && targets.length === fields.length
      ? {
          depth: line.depth,
          key: line.key,
          research: { kind: 'unlock', targets: targets.map((f) => f.key!) },
        }
      : null
  },
  // `Build 1 Military Factory`; `value` is the level and `subject` the building type.
  add_building_construction: (line, field) => {
    const type = field('type')
    const level = field('level')
    return type && Number.isFinite(Number(level))
      ? {
          depth: line.depth,
          key: line.key,
          value: level,
          subject: type,
          instant: field('instant_build') === 'yes',
        }
      : null
  },
  // `Ruling party: Non-Aligned (no elections)`; `value` is the party, `active` allows elections.
  set_politics: (line, field) => {
    const party = field('ruling_party')
    return party
      ? {
          depth: line.depth,
          key: line.key,
          value: party,
          active: field('elections_allowed') !== 'no',
        }
      : null
  },
  // `Set Non-Aligned popularity: 65%`; `value` is the popularity, `subject` the ideology.
  set_political_party: (line, field, count) => {
    const ideology = field('ideology')
    const popularity = field('popularity')
    return count === 2 && ideology && Number.isFinite(Number(popularity))
      ? { depth: line.depth, key: line.key, value: popularity, subject: ideology }
      : null
  },
  // `Rename Fascist party: Garda de Fier`; `value` is the name key, `subject` the ideology.
  set_party_name: (line, field) => {
    const ideology = field('ideology')
    const name = field('name')
    return ideology && name
      ? { depth: line.depth, key: line.key, value: name, subject: ideology }
      : null
  },
  // `Promote Michael I to country leader (Liberalism)`; both fields are optional.
  promote_character: (line, field) => {
    const character = field('character')
    const ideology = field('ideology')
    return character || ideology
      ? { depth: line.depth, key: line.key, value: character, subject: ideology }
      : null
  },
  // `Carol II Becomes Leader`; the leader's ideology is kept on `subject` but not shown.
  create_country_leader: (line, field) => {
    const name = field('name')
    return name
      ? {
          depth: line.depth,
          key: line.key,
          value: name.replace(/^"|"$/g, ''),
          subject: field('ideology'),
        }
      : null
  },
  // `Create corps commander: Barbu Paraianu`; the skills and traits are not shown.
  create_corps_commander: (line, field) => {
    const name = field('name')
    return name ? { depth: line.depth, key: line.key, value: name.replace(/^"|"$/g, '') } : null
  },
  // `Remove advisor role: Chief of Army`.
  remove_advisor_role: (line, field, count) => {
    const slot = field('slot')
    return count === 1 && slot ? { depth: line.depth, key: line.key, value: slot } : null
  },
  // `Autonomy of Romania: Personal Union`; `value` is the state, `subject` the target.
  set_autonomy: (line, field, count) => {
    const state = field('autonomy_state')
    const target = field('target')
    return count === 2 && state && target
      ? { depth: line.depth, key: line.key, value: state, subject: target }
      : null
  },
  // `Create faction: Cordon Sanitaire`; `value` is the faction name key. The template's goals
  // and rules are not shown.
  create_faction_from_template: (line, field) => {
    const name = field('name')
    return name ? { depth: line.depth, key: line.key, value: name } : null
  },
  // `Create unit: Royal Guards Division`. The `division` field is one string with escaped quotes
  // (`"name = \"X\" division_template = \"X\" ..."`), which the parser splits into pieces, so
  // the name is read back out of the pieces joined together.
  create_unit: (line, _field, _count, fields) => {
    const text = fields.map((f) => f.value ?? f.key ?? '').join(' ')
    const name = /division_template\s*=\s*\\?"?([^"\\]+?)\\?"?\s+(?:start_|\w+\s*=|$)/.exec(
      text,
    )?.[1]
    return name ? { depth: line.depth, key: line.key, value: name.trim() } : null
  },
  // `Create design: IAR 80`; the modules are not shown.
  create_equipment_variant: (line, field) => {
    const name = field('name')
    return name ? { depth: line.depth, key: line.key, value: name.replace(/^"|"$/g, '') } : null
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
    if (line.key !== null && line.value !== undefined && BOOKKEEPING_KEYS.has(line.key)) continue
    if (line.key !== null && line.value === undefined && DROPPED_BLOCKS.has(line.key)) {
      while (i + 1 < effects.length && effects[i + 1].depth > line.depth) i++
      continue
    }
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
        fields,
      )
      if (collapsed) {
        result.push(collapsed)
        i += fields.length
        continue
      }
    }
    result.push(
      line.key !== null && line.value !== undefined && STAT_EFFECT_KEYS.has(line.key)
        ? { ...line, isModifier: true }
        : line,
    )
  }
  // Dropping bookkeeping can leave a `hidden_effect` with nothing in it.
  return result.filter((line, i) => {
    if (line.key !== 'hidden_effect' || line.value !== undefined) return true
    const next = result[i + 1]
    return next !== undefined && next.depth > line.depth
  })
}

/**
 * Tidies `random_owned_controlled_state = { prioritize = { 46 } limit = { ... } ... }`: the
 * prioritized state ids move onto the header line (`preferStates`), and the `limit` is dropped.
 * It only says which states qualify (free building slots, ownership, ...), which is the game's
 * business of picking one, not something the player decides.
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
        j = k - 1
        continue
      }
      kept.push(child)
    }
    result.push(prefer.length > 0 ? { ...line, preferStates: prefer } : line)
    result.push(...simplifyRandomStates(kept))
    i = end - 1
  }
  return result
}

/**
 * `if = { limit = { ... } POL = { country_event = X } }` becomes just the event under `POL:`.
 * Only done when the whole body is events sent to other countries, so the condition (is that
 * country free, in a faction, ...) is not shown for those. Other conditionals are left as is.
 */
export const unwrapEventConditions = (effects: EffectLine[]): EffectLine[] => {
  const result: EffectLine[] = []
  for (let i = 0; i < effects.length; i++) {
    const line = effects[i]
    if (line.key !== 'if' || line.value !== undefined) {
      result.push(line)
      continue
    }
    let end = i + 1
    while (end < effects.length && effects[end].depth > line.depth) end++
    const next = effects[end]
    const inner = effects.slice(i + 1, end)
    const limit = inner[0]
    const limitEnd = inner.findIndex((e, j) => j > 0 && e.depth <= limit?.depth)
    const body = limitEnd === -1 ? [] : inner.slice(limitEnd)
    const onlyEvents =
      limit?.key === 'limit' &&
      limit.value === undefined &&
      body.length > 0 &&
      body.every((e) =>
        e.depth === line.depth + 1
          ? isCountryTag(e.key) && e.value === undefined
          : e.key === 'country_event' && e.value !== undefined,
      )
    const hasElse = next?.depth === line.depth && (next.key === 'else' || next.key === 'else_if')
    if (!onlyEvents || hasElse) {
      result.push(line)
      continue
    }
    result.push(...body.map((e) => ({ ...e, depth: e.depth - 1 })))
    i = end - 1
  }
  return result
}

/** Headers that only group other effects, so they mean nothing once those are gone. */
const GROUPING_KEYS = new Set([
  'if',
  'else',
  'else_if',
  'hidden_effect',
  'random_owned_controlled_state',
  'every_other_country',
  'capital_scope',
])

/**
 * Removes grouping blocks (`if`, `else`, `hidden_effect`, ...) with no effect left in them. A
 * `limit` does not count as an effect, so an `if` holding only a condition goes too. This
 * cleans up after dropped effects such as division templates.
 */
export const pruneEmptyBlocks = (effects: EffectLine[]): EffectLine[] => {
  const result: EffectLine[] = []
  for (let i = 0; i < effects.length; i++) {
    const line = effects[i]
    const groups =
      line.key !== null &&
      (GROUPING_KEYS.has(line.key) || isCountryTag(line.key) || isOwnScope(line.key))
    if (line.key === null || line.value !== undefined || !groups) {
      result.push(line)
      continue
    }
    let end = i + 1
    while (end < effects.length && effects[end].depth > line.depth) end++
    let limitDepth: number | null = null
    let hasEffect = false
    for (let j = i + 1; j < end && !hasEffect; j++) {
      const e = effects[j]
      if (limitDepth !== null && e.depth <= limitDepth) limitDepth = null
      if (limitDepth !== null) continue
      if (e.key === 'limit' && e.value === undefined) limitDepth = e.depth
      else if (e.value !== undefined || e.research !== undefined) hasEffect = true
    }
    if (hasEffect) result.push(line)
    else i = end - 1
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

/** Other single-idea effects whose idea's modifiers are worth listing beneath them. */
const OTHER_IDEA_KEYS = new Set(['add_idea', 'add_timed_idea', 'show_ideas_tooltip'])

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
    } else if (e.key !== null && e.value !== undefined && OTHER_IDEA_KEYS.has(e.key)) {
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
  if (e.operator && e.key !== null && e.value !== undefined) {
    // `communism > party_popularity@fascism`: one ideology's popularity against another's.
    const other = /^party_popularity@(.+)$/.exec(e.value)
    if (other) {
      const name = (n: string | undefined, key: string) => n ?? humanize(key)
      return `${name(e.subjectName, e.key)} popularity ${e.operator} ${name(e.valueName, other[1])} popularity`
    }
    return `${humanize(e.key)} ${e.operator} ${e.valueName ?? e.value}`
  }
  if (e.value === undefined) {
    const when = e.condition
    if (e.key === 'if') return when ? `If ${when}:` : 'If:'
    if (e.key === 'else_if') return when ? `Otherwise, if ${when}:` : 'Otherwise, if:'
    if (e.key === 'else') return 'Otherwise:'
    if (e.key === 'every_other_country') {
      return when ? `Every other country where ${when}:` : 'Every other country:'
    }
  }
  const valueText = e.value === undefined ? '' : (e.valueName ?? humanize(e.value))
  const subjectText = e.subject ? (e.subjectName ?? humanize(e.subject)) : ''
  if (e.key === 'set_politics' && e.value !== undefined) {
    return `Ruling party: ${valueText}${e.active === false ? ' (no elections)' : ''}`
  }
  if (e.key === 'set_political_party' && e.value !== undefined && e.subject) {
    return `Set ${subjectText} popularity: ${Number(e.value)}%`
  }
  if (e.key === 'set_party_name' && e.value !== undefined && e.subject) {
    return `Rename ${subjectText} party: ${valueText}`
  }
  if (e.key === 'promote_character') {
    const ideology = e.subject ? ` (${subjectText})` : ''
    return `Promote ${e.value === undefined ? 'a new leader' : valueText} to country leader${ideology}`
  }
  if (e.key === 'create_country_leader' && e.value !== undefined) {
    // The leader's sub-ideology (`despotism`) is only a label with no effect of its own.
    return `${e.value} Becomes Leader`
  }
  if (e.key === 'create_corps_commander' && e.value !== undefined) {
    return `Create corps commander: ${e.value}`
  }
  if (e.key === 'set_autonomy' && e.subject && e.value !== undefined) {
    return `Autonomy of ${subjectText}: ${valueText}`
  }
  if (e.key === 'create_faction_from_template' && e.value !== undefined) {
    return `Create faction: ${valueText}`
  }
  if (e.key === 'retire_country_leader' && e.value === 'yes') return 'Retire country leader'
  if (e.key === 'remove_unit_leader_role' && e.value === 'yes') return 'Remove unit leader role'
  if (e.key === 'promote_leader' && e.value === 'yes') return 'Promote to country leader'
  if (e.research) {
    const r = e.research
    const targets = (r.targetNames ?? r.targets.map((t) => humanize(t))).join(', ')
    if (r.kind === 'unlock') return `Unlocks technology: ${targets}`
    const percent = `+${Number(((r.bonus ?? 0) * 100).toFixed(1))}%`
    if (r.kind === 'mastery') return `Doctrine mastery: ${percent} for ${r.days} days on ${targets}`
    // Same shape as the doctrine cost reduction: `2x 100% research bonus for: Industry`.
    const ahead = r.ahead ? `, ignores ${r.ahead} years of ahead-of-time penalty` : ''
    return `${r.uses ?? 1}x ${percent.slice(1)} research bonus for: ${targets}${ahead}`
  }
  if (e.key === 'add_building_construction' && e.subject && e.value !== undefined) {
    const name = e.subjectName ?? humanize(e.subject)
    return `Build ${e.value} ${name}${e.instant ? ' (instantly)' : ''}`
  }
  if (e.key === 'create_equipment_variant' && e.value !== undefined) {
    return `Create design: ${e.value}`
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
  if (e.key === 'news_event' && e.value !== undefined) {
    return `News: ${e.eventTitle ?? e.value}`
  }
  if (e.key === 'remove_opinion_modifier' && e.subject && e.value !== undefined) {
    const who = e.subjectName ?? (OWN_SCOPES.has(e.subject) ? 'us' : e.subject)
    return `Remove ${e.valueName ?? humanize(e.value)} opinion modifier with ${who}`
  }
  if (e.key === 'add_timed_idea' && e.value !== undefined) {
    return `Add timed idea: ${e.valueName ?? e.value} (${e.days} days)`
  }
  // Effects that only show something in the game's tooltip.
  const TOOLTIP_LABELS: Record<string, string> = {
    unlock_decision_tooltip: 'Unlocks decision',
    unlock_decision_category_tooltip: 'Unlocks decision category',
    show_ideas_tooltip: 'Idea',
    create_unit: 'Create unit',
    add_country_leader_trait: 'Add leader trait',
    remove_country_leader_trait: 'Remove leader trait',
    remove_advisor_role: 'Remove advisor role',
    retire_character: 'Retire',
    set_cosmetic_tag: 'Country name becomes',
    add_claim_by: 'Claim added for',
  }
  if (e.key !== null && e.value !== undefined && e.key in TOOLTIP_LABELS) {
    return `${TOOLTIP_LABELS[e.key]}: ${e.valueName ?? humanize(e.value)}`
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

/**
 * `if = { limit = { has_dlc = "X" } ... } else = { ... }` for a DLC whose ownership is known
 * (`ownedDlc`, from `src/data/dlc.ts`): keeps the branch that applies and drops the condition,
 * so a player without the DLC sees what they would get. DLCs not listed, and a `has_dlc` `if`
 * without an `else`, are left as they were.
 */
export const resolveDlcConditions = (
  effects: EffectLine[],
  ownedDlc: Record<string, boolean>,
): EffectLine[] => {
  const result: EffectLine[] = []
  for (let i = 0; i < effects.length; i++) {
    const line = effects[i]
    const limit = effects[i + 1]
    const dlc = effects[i + 2]
    let end = i + 1
    while (end < effects.length && effects[end].depth > line.depth) end++
    const els = effects[end]
    const limitEnd = i + 2 + 1
    const matches =
      line.key === 'if' &&
      line.value === undefined &&
      limit?.key === 'limit' &&
      limit.value === undefined &&
      limit.depth === line.depth + 1 &&
      dlc?.key === 'has_dlc' &&
      dlc.value !== undefined &&
      dlc.value in ownedDlc &&
      (effects[limitEnd]?.depth ?? 0) <= limit.depth &&
      els?.key === 'else' &&
      els.value === undefined &&
      els.depth === line.depth
    if (!matches) {
      result.push(line)
      continue
    }
    let elseEnd = end + 1
    while (elseEnd < effects.length && effects[elseEnd].depth > line.depth) elseEnd++
    const chosen = ownedDlc[dlc.value!]
      ? effects.slice(limitEnd, end)
      : effects.slice(end + 1, elseEnd)
    // Handle the chosen body too, in case it holds another such condition.
    result.push(
      ...resolveDlcConditions(
        chosen.map((e) => ({ ...e, depth: e.depth - 1 })),
        ownedDlc,
      ),
    )
    i = elseEnd - 1
  }
  return result
}

/** A line with the lines nested under it, to read a `limit` as the condition it describes. */
interface ConditionNode {
  line: EffectLine
  kids: ConditionNode[]
}

const toTree = (lines: EffectLine[]): ConditionNode[] => {
  const roots: ConditionNode[] = []
  const stack: ConditionNode[] = []
  for (const line of lines) {
    const node: ConditionNode = { line, kids: [] }
    while (stack.length > 0 && stack[stack.length - 1].line.depth >= line.depth) stack.pop()
    ;(stack.length > 0 ? stack[stack.length - 1].kids : roots).push(node)
    stack.push(node)
  }
  return roots
}

const wrap = (terms: string[]) => (terms.length > 1 ? `(${terms.join(' and ')})` : terms[0])

/** The terms of a condition block, or null when it holds something we cannot read. */
const conditionTerms = (nodes: ConditionNode[]): string[] | null => {
  const terms: string[] = []
  for (const { line, kids } of nodes) {
    if (line.key === null) return null
    const key: string = line.key
    if (line.value !== undefined) {
      terms.push(formatEffect(line))
      continue
    }
    const inner = conditionTerms(kids)
    if (inner === null || inner.length === 0) return null
    if (line.key === 'NOT') terms.push(`not ${wrap(inner)}`)
    else if (line.key === 'OR') terms.push(inner.length > 1 ? `(${inner.join(' or ')})` : inner[0])
    else if (line.key === 'AND') terms.push(wrap(inner))
    else if (line.key === 'capital_scope') terms.push(`capital ${wrap(inner)}`)
    else if (isCountryTag(line.key) || isOwnScope(line.key) || /^\d+$/.test(line.key)) {
      terms.push(`${formatEffect(line).replace(/:$/, '')} ${wrap(inner)}`)
    } else if (kids.every((k) => k.line.value !== undefined && k.line.key !== null)) {
      // A condition with fields of its own: `has_country_leader = { id = 550 }`.
      terms.push(`${humanize(key)} (${kids.map((k) => formatEffect(k.line)).join(', ')})`)
    } else return null
  }
  return terms
}

/** Headers that take a `limit`, which is folded into the header as its condition. */
const CONDITIONAL_KEYS = new Set(['if', 'else_if', 'every_other_country'])

/**
 * Folds a `limit` into the header it belongs to: `if` / `limit` / `France:` / `is in faction
 * with: Britain` becomes `If France is in faction with: Britain:`. Run after names are resolved,
 * since the condition is written with them. `NOT`, `OR` and `AND` are written out
 * (`not (...)`, `(a or b)`); a limit holding anything else is left as it was. An `if` with an
 * empty limit always applies, so it is dropped and its body shown (with its `else` branches
 * removed, since they never apply).
 */
export const foldConditions = (effects: EffectLine[]): EffectLine[] => {
  const result: EffectLine[] = []
  for (let i = 0; i < effects.length; i++) {
    const line = effects[i]
    const limit = effects[i + 1]
    if (
      line.key === null ||
      !CONDITIONAL_KEYS.has(line.key) ||
      line.value !== undefined ||
      limit?.key !== 'limit' ||
      limit.value !== undefined ||
      limit.depth !== line.depth + 1
    ) {
      result.push(line)
      continue
    }
    let limitEnd = i + 2
    while (limitEnd < effects.length && effects[limitEnd].depth > limit.depth) limitEnd++
    let blockEnd = limitEnd
    while (blockEnd < effects.length && effects[blockEnd].depth > line.depth) blockEnd++
    if (limitEnd === i + 2 && line.key === 'if') {
      result.push(
        ...foldConditions(
          effects.slice(limitEnd, blockEnd).map((e) => ({ ...e, depth: e.depth - 1 })),
        ),
      )
      // The branches that follow never apply.
      while (
        blockEnd < effects.length &&
        effects[blockEnd].depth === line.depth &&
        (effects[blockEnd].key === 'else' || effects[blockEnd].key === 'else_if')
      ) {
        blockEnd++
        while (blockEnd < effects.length && effects[blockEnd].depth > line.depth) blockEnd++
      }
      i = blockEnd - 1
      continue
    }
    const terms = limitEnd === i + 2 ? null : conditionTerms(toTree(effects.slice(i + 2, limitEnd)))
    if (!terms || terms.length === 0) {
      result.push(line)
      continue
    }
    let condition = terms.join(' and ')
    // A single `or` group needs no brackets of its own.
    if (terms.length === 1 && terms[0].startsWith('(') && !terms[0].includes(' and ')) {
      condition = terms[0].slice(1, -1)
    }
    result.push({ ...line, condition })
    i = limitEnd - 1
  }
  return result
}

/** Whether a line is an improvement, a setback, or neither, for colouring. */
export const effectTone = (e: EffectLine): StatTone =>
  e.doctrine || e.research || e.key === 'add_building_construction'
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
export const modifierNameKeys = (key: string): string[] => [
  `MODIFIER_${key.toUpperCase()}`,
  `modifier_${key}`,
  key,
]

/** Construction speed of one kind of building, e.g. `production_speed_nuclear_reactor_factor`. */
export const isBuildingSpeedModifier = (key: string): boolean =>
  /^production_speed_.+_factor$/.test(key)
