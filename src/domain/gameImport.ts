/**
 * Reading a country's focus tree out of a HoI4 installation.
 *
 * The import runs in phases, each of which only looks up what the previous one turned out to
 * need, so a tree costs a handful of files rather than the whole install:
 *
 * 1. parse the focus tree and settle its DLC branches, and read how the country starts the game;
 * 2. read the definitions its effects refer to (ideas, opinion and relation modifiers, leader
 *    traits) and list each one's own stats beneath the line that applies it;
 * 3. read what the countries it mentions start the game as, and the titles of events it fires;
 * 4. load the localised text for every key those steps collected;
 * 5. put those names and the stat definitions onto the effect lines (`nameLines.ts`), and fold
 *    `limit` blocks into conditions now that they can be written out in English.
 *
 * The technologies are read whole (the research planner needs the tree, not a handful of ids),
 * and their names and stats are looked up in the same phases.
 *
 * The starting state and the leader candidates are not focuses, but they go through the same
 * phases as one more list of effect lines each, so their ideas and names are looked up too.
 */
import type { EffectLine, ImportedCountry } from './focus'
import type { Technology } from './research'
import { parseFocusTreeFile } from './parsers/focusTree'
import { ideaIdsOf, resolveDlcConditions } from './focusEffects'
import { listModifiersUnderLines } from './effects/modifierLines'
import { readCountryHistory, readCountryHistoryText, readDefinitions } from './definitions'
import { GAME_PATHS, GameFolderError, type GameFiles } from './gameFiles'
import { loadNames } from './names'
import { nameKeysOf, nameLines, tagOf } from './nameLines'
import { humanize } from './focusEffects'
import { parseIdeaNames, parseIdeas } from './parsers/ideas'
import { parseOpinionModifiers } from './parsers/opinionModifiers'
import { parseLeaderTraits } from './parsers/leaderTraits'
import { parseStaticModifiers } from './parsers/staticModifiers'
import { parseEventTitles } from './parsers/events'
import { parseStartingLines } from './parsers/countryStart'
import { readTechnologies } from './parsers/technologies'
import { readProduction } from './parsers/states'
import {
  defaultLawLines,
  lawCategoryOf,
  mergeLawCategories,
  parseLawCategories,
} from './parsers/laws'
import {
  parseIdeologyGroups,
  parseLeaderRoles,
  listLeaderCandidates,
  parseRecruited,
  pickStartingLeader,
} from './parsers/leaders'
import { parseFactionTemplates } from './parsers/factions'
import {
  annotateIdeaLines,
  availabilityLines,
  finishOption,
  readPolitics,
} from './politicsImport'
import { parseStatDocs, type StatOverrides } from './stats'

// Re-exported so callers have one import for "reading the game folder".
export { GameFolderError, type GameFiles } from './gameFiles'

/** What to import: a country's focus tree, and where its ideas most likely live. */
export interface ImportTarget {
  tag: string
  /** Display name, used where a focus refers to its own country (`ROOT`). */
  name: string
  focusTreeFile: string
  ideasFile?: string
}

/** The history's recruits with the leader roles of each and the ideology groups, read once. */
const readLeaderSources = async (files: GameFiles, tag: string, historyText: string) => {
  const roles = parseLeaderRoles(
    (await files.readText(`${GAME_PATHS.characters}/${tag}.txt`)) ?? '',
  )
  const ideologies = await Promise.all(
    (await files.listFiles(GAME_PATHS.ideologies))
      .filter((file) => file.endsWith('.txt'))
      .map((file) => files.readText(`${GAME_PATHS.ideologies}/${file}`)),
  )
  const groups = Object.assign({}, ...ideologies.map((text) => parseIdeologyGroups(text ?? '')))
  return { recruited: parseRecruited(historyText), roles, groups }
}

/** Every value the effects give for `keys`, e.g. all the opinion modifiers they add. */
const valuesOf = (lists: EffectLine[][], ...keys: string[]): Set<string> =>
  new Set(
    lists.flatMap((lines) =>
      lines.flatMap((e) => (e.key !== null && keys.includes(e.key) && e.value ? [e.value] : [])),
    ),
  )

/**
 * The start's `add_ideas` for the laws the history does not set (see `defaultLawLines`), and the
 * law category of every law idea, so a new law replaces the old one.
 */
const readDefaultLaws = async (files: GameFiles, startLines: EffectLine[]) => {
  const texts = await Promise.all(
    (await files.listFiles(GAME_PATHS.ideas))
      .filter((file) => file.endsWith('.txt'))
      .map((file) => files.readText(`${GAME_PATHS.ideas}/${file}`)),
  )
  const categories = mergeLawCategories(
    texts.flatMap((text) => (text?.includes('law = yes') ? [parseLawCategories(text)] : [])),
  )
  return { lines: defaultLawLines(categories, startLines), laws: lawCategoryOf(categories) }
}

/**
 * How the country starts the game, as effect lines (with the starting leader added), and the
 * characters who could lead it later, as `promote_character` lines in the order the game would
 * pick them.
 */
const readStart = async (files: GameFiles, tag: string, ownedDlc: Record<string, boolean>) => {
  const historyText = await readCountryHistoryText(files, tag)
  const startLines = historyText ? parseStartingLines(historyText, ownedDlc) : []
  const defaults = historyText ? await readDefaultLaws(files, startLines) : undefined
  if (defaults) startLines.push(...defaults.lines)
  const rulingParty = startLines.find((e) => e.key === 'set_politics')?.value
  const sources = historyText ? await readLeaderSources(files, tag, historyText) : undefined
  if (sources && rulingParty) {
    const leader = pickStartingLeader(sources.recruited, sources.roles, sources.groups, rulingParty)
    if (leader) {
      startLines.push({
        depth: 0,
        key: 'promote_character',
        value: leader.character,
        subject: leader.ideology,
      })
    }
  }
  const candidates = sources
    ? listLeaderCandidates(sources.recruited, sources.roles, sources.groups)
    : []
  const candidateLines = candidates.map(
    (c): EffectLine => ({
      depth: 0,
      key: 'promote_character',
      value: c.character,
      subject: c.ideology,
    }),
  )
  return {
    startLines,
    candidates,
    candidateLines,
    groups: sources?.groups ?? {},
    laws: defaults?.laws ?? {},
    recruited: sources?.recruited ?? [],
  }
}

/** The definitions the effects refer to, each read from the directory it lives in. */
const readEffectDefinitions = async (
  files: GameFiles,
  lists: EffectLine[][],
  ideasFile: string | undefined,
) => {
  const ideaIds = new Set(lists.flatMap((lines) => ideaIdsOf(lines)))
  const ideas = await readDefinitions(files, GAME_PATHS.ideas, ideaIds, ideasFile, parseIdeas)
  // Some ideas share another idea's name (`name = ROM_x`) instead of having their own.
  const ideaAliases = await readDefinitions(
    files,
    GAME_PATHS.ideas,
    ideaIds,
    ideasFile,
    parseIdeaNames,
  )
  const opinions = await readDefinitions(
    files,
    GAME_PATHS.opinionModifiers,
    valuesOf(lists, 'add_opinion_modifier'),
    undefined,
    parseOpinionModifiers,
  )
  // Relation modifiers (`add_relation_modifier`) are static modifiers; their stats go under them.
  const relations = await readDefinitions(
    files,
    GAME_PATHS.staticModifiers,
    valuesOf(lists, 'add_relation_modifier'),
    `${GAME_PATHS.staticModifiers}/00_static_modifiers.txt`,
    parseStaticModifiers,
  )
  // Country leader traits (`add_country_leader_trait`, and the `traits` of a new leader) show
  // their stats beneath, like ideas do.
  const traitIds = new Set([
    ...valuesOf(lists, 'add_country_leader_trait'),
    ...lists.flatMap((lines) => lines.flatMap((e) => e.traits ?? [])),
  ])
  const leaderTraits = await readDefinitions(
    files,
    GAME_PATHS.leaderTraits,
    traitIds,
    `${GAME_PATHS.leaderTraits}/00_traits.txt`,
    parseLeaderTraits,
  )
  return { ideas, ideaAliases, opinions, relations, leaderTraits }
}

/** What the countries the effects mention start the game as, and the events they fire. */
const readCountryContext = async (files: GameFiles, lists: EffectLine[][]) => {
  const tags = new Set(lists.flatMap((lines) => lines.flatMap((e) => tagOf(e) ?? [])))
  const { parties: rulingParties, factionTemplates } = await readCountryHistory(files, tags)
  const factionNames = await readDefinitions(
    files,
    GAME_PATHS.factionTemplates,
    new Set(Object.values(factionTemplates)),
    undefined,
    parseFactionTemplates,
  )
  // Events are found by id in the events folder. Files are named like the id's prefix with
  // different capitalisation (`DOD_romania.30` is in `DOD_Romania.txt`), so those come first.
  const eventIds = valuesOf(lists, 'country_event', 'news_event')
  const eventPrefixes = new Set([...eventIds].map((id) => id.split('.')[0].toLowerCase()))
  const eventTitles = await readDefinitions(
    files,
    GAME_PATHS.events,
    eventIds,
    undefined,
    parseEventTitles,
    (file) => (eventPrefixes.has(file.replace(/\.txt$/, '').toLowerCase()) ? 0 : 1),
  )
  return { tags, rulingParties, factionTemplates, factionNames, eventTitles }
}

/**
 * Reads a country's focus tree from the game files and attaches English display names.
 * Throws GameFolderError if the folder does not look like a HoI4 installation.
 */
export const importCountryFocuses = async (
  files: GameFiles,
  country: ImportTarget,
  statOverrides: StatOverrides = {},
  ownedDlc: Record<string, boolean> = {},
): Promise<ImportedCountry> => {
  const { focusTreeFile, ideasFile } = country
  const treeText = await files.readText(focusTreeFile)
  if (treeText === null) {
    throw new GameFolderError(
      `Could not find ${focusTreeFile}. Choose the Hearts of Iron IV installation folder (the one containing "common" and "localisation").`,
    )
  }

  // 1. Pick the branch that applies to the DLCs we know about before anything is looked up, so
  // names and idea modifiers are only read for what will be shown.
  const tree = parseFocusTreeFile(treeText).map((f) => ({
    ...f,
    effects: resolveDlcConditions(f.effects, ownedDlc),
  }))
  const { startLines, candidates, candidateLines, groups, laws, recruited } = await readStart(
    files,
    country.tag,
    ownedDlc,
  )
  // What political power can buy; the law of each slot the history leaves empty is a start idea.
  const politics = await readPolitics(files, country, ownedDlc, recruited)

  // 2. The definitions the effects refer to, listed beneath the lines that apply them.
  const defs = await readEffectDefinitions(
    files,
    [...tree.map((f) => f.effects), startLines, candidateLines],
    ideasFile,
  )
  const listed = (lines: EffectLine[]) => listModifiersUnderLines(lines, defs)
  const focuses = tree.map((f) => ({ ...f, effects: listed(f.effects) }))
  const start = listed(startLines)
  const candidatesListed = listed(candidateLines)
  // The tech tree: its folders, and the stats of each tech, which are named like any other line.
  const { data: research, fallbackNames } = await readTechnologies(files, ownedDlc)
  const production = await readProduction(files, country.tag)
  const lists = [
    ...focuses.map((f) => f.effects),
    start,
    candidatesListed,
    ...research.techs.map((t) => t.modifiers),
    ...politics.options.flatMap((o) => [o.modifiers, availabilityLines(o)]),
  ]

  // 3. What the countries and events they mention are.
  const context = await readCountryContext(files, lists)

  // 4. Every localisation key the above might need a name from.
  const { names, rawNames } = await loadNames(
    files,
    new Set([
      // A country goes by the name of its ruling party at game start.
      ...Array.from(context.tags, (tag) =>
        context.rulingParties[tag] ? `${tag}_${context.rulingParties[tag]}` : tag,
      ),
      ...Object.values(context.eventTitles),
      ...Object.values(context.factionNames),
      ...focuses.flatMap((f) => [f.id, `${f.id}_desc`]),
      ...production.states.map((s) => s.name),
      ...production.buildings.map((b) => b.id),
      ...research.techs.map((t) => t.id),
      ...research.folders.map((f) => f.id),
      ...politics.options.flatMap((o) => [o.id, ...(o.character ? [o.character] : [])]),
      ...politics.options.flatMap((o) => Object.keys(o.researchBonus ?? {})),
      ...Object.values(fallbackNames).flat(),
      ...lists.flatMap((lines) => lines.flatMap((e) => nameKeysOf(e, defs.ideaAliases))),
    ]),
  )
  const statDocs = parseStatDocs((await files.readText(GAME_PATHS.statDocs)) ?? '')

  // 5. Putting the names and stat definitions onto the lines.
  const nameContext = {
    country,
    names,
    rawNames,
    rulingParties: context.rulingParties,
    factionTemplates: context.factionTemplates,
    factionNames: context.factionNames,
    eventTitles: context.eventTitles,
    ideaAliases: defs.ideaAliases,
    opinions: defs.opinions,
    statDocs,
    statOverrides,
  }
  const named = (lines: EffectLine[]) => nameLines(lines, nameContext)
  const namedCandidates = named(candidatesListed)
  /** A tech's name; one without its own is named after what it unlocks, and failing that its id. */
  const techName = (id: string) => {
    const candidates = [id, ...(fallbackNames[id] ?? [])].map((key) => (names[key] ?? '').trim())
    return candidates.find((name) => name && !/^\$.+\$$/.test(name)) ?? humanize(id)
  }
  /** An option's name, with its modifier lines named and its `available` block written out. */
  const options = politics.options.map((o) =>
    finishOption(o, names[o.character ?? o.id] ?? names[o.id] ?? humanize(o.id), named),
  )
  const optionsById = new Map(options.map((o) => [o.id, o]))
  const annotated = (lines: EffectLine[]) => annotateIdeaLines(lines, optionsById)
  return {
    laws,
    focuses: focuses.map((f) => ({
      ...f,
      name: names[f.id] ?? f.id,
      description: names[`${f.id}_desc`],
      effects: annotated(named(f.effects)),
    })),
    start: annotated(named(start)),
    politics: {
      options,
      slots: politics.slots,
      categoryNames: Object.fromEntries(
        options.flatMap((o) =>
          Object.keys(o.researchBonus ?? {}).map((c) => [c, (names[c] ?? humanize(c)).trim()]),
        ),
      ),
      defines: politics.defines,
    },
    leaders: {
      candidates: candidates.map((c, i) => ({ group: c.group, line: namedCandidates[i] })),
      groups,
    },
    production: {
      ...production,
      states: production.states.map((s) => ({ ...s, name: names[s.name] ?? humanize(s.name) })),
      buildings: production.buildings.map((b) => ({ ...b, name: names[b.id] ?? humanize(b.id) })),
    },
    research: {
      ...research,
      techs: research.techs.map(
        (t): Technology => ({ ...t, name: techName(t.id), modifiers: named(t.modifiers) }),
      ),
      folders: research.folders.map((f) => ({ ...f, name: names[f.id] ?? humanize(f.id) })),
    },
  }
}
