import type { EffectLine, Focus } from './focus'
import { parseFocusTreeFile } from './focusTree'
import {
  ideaIdsOf,
  ideaLineIndexes,
  isCountryTag,
  isOwnScope,
  modifierNameKeys,
} from './focusEffects'
import { parseIdeas } from './ideas'
import { parseOpinionModifiers } from './opinionModifiers'
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

/**
 * Reads a country's focus tree from the game files and attaches English display names.
 * Throws GameFolderError if the folder does not look like a HoI4 installation.
 */
export const importCountryFocuses = async (
  files: GameFiles,
  country: ImportTarget,
  statOverrides: StatOverrides = {},
): Promise<Focus[]> => {
  const { focusTreeFile, ideasFile } = country
  const treeText = await files.readText(focusTreeFile)
  if (treeText === null) {
    throw new GameFolderError(
      `Could not find ${focusTreeFile}. Choose the Hearts of Iron IV installation folder (the one containing "common" and "localisation").`,
    )
  }
  const parsed = parseFocusTreeFile(treeText)

  // Put each added idea's modifiers right under the line that adds it.
  const ideaIds = new Set(parsed.flatMap((f) => ideaIdsOf(f.effects)))
  const ideas = await readDefinitions(files, IDEAS_DIR, ideaIds, ideasFile, parseIdeas)
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
  const focuses = parsed.map((f) => {
    const adds = new Set(ideaLineIndexes(f.effects))
    return {
      ...f,
      effects: f.effects.flatMap((line, i) => {
        const modifiers = adds.has(i)
          ? (ideas[line.value!] ?? [])
          : line.key === 'add_relation_modifier' && line.value
            ? (relations[line.value] ?? [])
            : []
        return [
          line,
          ...modifiers.map((m) => ({ ...m, depth: line.depth + 1 + m.depth, hidden: line.hidden })),
        ]
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
      f.effects.flatMap((e) => (e.key === 'country_event' && e.value ? [e.value] : [])),
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
        ...(e.preferStates ?? []).map((id) => `STATE_${id}`),
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
  for (const batch of batches) {
    if (Object.keys(names).length >= wanted.size) break
    for (const file of batch) {
      const text = await files.readText(`${LOCALISATION_DIR}/${file}`)
      if (text !== null) Object.assign(names, parseLocalisation(text, wanted, rawNames))
    }
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
    effects: f.effects.map((e, i) => ({
      ...e,
      eventTitle: e.key === 'country_event' ? eventTitleFor(f.effects, i) : undefined,
      valueName: e.value && !e.isModifier ? names[e.value] : undefined,
      subject: e.subject ?? tagOf(e),
      preferNames: e.preferStates?.map((id) => names[`STATE_${id}`] ?? `state ${id}`),
      subjectName:
        e.key === 'add_resource' && e.subject
          ? names[`state_resource_${e.subject}`]
          : tagOf(e)
            ? (names[`${tagOf(e)}_${rulingParties[tagOf(e)!]}`] ?? names[tagOf(e)!])
            : e.subject && isOwnScope(e.subject)
              ? country.name
              : e.subject
                ? names[e.subject]
                : undefined,
      opinion:
        e.key === 'add_opinion_modifier' && e.value ? (opinions[e.value] ?? undefined) : undefined,
      stat:
        e.isModifier && e.key
          ? resolveStat(
              e.key,
              e.subject
                ? `${names[e.subject] ?? e.subject.replace(/_/g, ' ')} popularity`
                : modifierNameKeys(e.key)
                    .map((k) => names[k])
                    .find(Boolean),
              statDocs,
              statOverrides,
              e.isRule ? { kind: 'flag' } : {},
            )
          : undefined,
    })),
  }))
}
