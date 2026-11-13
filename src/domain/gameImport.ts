/**
 * Reading a country's focus tree out of a HoI4 installation.
 *
 * The import runs in phases, each of which only looks up what the previous one turned out to
 * need, so a tree costs a handful of files rather than the whole install:
 *
 * 1. parse the focus tree and settle its DLC branches;
 * 2. read the definitions its effects refer to (ideas, opinion and relation modifiers, leader
 *    traits) and list each one's own stats beneath the line that applies it;
 * 3. read what the countries it mentions start the game as, and the titles of events it fires;
 * 4. load the localised text for every key those steps collected;
 * 5. put those names and the stat definitions onto the effect lines, and fold `limit` blocks
 *    into conditions now that they can be written out in English.
 */
import type { EffectLine, Focus } from './focus'
import { parseFocusTreeFile } from './parsers/focusTree'
import {
  defaultGoodWhen,
  foldConditions,
  humanize,
  ideaIdsOf,
  ideaLineIndexes,
  isBuildingSpeedModifier,
  isCountryTag,
  isOwnScope,
  modifierNameKeys,
  removedIdeaLineIndexes,
  resolveDlcConditions,
  reverseModifier,
} from './focusEffects'
import { readCountryHistory, readCountryHistoryText, readDefinitions } from './definitions'
import { GAME_PATHS, GameFolderError, type GameFiles } from './gameFiles'
import { loadNames } from './names'
import { parseIdeaNames, parseIdeas } from './parsers/ideas'
import { parseOpinionModifiers } from './parsers/opinionModifiers'
import { parseLeaderTraits } from './parsers/leaderTraits'
import { parseStaticModifiers } from './parsers/staticModifiers'
import { parseEventTitles } from './parsers/events'
import { parseStartingLines } from './parsers/countryStart'
import {
  parseIdeologyGroups,
  parseLeaderRoles,
  parseRecruited,
  pickStartingLeader,
} from './parsers/leaders'
import { parseFactionTemplates } from './parsers/factions'
import { resolveEventText } from './parsers/localisation'
import { parseStatDocs, resolveStat, type StatDefinition, type StatOverrides } from './stats'

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

/** What an import produces: the focus tree, and what the country starts the game with. */
export interface ImportedCountry {
  focuses: Focus[]
  /** The starting ideas, stats and politics as effect lines, applied like a focus reward. */
  start: EffectLine[]
}

/** Stands in for the starting state while it goes through the same passes as the focuses. */
const START_ID = '__start__'

/**
 * The line making the country's starting leader its leader (`promote_character`), or nothing when
 * the history recruits nobody who leads the ruling party.
 */
const startingLeaderLine = async (
  files: GameFiles,
  tag: string,
  historyText: string,
  rulingParty: string,
): Promise<EffectLine[]> => {
  const roles = parseLeaderRoles(
    (await files.readText(`${GAME_PATHS.characters}/${tag}.txt`)) ?? '',
  )
  const ideologies = await Promise.all(
    (await files.listFiles(GAME_PATHS.ideologies))
      .filter((file) => file.endsWith('.txt'))
      .map((file) => files.readText(`${GAME_PATHS.ideologies}/${file}`)),
  )
  const groups = Object.assign({}, ...ideologies.map((text) => parseIdeologyGroups(text ?? '')))
  const leader = pickStartingLeader(parseRecruited(historyText), roles, groups, rulingParty)
  return leader
    ? [{ depth: 0, key: 'promote_character', value: leader.character, subject: leader.ideology }]
    : []
}

/** Every value the focuses' effects give for `keys`, e.g. all the opinion modifiers they add. */
const valuesOf = (focuses: Focus[], ...keys: string[]): Set<string> =>
  new Set(
    focuses.flatMap((f) =>
      f.effects.flatMap((e) =>
        e.key !== null && keys.includes(e.key) && e.value ? [e.value] : [],
      ),
    ),
  )

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
const tagOf = (e: EffectLine): string | undefined => {
  if (e.subject && isCountryTag(e.subject)) return e.subject
  return e.value === undefined && isCountryTag(e.key) ? e.key : undefined
}

/** `Nuclear Reactor construction speed` as `Nuclear Reactor Construction Speed`. */
const titleCaseIf = (apply: boolean, text: string | undefined) =>
  apply && text ? text.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : text

/** Stat lines of the things a focus can apply, which are shown beneath the line applying them. */
interface Definitions {
  ideas: Record<string, EffectLine[]>
  relations: Record<string, EffectLine[]>
  leaderTraits: Record<string, EffectLine[]>
}

/**
 * Puts each applied idea's, relation modifier's and leader trait's own stats directly beneath
 * the line that applies it, one level deeper. A removed idea's modifiers are reversed, since the
 * change is being undone, and a leader's `traits` become a line each with their stats under them.
 */
const listModifiersUnderLines = (effects: EffectLine[], defs: Definitions): EffectLine[] => {
  const adds = new Set(ideaLineIndexes(effects))
  const removes = new Set(removedIdeaLineIndexes(effects))
  const modifiersFor = (line: EffectLine, i: number): EffectLine[] => {
    if (adds.has(i)) return defs.ideas[line.value!] ?? []
    if (removes.has(i)) return (defs.ideas[line.value!] ?? []).map(reverseModifier)
    if (!line.value) return []
    if (line.key === 'add_relation_modifier') return defs.relations[line.value] ?? []
    if (line.key === 'add_country_leader_trait') return defs.leaderTraits[line.value] ?? []
    return []
  }
  return effects.flatMap((line, i): EffectLine[] => {
    /** Nests lines under `line`, keeping them hidden if it is hidden. */
    const under = (lines: EffectLine[], extra = 0) =>
      lines.map((m) => ({ ...m, depth: line.depth + 1 + extra + m.depth, hidden: line.hidden }))
    if (line.traits) {
      return [
        line,
        ...line.traits.flatMap((trait) => [
          { depth: line.depth + 1, key: 'leader_trait', value: trait, hidden: line.hidden },
          ...under(defs.leaderTraits[trait] ?? [], 1),
        ]),
      ]
    }
    return [line, ...under(modifiersFor(line, i))]
  })
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
  // Pick the branch that applies to the DLCs we know about before anything is looked up, so
  // names and idea modifiers are only read for what will be shown.
  const historyText = await readCountryHistoryText(files, country.tag)
  const startLines = historyText ? parseStartingLines(historyText, ownedDlc) : []
  const rulingParty = startLines.find((e) => e.key === 'set_politics')?.value
  if (historyText && rulingParty) {
    startLines.push(...(await startingLeaderLine(files, country.tag, historyText, rulingParty)))
  }
  const startFocus: Focus = {
    id: START_ID,
    name: '',
    days: 0,
    prerequisites: [],
    mutuallyExclusive: [],
    x: 0,
    y: 0,
    effects: startLines,
  }
  const parsed = [
    ...parseFocusTreeFile(treeText).map((f) => ({
      ...f,
      effects: resolveDlcConditions(f.effects, ownedDlc),
    })),
    // The starting state is carried along as one more reward, so its ideas are read and named too.
    startFocus,
  ]

  // --- The definitions the effects refer to, each read from the directory it lives in. ---
  const ideaIds = new Set(parsed.flatMap((f) => ideaIdsOf(f.effects)))
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
    valuesOf(parsed, 'add_opinion_modifier'),
    undefined,
    parseOpinionModifiers,
  )
  // Relation modifiers (`add_relation_modifier`) are static modifiers; their stats go under them.
  const relations = await readDefinitions(
    files,
    GAME_PATHS.staticModifiers,
    valuesOf(parsed, 'add_relation_modifier'),
    `${GAME_PATHS.staticModifiers}/00_static_modifiers.txt`,
    parseStaticModifiers,
  )
  // Country leader traits (`add_country_leader_trait`, and the `traits` of a new leader) show
  // their stats beneath, like ideas do.
  const traitIds = new Set([
    ...valuesOf(parsed, 'add_country_leader_trait'),
    ...parsed.flatMap((f) => f.effects.flatMap((e) => e.traits ?? [])),
  ])
  const leaderTraits = await readDefinitions(
    files,
    GAME_PATHS.leaderTraits,
    traitIds,
    `${GAME_PATHS.leaderTraits}/00_traits.txt`,
    parseLeaderTraits,
  )

  const focuses = parsed.map((f) => ({
    ...f,
    effects: listModifiersUnderLines(f.effects, { ideas, relations, leaderTraits }),
  }))

  // --- What the countries the tree mentions start the game as, and the events it fires. ---
  const tags = new Set(focuses.flatMap((f) => f.effects.flatMap((e) => tagOf(e) ?? [])))
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
  const eventIds = valuesOf(focuses, 'country_event', 'news_event')
  const eventPrefixes = new Set([...eventIds].map((id) => id.split('.')[0].toLowerCase()))
  const eventTitles = await readDefinitions(
    files,
    GAME_PATHS.events,
    eventIds,
    undefined,
    parseEventTitles,
    (file) => (eventPrefixes.has(file.replace(/\.txt$/, '').toLowerCase()) ? 0 : 1),
  )

  // --- Every localisation key the above might need a name from. ---
  const effectNameKeys = (e: EffectLine): string[] => [
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
  const { names, rawNames } = await loadNames(
    files,
    new Set([
      // A country goes by the name of its ruling party at game start.
      ...Array.from(tags, (tag) => (rulingParties[tag] ? `${tag}_${rulingParties[tag]}` : tag)),
      ...Object.values(eventTitles),
      ...Object.values(factionNames),
      ...focuses.flatMap((f) => [f.id, `${f.id}_desc`, ...f.effects.flatMap(effectNameKeys)]),
    ]),
  )
  const statDocs = parseStatDocs((await files.readText(GAME_PATHS.statDocs)) ?? '')

  // --- Putting the names and stat definitions onto the lines. ---
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

  /**
   * An event's title, with `From` and `Root` filled in. Events are written from the receiving
   * country's view, so inside a `GER = { ... }` scope `Root` is Germany and `From` is us.
   */
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
    return resolveStat(e.key, label, statDocs, statOverrides, fallbacks)
  }

  const finished = focuses.map((f) => ({
    ...f,
    name: names[f.id] ?? f.id,
    description: names[`${f.id}_desc`],
    // `foldConditions` writes conditions out in English, so it has to run after the names exist.
    effects: foldConditions(
      f.effects.map((e, i) => ({
        ...e,
        eventTitle: isEventLine(e) ? eventTitleFor(f.effects, i) : undefined,
        research: researchNamesOf(e),
        valueName: valueNameOf(e),
        subject: e.subject ?? tagOf(e),
        subjectName: subjectNameOf(e),
        preferNames: e.preferStates?.map((id) => names[`STATE_${id}`] ?? `state ${id}`),
        opinion: e.key === 'add_opinion_modifier' && e.value ? opinions[e.value] : undefined,
        stat: statOf(e),
      })),
    ),
  }))
  return {
    focuses: finished.filter((f) => f.id !== START_ID),
    start: finished.find((f) => f.id === START_ID)?.effects ?? [],
  }
}
