/**
 * Folding compound effects (`key = { field = x field = y }`) down to one readable line, and
 * dropping the ones a player is never shown.
 *
 * Add a compound effect by adding an entry to `COLLAPSERS`; most of them are the same shape and
 * are built by `aboutSubject` or `namedBy` rather than written out.
 */
import type { EffectLine } from '../focus'
import { blockEnd, childrenOf, opensBlock, unquote } from './lines'

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

/** Looks up a field of the effect being collapsed, e.g. `field('target')`. */
type FieldLookup = (key: string) => string | undefined

/**
 * Builds the one line a compound effect collapses to, from its header line and its fields, or
 * returns null to leave the effect expanded (e.g. when it has fields we do not know about).
 */
type Collapser = (
  line: EffectLine,
  field: FieldLookup,
  count: number,
  fields: EffectLine[],
) => EffectLine | null

/**
 * The most common shape: two fields, one naming what the effect does and one naming who or what
 * it applies to, shown as a single line about that subject (`Communist popularity: +10%`).
 * `numeric` requires the value to be a number rather than merely present, `exact` that the
 * effect has no fields besides these two, and `extra` adds fields such as `isModifier`.
 */
const aboutSubject =
  (
    valueField: string,
    subjectField: string,
    {
      numeric = false,
      exact = true,
      extra,
    }: { numeric?: boolean; exact?: boolean; extra?: Partial<EffectLine> } = {},
  ): Collapser =>
  (line, field, count) => {
    const value = field(valueField)
    const subject = field(subjectField)
    const hasValue = numeric ? Number.isFinite(Number(value)) : Boolean(value)
    return (exact ? count === 2 : true) && hasValue && subject
      ? { depth: line.depth, key: line.key, value, subject, ...extra }
      : null
  }

/** `key = { name = "X" ... }` shown as just that name; the other fields are not shown. */
const namedBy =
  (nameField = 'name'): Collapser =>
  (line, field) => {
    const name = field(nameField)
    return name ? { depth: line.depth, key: line.key, value: unquote(name) } : null
  }

/**
 * `country_event`/`news_event`, plain or in block form. The block form carries a delay, which is
 * not shown, so any field other than the id is ignored — but an effect with many fields is
 * something else, so it is left alone.
 */
const eventFired: Collapser = (line, field, count) => {
  const id = field('id')
  return id && count <= 4 ? { depth: line.depth, key: line.key, value: id } : null
}

/** The ids listed in a `traits = { a b }` block among the fields of an effect. */
const traitsOf = (fields: EffectLine[]): string[] => {
  const at = fields.findIndex((f) => opensBlock(f, 'traits'))
  if (at === -1) return []
  return childrenOf(fields, at).flatMap((f) => (f.key === null && f.value ? [f.value] : []))
}

/** Adds `traits` to a collapsed line, but only when the effect lists any. */
const withTraits = (line: EffectLine, fields: EffectLine[]): EffectLine => {
  const traits = traitsOf(fields)
  return traits.length > 0 ? { ...line, traits } : line
}

const COLLAPSERS: Record<string, Collapser> = {
  // `Communist popularity: +10%`, formatted like any other stat change.
  add_popularity: aboutSubject('popularity', 'ideology', { extra: { isModifier: true } }),
  // `Opinion of Soviet Union: +40 (A Deal with the Devil)`.
  add_opinion_modifier: aboutSubject('modifier', 'target'),
  // `Remove <modifier> opinion modifier with <country>`.
  remove_opinion_modifier: aboutSubject('modifier', 'target'),
  // `Gains License German Equipment when dealing with German Reich`.
  add_relation_modifier: aboutSubject('modifier', 'target'),
  // `Set Non-Aligned popularity: 65%`.
  set_political_party: aboutSubject('popularity', 'ideology', { numeric: true }),
  // `Rename Fascist party: Garda de Fier`; the name is a localisation key.
  set_party_name: aboutSubject('name', 'ideology', { exact: false }),
  // `Add production of 8 Oil`.
  add_resource: aboutSubject('amount', 'type', { numeric: true }),
  // `Autonomy of Romania: Personal Union`.
  set_autonomy: aboutSubject('autonomy_state', 'target'),
  // `Nuclear Research breakthrough progress: +75%`.
  add_breakthrough_progress: aboutSubject('value', 'specialization', { numeric: true }),
  // `Create corps commander: Barbu Paraianu`; the skills and traits are not shown.
  create_corps_commander: namedBy(),
  // `Create design: IAR 80`; the modules are not shown.
  create_equipment_variant: namedBy(),
  // `Create faction: Cordon Sanitaire`; the template's goals and rules are not shown.
  create_faction_from_template: namedBy(),
  country_event: eventFired,
  news_event: eventFired,

  // `Gain Conquer (Focus) wargoal on Soviet Union`. `value` is the wargoal type, `subject` its
  // target. The `generator` states are not shown.
  create_wargoal: (line, field, count) => {
    const type = field('type')
    const target = field('target') ?? field('target_country')
    return type && target && count <= 6
      ? { depth: line.depth, key: line.key, value: type, subject: target }
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
  // `2x 100% research bonus for: Industry`; `research.targets` are the categories or
  // technologies, and the bonus' own `name` is not shown.
  add_tech_bonus: (line, field, _count, fields) => {
    const bonus = Number(field('bonus'))
    const own = fields.filter((f) => f.depth === line.depth + 1)
    const targets = own.filter((f) => f.key === 'category' || f.key === 'technology')
    if (!Number.isFinite(bonus) || targets.length === 0) return null
    const optional = (key: string) => (field(key) === undefined ? undefined : Number(field(key)))
    return {
      depth: line.depth,
      key: line.key,
      research: {
        kind: 'tech_bonus',
        bonus,
        uses: optional('uses'),
        ahead: optional('ahead_reduction'),
        targets: targets.map((f) => f.value!),
        targetKinds: targets.map((f) => (f.key === 'category' ? 'category' : 'technology')),
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
  // `Promote Michael I to country leader (Liberalism)`; both fields are optional.
  promote_character: (line, field) => {
    const character = field('character')
    const ideology = field('ideology')
    return character || ideology
      ? { depth: line.depth, key: line.key, value: character, subject: ideology }
      : null
  },
  // `Carol II Becomes Leader`; the leader's ideology is kept on `subject` but not shown, and
  // their traits are listed beneath.
  create_country_leader: (line, field, _count, fields) => {
    const name = field('name')
    return name
      ? withTraits(
          {
            depth: line.depth,
            key: line.key,
            value: unquote(name),
            subject: field('ideology'),
            leaderId: field('id'),
          },
          fields,
        )
      : null
  },
  // `Becomes country leader`, with the leader's traits listed beneath; `value` is `promote` when
  // the effect also makes them the leader. The expiry date and ideology are not shown.
  add_country_leader_role: (line, field, _count, fields) =>
    withTraits(
      {
        depth: line.depth,
        key: line.key,
        value: field('promote_leader') === 'yes' ? 'promote' : 'role',
      },
      fields,
    ),
  // `Remove advisor role: Chief of Army`.
  remove_advisor_role: (line, field, count) => {
    const slot = field('slot')
    return count === 1 && slot ? { depth: line.depth, key: line.key, value: slot } : null
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

/** Whether a line is a bookkeeping effect the game shows nothing for. */
const isBookkeeping = (line: EffectLine): boolean =>
  line.key !== null && line.value !== undefined && BOOKKEEPING_KEYS.has(line.key)

/**
 * Replaces compound effects with the single line they read as, drops the ones a player never
 * sees, and marks plain `key = number` stat effects so they go through the stat pipeline.
 */
export const collapseEffects = (effects: EffectLine[]): EffectLine[] => {
  const result: EffectLine[] = []
  for (let i = 0; i < effects.length; i++) {
    const line = effects[i]
    if (isBookkeeping(line)) continue
    if (opensBlock(line) && DROPPED_BLOCKS.has(line.key)) {
      i = blockEnd(effects, i) - 1
      continue
    }
    const collapse = opensBlock(line) ? COLLAPSERS[line.key] : undefined
    if (collapse) {
      const fields = childrenOf(effects, i)
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
    const isStatEffect =
      line.key !== null && line.value !== undefined && STAT_EFFECT_KEYS.has(line.key)
    result.push(isStatEffect ? { ...line, isModifier: true } : line)
  }
  // Dropping bookkeeping can leave a `hidden_effect` with nothing in it.
  return result.filter(
    (line, i) => !opensBlock(line, 'hidden_effect') || result[i + 1]?.depth > line.depth,
  )
}
