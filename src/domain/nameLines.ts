/**
 * The last phase of the import: putting localised names and stat definitions onto effect lines.
 *
 * `nameKeysOf` says which localisation keys a line might need a name for (so they can all be
 * loaded at once), and `nameLines` then fills the names in once they are loaded. `foldConditions`
 * runs last because it writes conditions out in English, which needs the names.
 */
import type { EffectLine, OpinionModifier } from './focus'
import {
  defaultGoodWhen,
  foldConditions,
  humanize,
  isBuildingSpeedModifier,
  isCountryTag,
  isOwnScope,
  modifierNameKeys,
} from './focusEffects'
import { resolveEventText } from './parsers/localisation'
import { resolveStat } from './stats'
import type { StatDefinition, StatDocs, StatOverrides } from './stats'

/** The two ideologies of `communism > party_popularity@fascism`, for looking up their names. */
const popularityComparison = (e: EffectLine): [string, string] | undefined => {
  const other = e.operator && e.value ? /^party_popularity@(.+)$/.exec(e.value) : null
  return other && e.key ? [e.key, other[1]] : undefined
}

/** A `ROM_ion_antonescu = { ... }` block: effects applied to that character. */
const isCharacterScope = (e: EffectLine): boolean =>
  e.value === undefined && e.key !== null && /^[A-Z]{3}_\w+$/.test(e.key)

/** A `46 = { ... }` block: effects applied to the state with that id. */
const isStateScope = (e: EffectLine): boolean =>
  e.value === undefined && e.key !== null && /^\d+$/.test(e.key)

const isEventLine = (e: EffectLine): boolean => e.key === 'country_event' || e.key === 'news_event'

/** The country an effect line names, as its subject or as a `SOV = { ... }` scope header. */
export const tagOf = (e: EffectLine): string | undefined => {
  if (e.subject && isCountryTag(e.subject)) return e.subject
  return e.value === undefined && isCountryTag(e.key) ? e.key : undefined
}

/** `Nuclear Reactor construction speed` as `Nuclear Reactor Construction Speed`. */
const titleCaseIf = (apply: boolean, text: string | undefined) =>
  apply && text ? text.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : text

/** Every localisation key a line might need a name from. */
export const nameKeysOf = (e: EffectLine, ideaAliases: Record<string, string>): string[] => [
  ...(e.value ? [e.value] : []),
  ...(e.subject ? [e.subject] : []),
  ...(tagOf(e) ? [tagOf(e)!] : []),
  ...(e.key === 'add_resource' && e.subject ? [`state_resource_${e.subject}`] : []),
  ...(e.research?.targets ?? []),
  ...(e.preferStates ?? []).map((id) => `STATE_${id}`),
  ...(isStateScope(e) ? [`STATE_${e.key}`] : []),
  ...(popularityComparison(e) ?? []),
  ...(isCharacterScope(e) ? [e.key!] : []),
  ...(e.value && ideaAliases[e.value] ? [ideaAliases[e.value]] : []),
  ...(e.isModifier && e.key ? modifierNameKeys(e.key) : []),
]

/** What the naming needs to have been read from the game. */
export interface NameContext {
  /** The country being imported, for lines that refer to it (`ROOT`, `FROM`). */
  country: { name: string }
  /** Display text by localisation key, and the original text of the entries with dynamic parts. */
  names: Record<string, string>
  rawNames: Record<string, string>
  /** Ruling party at game start by country tag, which names the country. */
  rulingParties: Record<string, string>
  /** Faction template each country starts out leading, by tag, and the localisation key of each. */
  factionTemplates: Record<string, string>
  factionNames: Record<string, string>
  /** Localisation key of each event's title, by event id. */
  eventTitles: Record<string, string>
  /** Ideas that share another idea's name (`name = ROM_x`), by idea id. */
  ideaAliases: Record<string, string>
  opinions: Record<string, OpinionModifier>
  statDocs: StatDocs
  statOverrides: StatOverrides
}

/** Fills in the names, stat definitions and conditions of one reward's lines. */
export const nameLines = (effects: EffectLine[], ctx: NameContext): EffectLine[] => {
  const { country, names, rawNames, rulingParties, ideaAliases } = ctx
  const countryName = (tag: string) => names[`${tag}_${rulingParties[tag]}`] ?? names[tag]

  /** The country whose scope a line sits in (`GER = { ... }`); undefined for our own. */
  const scopeTagAt = (index: number): string | undefined => {
    let depth = effects[index].depth
    for (let j = index - 1; j >= 0 && depth > 0; j--) {
      if (effects[j].depth >= depth) continue
      depth = effects[j].depth
      if (effects[j].value === undefined && isCountryTag(effects[j].key)) return effects[j].key!
    }
    return undefined
  }

  /**
   * An event's title, with `From` and `Root` filled in. Events are written from the receiving
   * country's view, so inside a `GER = { ... }` scope `Root` is Germany and `From` is us.
   */
  const eventTitleFor = (index: number): string | undefined => {
    const titleKey = ctx.eventTitles[effects[index].value ?? '']
    if (!titleKey) return undefined
    const recipient = scopeTagAt(index)
    const template = recipient ? ctx.factionTemplates[recipient] : undefined
    const faction = template ? ctx.factionNames[template] : undefined
    return resolveEventText(rawNames[titleKey] ?? names[titleKey] ?? titleKey, {
      from: recipient ? country.name : undefined,
      root: recipient ? countryName(recipient) : country.name,
      rootFaction: faction ? (names[faction] ?? faction) : undefined,
    })
  }

  /** The localised name for what an effect's `value` refers to, when it refers to anything. */
  const valueNameOf = (e: EffectLine): string | undefined => {
    if (e.key === 'add_claim_by' && e.value && isOwnScope(e.value)) return country.name
    if (e.key === 'set_cosmetic_tag' && e.value && !names[e.value]) {
      // No localisation for it: drop the country tag from `ROM_polish_loyalists`.
      return humanize(e.value.replace(/^[A-Z]{3}_/, ''))
    }
    const comparison = popularityComparison(e)
    if (comparison) return names[comparison[1]]
    if (e.value && !e.isModifier) return names[e.value] ?? names[ideaAliases[e.value]]
    return undefined
  }

  /** The localised name of what an effect applies to: a state, a character, a country, ... */
  const subjectNameOf = (e: EffectLine): string | undefined => {
    if (e.key === 'add_resource' && e.subject) return names[`state_resource_${e.subject}`]
    if (isStateScope(e)) return names[`STATE_${e.key}`] ?? `State ${e.key}`
    if (isCharacterScope(e)) return names[e.key!]
    const comparison = popularityComparison(e)
    if (comparison) return names[comparison[0]]
    const tag = tagOf(e)
    if (tag) return countryName(tag)
    if (e.subject && isOwnScope(e.subject)) return country.name
    return e.subject ? names[e.subject] : undefined
  }

  /** Research targets' names; some localisation is only a `$key$` reference to another entry. */
  const researchNamesOf = (e: EffectLine) =>
    e.research && {
      ...e.research,
      targetNames: e.research.targets.map((target) => {
        const name = (names[target] ?? humanize(target)).trim()
        const ref = /^\$(.+)\$$/.exec(name)
        return ref ? (names[ref[1]]?.trim() ?? humanize(ref[1])) : name
      }),
    }

  /** How a modifier line is displayed: label, percent or number, and which way is good. */
  const statOf = (e: EffectLine): StatDefinition | undefined => {
    if (!e.isModifier || !e.key) return undefined
    // An `add_popularity` line is about an ideology, which names the stat ("Communist popularity").
    const label = e.subject
      ? `${names[e.subject] ?? humanize(e.subject)} popularity`
      : titleCaseIf(
          isBuildingSpeedModifier(e.key),
          modifierNameKeys(e.key)
            .map((key) => names[key])
            .find(Boolean),
        )
    const fallbacks = e.isRule ? { kind: 'flag' as const } : { goodWhen: defaultGoodWhen(e.key) }
    return resolveStat(e.key, label, ctx.statDocs, ctx.statOverrides, fallbacks)
  }

  return foldConditions(
    effects.map((e, i) => ({
      ...e,
      eventTitle: isEventLine(e) ? eventTitleFor(i) : undefined,
      research: researchNamesOf(e),
      valueName: valueNameOf(e),
      subject: e.subject ?? tagOf(e),
      subjectName: subjectNameOf(e),
      preferNames: e.preferStates?.map((id) => names[`STATE_${id}`] ?? `state ${id}`),
      opinion: e.key === 'add_opinion_modifier' && e.value ? ctx.opinions[e.value] : undefined,
      stat: statOf(e),
    })),
  )
}
