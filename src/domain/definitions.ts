/**
 * Finding definitions in the game's `common/*` directories. Each of these directories holds many
 * files, any of which may define the id we are after, so the search is kept cheap: read the file
 * the id most likely lives in first, and only parse the others if they even mention what is
 * still missing.
 */
import { GAME_PATHS, type GameFiles } from './gameFiles'
import { getBlock, getString, parseScript } from './paradoxScript'

/**
 * Finds definitions for the given ids. The preferred file is read first; the other files in the
 * directory are only read (and only parsed if they mention a missing id) for what is left.
 */
export const readDefinitions = async <T>(
  files: GameFiles,
  dir: string,
  ids: Set<string>,
  preferredFile: string | undefined,
  parse: (text: string, wanted: Set<string>) => Record<string, T>,
  /** Orders the other files in the directory; lower ranks are read first. */
  rank: (file: string) => number = () => 0,
): Promise<Record<string, T>> => {
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

/** What a country's history file says about how it starts the game. */
export interface CountryHistory {
  /** Ruling party at the start of the game, by country tag. */
  parties: Record<string, string>
  /** Faction template the country starts out leading, by country tag. */
  factionTemplates: Record<string, string>
}

/**
 * Reads two things from `history/countries/<TAG> - <name>.txt` for each tag (tags without a file
 * are left out):
 * - the ruling party at the start of the game, which names the country (`SOV_communism` is
 *   "Soviet Union", while plain `SOV` is "Russia"), from `set_politics = { ruling_party = X }`;
 * - the faction template it starts out leading, from a top-level `create_faction_from_template`.
 */
export const readCountryHistory = async (
  files: GameFiles,
  tags: Set<string>,
): Promise<CountryHistory> => {
  const parties: Record<string, string> = {}
  const factionTemplates: Record<string, string> = {}
  if (tags.size === 0) return { parties, factionTemplates }
  const historyFiles = await files.listFiles(GAME_PATHS.history)
  for (const tag of tags) {
    const file = historyFiles.find((f) => f.startsWith(`${tag} -`))
    const text = file ? await files.readText(`${GAME_PATHS.history}/${file}`) : null
    if (!text) continue
    const script = parseScript(text)
    const party = getString(getBlock(script, 'set_politics') ?? [], 'ruling_party')
    const template = getString(script, 'create_faction_from_template')
    if (party) parties[tag] = party
    if (template) factionTemplates[tag] = template
  }
  return { parties, factionTemplates }
}
