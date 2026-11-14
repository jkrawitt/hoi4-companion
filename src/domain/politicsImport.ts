/**
 * Reading what political power buys for a country: its laws, designers, industrial concern and
 * advisors, which `gameImport.ts` then names like any other effect lines. An option the country
 * can never have (`allowed` is false for its tag and DLCs) is dropped; one that is only
 * sometimes available keeps its `available` condition for the campaign to answer.
 */
import type { EffectLine } from './focus'
import { evaluateCheck, type ConditionContext } from './campaign/conditions'
import { ideaLineIndexes } from './effects/ideaLines'
import { GAME_PATHS, type GameFiles } from './gameFiles'
import { readDefinitions } from './definitions'
import { parseLeaderTraits } from './parsers/leaderTraits'
import {
  parseAdvisors,
  parseDesigners,
  parseIdeaSlots,
  parseLaws,
  parseScriptedTriggers,
  type ScriptedTriggers,
  parsePoliticsDefines,
  type RawOption,
} from './parsers/politics'
import type { PoliticalOption, PoliticsData } from './politics'

/** The laws live in these two files; the designers in the country's ideas file and the generic one. */
const LAW_FILES = [`${GAME_PATHS.ideas}/_economic.txt`, `${GAME_PATHS.ideas}/_manpower.txt`]
const GENERIC_IDEAS = `${GAME_PATHS.ideas}/zzz_generic.txt`

export interface RawPolitics {
  options: RawOption[]
  slots: Record<string, number>
  lawSlots: string[]
  defines: PoliticsData['defines']
}

const AAT = 'Arms Against Tyranny'
/** The designer slots that Arms Against Tyranny turns into military industrial organisations. */
const MIO_SLOTS = new Set([
  'tank_manufacturer',
  'naval_manufacturer',
  'aircraft_manufacturer',
  'materiel_manufacturer',
])

/** Whether an option can ever be had by a country, from its `allowed` block. Unknown counts as yes. */
const isAllowed = (option: RawOption, tag: string, ownedDlc: Record<string, boolean>): boolean => {
  if (!option.allowed) return true
  const none = () => undefined
  const ctx: ConditionContext = {
    hasIdea: none,
    hasFocus: none,
    leader: none,
    government: none,
    popularity: none,
    tag,
    hasDlc: (id) => ownedDlc[id] === true,
  }
  return evaluateCheck(option.allowed, ctx) !== false
}

const readAll = async (files: GameFiles, paths: string[]) =>
  (await Promise.all(paths.map((path) => files.readText(path)))).map((text) => text ?? '')

export const readPolitics = async (
  files: GameFiles,
  country: { tag: string; ideasFile?: string },
  ownedDlc: Record<string, boolean>,
  recruited: string[],
): Promise<RawPolitics> => {
  const { tag } = country
  const [tagsText, charactersText, definesText, staticModifiersText] = await readAll(files, [
    `${GAME_PATHS.ideaTags}/00_idea.txt`,
    `${GAME_PATHS.characters}/${tag}.txt`,
    GAME_PATHS.defines,
    `${GAME_PATHS.staticModifiers}/00_static_modifiers.txt`,
  ])
  const { slots, lawSlots, designerSlots } = parseIdeaSlots(tagsText)
  // Scripted triggers (`PHI_SEA = yes`) are written out in the conditions, so they can be answered.
  const triggerFiles = (await files.listFiles(GAME_PATHS.scriptedTriggers)).filter((f) =>
    f.endsWith('.txt'),
  )
  const triggers: ScriptedTriggers = Object.assign(
    {},
    ...(await readAll(
      files,
      triggerFiles.map((f) => `${GAME_PATHS.scriptedTriggers}/${f}`),
    )).map(parseScriptedTriggers),
  )
  const lawTexts = await readAll(files, LAW_FILES)
  const designerTexts = await readAll(files, [
    ...(country.ideasFile ? [country.ideasFile] : []),
    GENERIC_IDEAS,
  ])

  const seen = new Set<string>()
  const all = [
    ...lawTexts.flatMap((text) => parseLaws(text, lawSlots, triggers)),
    ...designerTexts.flatMap((text) => parseDesigners(text, designerSlots, triggers)),
    ...parseAdvisors(charactersText, triggers),
  ].filter((option) => {
    const key = `${option.kind}:${option.id}`
    if (seen.has(key)) return false
    seen.add(key)
    // With Arms Against Tyranny the equipment designers are military industrial organisations,
    // which are not bought with political power (and not planned yet).
    if (ownedDlc[AAT] && option.kind === 'designer' && MIO_SLOTS.has(option.slot)) return false
    return isAllowed(option, tag, ownedDlc)
  })
  // A generic designer steps aside when the country has one of its own for the slot.
  // A generic option steps aside when the country has one of its own with the trait it asks about
  // (`generic_industrial_concern` for ROMLOC, but not `generic_electronics_concern`).
  const own = new Set(
    all.flatMap((o) =>
      o.fallback === undefined ? (o.ideaTraits ?? []).map((t) => `${o.slot}:${t}`) : [],
    ),
  )
  const specific = new Set(all.filter((o) => o.fallback === undefined).map((o) => o.slot))
  const stepsAside = (o: RawOption) =>
    o.fallback !== undefined &&
    (o.fallback === '' ? specific.has(o.slot) : own.has(`${o.slot}:${o.fallback}`))
  const options = all
    .filter((o) => !stepsAside(o))
    .map((o) => ({
      ...o,
      ...(o.kind === 'advisor' && { recruited: recruited.includes(o.character!) }),
    }))

  // An advisor's traits and their stats, listed beneath a `leader_trait` line each.
  const traitIds = new Set(options.flatMap((o) => o.traits ?? []))
  const traits = await readDefinitions(
    files,
    GAME_PATHS.leaderTraits,
    traitIds,
    `${GAME_PATHS.leaderTraits}/00_traits.txt`,
    parseLeaderTraits,
  )
  return {
    options: options.map((o) =>
      o.traits
        ? {
            ...o,
            modifiers: o.traits.flatMap((id): EffectLine[] => [
              { depth: 0, key: 'leader_trait', value: id },
              ...(traits[id] ?? []).map((l) => ({ ...l, depth: 1 })),
            ]),
          }
        : o,
    ),
    slots,
    lawSlots,
    defines: parsePoliticsDefines(definesText, staticModifiersText),
  }
}

/** The `available` block as the header of an `if`, so folding the condition writes it in English. */
export const availabilityLines = (option: RawOption): EffectLine[] =>
  option.availableLines?.length
    ? [
        { depth: 0, key: 'if' },
        { depth: 1, key: 'limit' },
        ...option.availableLines.map((l) => ({ ...l, depth: l.depth + 2 })),
      ]
    : []

/** An option as the app keeps it: named, with its lines named and its `available` block in English. */
export const finishOption = (
  raw: RawOption,
  name: string,
  named: (lines: EffectLine[]) => EffectLine[],
): PoliticalOption => ({
  id: raw.id,
  name,
  kind: raw.kind,
  slot: raw.slot,
  group: raw.group,
  cost: raw.cost,
  ...(raw.ledger && { ledger: raw.ledger }),
  ...(raw.default && { default: true }),
  ...(raw.level !== undefined && { level: raw.level }),
  ...(raw.character && { character: raw.character }),
  ...(raw.recruited !== undefined && { recruited: raw.recruited }),
  ...(raw.available && { available: raw.available }),
  availableText: named(availabilityLines(raw))[0]?.condition,
  modifiers: named(raw.modifiers),
  ...(raw.researchBonus && { researchBonus: raw.researchBonus }),
})

/** Sets the slot and research bonus on the lines that add one of the options' ideas. */
export const annotateIdeaLines = (
  lines: EffectLine[],
  options: Map<string, PoliticalOption>,
): EffectLine[] => {
  const annotated = [...lines]
  for (const i of ideaLineIndexes(lines)) {
    const option = options.get(lines[i].value ?? '')
    if (!option || option.kind === 'advisor') continue
    annotated[i] = {
      ...lines[i],
      slot: option.slot,
      ...(option.researchBonus && { researchBonus: option.researchBonus }),
    }
  }
  return annotated
}
