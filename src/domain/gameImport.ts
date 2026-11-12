import type { EffectLine, Focus } from './focus'
import { parseFocusTreeFile } from './focusTree'
import {
  foldConditions,
  ideaIdsOf,
  ideaLineIndexes,
  removedIdeaLineIndexes,
  reverseModifier,
  isCountryTag,
  isOwnScope,
  defaultGoodWhen,
  isBuildingSpeedModifier,
  modifierNameKeys,
  resolveDlcConditions,
} from './focusEffects'
import { parseIdeaNames, parseIdeas } from './ideas'
import { parseOpinionModifiers } from './opinionModifiers'
import { parseLeaderTraits } from './leaderTraits'
import { parseStaticModifiers } from './staticModifiers'
import { parseEventTitles } from './events'
import { parseFactionTemplates } from './factions'
import { parseLocalisation, resolveEventText } from './localisation'
import { getBlock, getString, parseScript } from './paradoxScript'
import { parseStatDocs, resolveStat, type StatOverrides } from './stats'

/** Read-only view of a HoI4 installation folder. Paths use `/` and are relative to its root. */
export interface GameFiles {
  /** File contents, or null if the file does not exist. */
  readText(path: string): Promise<string | null>
  /** File names (not paths) directly inside a directory; empty if it does not exist. */
  listFiles(dir: string): Promise<string[]>
}

const LOCALISATION_DIR = 'localisation/english'
const IDEAS_DIR = 'common/ideas'
const OPINION_DIR = 'common/opinion_modifiers'
const STATIC_MODIFIERS_DIR = 'common/modifiers'
const LEADER_TRAITS_DIR = 'common/country_leader'
const HISTORY_DIR = 'history/countries'
const FACTION_TEMPLATES_DIR = 'common/factions/templates'
const EVENTS_DIR = 'events'
export const STAT_DOCS_FILE = 'documentation/modifiers_documentation.md'

export class GameFolderError extends Error {}

/**
 * Reads two things from `history/countries/<TAG> - <name>.txt` for each tag (tags without a file
 * are left out):
 * - the ruling party at the start of the game, which names the country (`SOV_communism` is
 *   "Soviet Union", while plain `SOV` is "Russia"), from `set_politics = { ruling_party = X }`;
 * - the faction template it starts out leading, from a top-level `create_faction_from_template`.
 */
const readCountryHistory = async (files: GameFiles, tags: Set<string>) => {
  const parties: Record<string, string> = {}
  const factionTemplates: Record<string, string> = {}
  if (tags.size === 0) return { parties, factionTemplates }
  const historyFiles = await files.listFiles(HISTORY_DIR)
  for (const tag of tags) {
    const file = historyFiles.find((f) => f.startsWith(`${tag} -`))
    const text = file ? await files.readText(`${HISTORY_DIR}/${file}`) : null
    if (!text) continue
    const script = parseScript(text)
    const party = getString(getBlock(script, 'set_politics') ?? [], 'ruling_party')
    const template = getString(script, 'create_faction_from_template')
    if (party) parties[tag] = party
    if (template) factionTemplates[tag] = template
  }
  return { parties, factionTemplates }
}

/**
 * Finds definitions for the given ids. The preferred file is read first; the other files in the
 * directory are only read (and only parsed if they mention a missing id) for what is left.
 */
const readDefinitions = async <T>(
  files: GameFiles,
  dir: string,
  ids: Set<string>,
  preferredFile: string | undefined,
  parse: (text: string, wanted: Set<string>) => Record<string, T>,
  /** Orders the other files in the directory; lower ranks are read first. */
  rank: (file: string) => number = () => 0,
) => {
  const found: Record<string, T> = {}
  const missing = () => [...ids].filter((id) => !(id in found))
  const scan = async (path: string) => {
    const text = await files.readText(path)
    if (text === null) return
    const left = missing()
    if (left.some((id) => text.includes(id))) Object.assign(found, parse(text, new Set(left)))
  }
  if (preferredFile) await scan(preferredFile)
  if (missing().length > 0) {
    const others = (await files.listFiles(dir)).sort((a, b) => rank(a) - rank(b))
    for (const file of others) {
      if (missing().length === 0) break
      const path = `${dir}/${file}`
      if (file.endsWith('.txt') && path !== preferredFile) await scan(path)
    }
  }
  return found
}

/** What to import: a country's focus tree, and where its ideas most likely live. */
export interface ImportTarget {
  /** Display name, used where a focus refers to its own country (`ROOT`). */
  name: string
  focusTreeFile: string
  ideasFile?: string
}

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

/** `Nuclear Reactor construction speed` as `Nuclear Reactor Construction Speed`. */
const titleCaseIf = (apply: boolean, text: string | undefined) =>
  apply && text ? text.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : text

/**
 * Reads a country's focus tree from the game files and attaches English display names.
 * Throws GameFolderError if the folder does not look like a HoI4 installation.
 */
export const importCountryFocuses = async (
  files: GameFiles,
  country: ImportTarget,
  statOverrides: StatOverrides = {},
  ownedDlc: Record<string, boolean> = {},
): Promise<Focus[]> => {
  const { focusTreeFile, ideasFile } = country
  const treeText = await files.readText(focusTreeFile)
  if (treeText === null) {
    throw new GameFolderError(
      `Could not find ${focusTreeFile}. Choose the Hearts of Iron IV installation folder (the one containing "common" and "localisation").`,
    )
  }
  // Pick the branch that applies to the DLCs we know about before anything is looked up, so
  // names and idea modifiers are only read for what will be shown.
  const parsed = parseFocusTreeFile(treeText).map((f) => ({
    ...f,
    effects: resolveDlcConditions(f.effects, ownedDlc),
  }))

  // Put each added idea's modifiers right under the line that adds it.
  const ideaIds = new Set(parsed.flatMap((f) => ideaIdsOf(f.effects)))
  const ideas = await readDefinitions(files, IDEAS_DIR, ideaIds, ideasFile, parseIdeas)
  // Some ideas share another idea's name (`name = ROM_x`) instead of having their own.
  const ideaAliases = await readDefinitions(files, IDEAS_DIR, ideaIds, ideasFile, parseIdeaNames)
  const opinionIds = new Set(
    parsed.flatMap((f) =>
      f.effects.flatMap((e) => (e.key === 'add_opinion_modifier' && e.value ? [e.value] : [])),
    ),
  )
  const opinions = await readDefinitions(
    files,
    OPINION_DIR,
    opinionIds,
    undefined,
    parseOpinionModifiers,
  )
  // Relation modifiers (`add_relation_modifier`) are static modifiers; their stats go under them.
  const relationIds = new Set(
    parsed.flatMap((f) =>
      f.effects.flatMap((e) => (e.key === 'add_relation_modifier' && e.value ? [e.value] : [])),
    ),
  )
  const relations = await readDefinitions(
    files,
    STATIC_MODIFIERS_DIR,
    relationIds,
    `${STATIC_MODIFIERS_DIR}/00_static_modifiers.txt`,
    parseStaticModifiers,
  )
  // Country leader traits (`add_country_leader_trait`, and the `traits` of a new leader) show
  // their stats beneath, like ideas do.
  const traitIds = new Set(
    parsed.flatMap((f) =>
      f.effects.flatMap((e) =>
        e.key === 'add_country_leader_trait' && e.value ? [e.value] : (e.traits ?? []),
      ),
    ),
  )
  const leaderTraits = await readDefinitions(
    files,
    LEADER_TRAITS_DIR,
    traitIds,
    `${LEADER_TRAITS_DIR}/00_traits.txt`,
    parseLeaderTraits,
  )
  const focuses = parsed.map((f) => {
    const adds = new Set(ideaLineIndexes(f.effects))
    const removes = new Set(removedIdeaLineIndexes(f.effects))
    return {
      ...f,
      effects: f.effects.flatMap((line, i): EffectLine[] => {
        const under = (lines: EffectLine[], extra = 0) =>
          lines.map((m) => ({
            ...m,
            depth: line.depth + 1 + extra + m.depth,
            hidden: line.hidden,
          }))
        if (line.traits) {
          // Each trait is a line of its own, with its stats one level further in.
          return [
            line,
            ...line.traits.flatMap((trait) => [
              { depth: line.depth + 1, key: 'leader_trait', value: trait, hidden: line.hidden },
              ...under(leaderTraits[trait] ?? [], 1),
            ]),
          ]
        }
        const modifiers = adds.has(i)
          ? (ideas[line.value!] ?? [])
          : removes.has(i)
            ? (ideas[line.value!] ?? []).map(reverseModifier)
            : line.key === 'add_relation_modifier' && line.value
              ? (relations[line.value] ?? [])
              : line.key === 'add_country_leader_trait' && line.value
                ? (leaderTraits[line.value] ?? [])
                : []
        return [line, ...under(modifiers)]
      }),
    }
  })

  // The country an effect line names, either as its subject or as a `SOV = { ... }` scope header.
  const tagOf = (e: EffectLine): string | undefined =>
    e.subject && isCountryTag(e.subject)
      ? e.subject
      : e.value === undefined && isCountryTag(e.key)
        ? e.key
        : undefined
  const tags = new Set(focuses.flatMap((f) => f.effects.flatMap((e) => tagOf(e) ?? [])))
  const { parties: rulingParties, factionTemplates } = await readCountryHistory(files, tags)
  const factionNames = await readDefinitions(
    files,
    FACTION_TEMPLATES_DIR,
    new Set(Object.values(factionTemplates)),
    undefined,
    parseFactionTemplates,
  )

  // Events fired by the focus: their titles, found by id in the events folder. Files are named
  // like the id's prefix with different capitalisation (`DOD_romania.30` is in `DOD_Romania.txt`).
  const eventIds = new Set(
    focuses.flatMap((f) =>
      f.effects.flatMap((e) =>
        (e.key === 'country_event' || e.key === 'news_event') && e.value ? [e.value] : [],
      ),
    ),
  )
  const eventPrefixes = new Set([...eventIds].map((id) => id.split('.')[0].toLowerCase()))
  const eventTitles = await readDefinitions(
    files,
    EVENTS_DIR,
    eventIds,
    undefined,
    parseEventTitles,
    (file) => (eventPrefixes.has(file.replace(/\.txt$/, '').toLowerCase()) ? 0 : 1),
  )

  // Names can live in any localisation file; focus-named files are by far the likeliest.
  // Besides names and descriptions, reward values (e.g. idea ids) are looked up for display.
  const wanted = new Set([
    ...Array.from(tags, (tag) => (rulingParties[tag] ? `${tag}_${rulingParties[tag]}` : tag)),
    ...Object.values(eventTitles),
    ...Object.values(factionNames),
    ...focuses.flatMap((f) => [
      f.id,
      `${f.id}_desc`,
      ...f.effects.flatMap((e) => [
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
      ]),
    ]),
  ])
  const names: Record<string, string> = {}
  const rawNames: Record<string, string> = {}
  const localisationFiles = (await files.listFiles(LOCALISATION_DIR)).filter((f) =>
    f.endsWith('.yml'),
  )
  const isFocusFile = (f: string) => f.toLowerCase().includes('focus')
  const batches = [
    localisationFiles.filter(isFocusFile),
    localisationFiles.filter((f) => !isFocusFile(f)),
  ]
  const load = async (want: Set<string>) => {
    for (const batch of batches) {
      if ([...want].every((key) => key in names)) return
      for (const file of batch) {
        const text = await files.readText(`${LOCALISATION_DIR}/${file}`)
        if (text !== null) Object.assign(names, parseLocalisation(text, want, rawNames))
      }
    }
  }
  await load(wanted)
  // Some texts are built from others (`$ROM_national_christian_party_in_power$`): fetch and fill
  // those in too.
  const REFERENCE = /\$([\w.]+)\$/g
  const referenced = new Set(
    Object.values(names).flatMap((text) => [...text.matchAll(REFERENCE)].map((m) => m[1])),
  )
  const unread = new Set([...referenced].filter((key) => !(key in names)))
  if (unread.size > 0) await load(unread)
  for (const key of Object.keys(names)) {
    names[key] = names[key].replace(REFERENCE, (whole, ref: string) => names[ref] ?? whole)
  }

  const countryName = (tag: string) => names[`${tag}_${rulingParties[tag]}`] ?? names[tag]
  /** The country whose scope a line sits in (`GER = { ... }`); undefined for our own. */
  const scopeTagAt = (effects: EffectLine[], index: number): string | undefined => {
    let depth = effects[index].depth
    for (let j = index - 1; j >= 0 && depth > 0; j--) {
      if (effects[j].depth >= depth) continue
      depth = effects[j].depth
      if (effects[j].value === undefined && isCountryTag(effects[j].key)) return effects[j].key!
    }
    return undefined
  }
  const eventTitleFor = (effects: EffectLine[], index: number): string | undefined => {
    const titleKey = eventTitles[effects[index].value ?? '']
    if (!titleKey) return undefined
    const recipient = scopeTagAt(effects, index)
    const template = recipient ? factionTemplates[recipient] : undefined
    const faction = template ? factionNames[template] : undefined
    return resolveEventText(rawNames[titleKey] ?? names[titleKey] ?? titleKey, {
      from: recipient ? country.name : undefined,
      root: recipient ? countryName(recipient) : country.name,
      rootFaction: faction ? (names[faction] ?? faction) : undefined,
    })
  }

  const statDocs = parseStatDocs((await files.readText(STAT_DOCS_FILE)) ?? '')

  return focuses.map((f) => ({
    ...f,
    name: names[f.id] ?? f.id,
    description: names[`${f.id}_desc`],
    effects: foldConditions(
      f.effects.map((e, i) => ({
        ...e,
        eventTitle:
          e.key === 'country_event' || e.key === 'news_event'
            ? eventTitleFor(f.effects, i)
            : undefined,
        research: e.research && {
          ...e.research,
          targetNames: e.research.targets.map((t) => {
            // Some names are just a reference to another key, written `$key$`.
            const name = (names[t] ?? t.replace(/_/g, ' ')).trim()
            const ref = /^\$(.+)\$$/.exec(name)
            return ref ? (names[ref[1]]?.trim() ?? ref[1].replace(/_/g, ' ')) : name
          }),
        },
        valueName:
          e.key === 'add_claim_by' && e.value && isOwnScope(e.value)
            ? country.name
            : e.key === 'set_cosmetic_tag' && e.value && !names[e.value]
              ? // No localisation: drop the country tag from `ROM_polish_loyalists`.
                e.value.replace(/^[A-Z]{3}_/, '').replace(/_/g, ' ')
              : popularityComparison(e)
                ? names[popularityComparison(e)![1]]
                : e.value && !e.isModifier
                  ? (names[e.value] ?? names[ideaAliases[e.value]])
                  : undefined,
        subject: e.subject ?? tagOf(e),
        preferNames: e.preferStates?.map((id) => names[`STATE_${id}`] ?? `state ${id}`),
        subjectName:
          e.key === 'add_resource' && e.subject
            ? names[`state_resource_${e.subject}`]
            : isStateScope(e)
              ? (names[`STATE_${e.key}`] ?? `State ${e.key}`)
              : isCharacterScope(e)
                ? names[e.key!]
                : popularityComparison(e)
                  ? names[popularityComparison(e)![0]]
                  : tagOf(e)
                    ? (names[`${tagOf(e)}_${rulingParties[tagOf(e)!]}`] ?? names[tagOf(e)!])
                    : e.subject && isOwnScope(e.subject)
                      ? country.name
                      : e.subject
                        ? names[e.subject]
                        : undefined,
        opinion:
          e.key === 'add_opinion_modifier' && e.value
            ? (opinions[e.value] ?? undefined)
            : undefined,
        stat:
          e.isModifier && e.key
            ? resolveStat(
                e.key,
                e.subject
                  ? `${names[e.subject] ?? e.subject.replace(/_/g, ' ')} popularity`
                  : titleCaseIf(
                      isBuildingSpeedModifier(e.key),
                      modifierNameKeys(e.key)
                        .map((k) => names[k])
                        .find(Boolean),
                    ),
                statDocs,
                statOverrides,
                e.isRule ? { kind: 'flag' } : { goodWhen: defaultGoodWhen(e.key) },
              )
            : undefined,
      })),
    ),
  }))
}
