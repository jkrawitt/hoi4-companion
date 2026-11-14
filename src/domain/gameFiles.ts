/** Read-only view of a HoI4 installation folder. Paths use `/` and are relative to its root. */
export interface GameFiles {
  /** File contents, or null if the file does not exist. */
  readText(path: string): Promise<string | null>
  /** File names (not paths) directly inside a directory; empty if it does not exist. */
  listFiles(dir: string): Promise<string[]>
}

/** The chosen folder is not a HoI4 installation, or is missing what we need from it. */
export class GameFolderError extends Error {}

/**
 * Everything the importer reads, relative to the installation root. This is the single list of
 * what the app touches: the browser folder fallback derives from it which files it has to keep
 * (`NEEDED_PREFIXES` in `src/import/gameFolder.ts`), so adding a path here is enough to make it
 * readable in every browser.
 */
export const GAME_PATHS = {
  nationalFocus: 'common/national_focus',
  ideas: 'common/ideas',
  opinionModifiers: 'common/opinion_modifiers',
  /** Static modifiers, such as the ones `add_relation_modifier` attaches. */
  staticModifiers: 'common/modifiers',
  leaderTraits: 'common/country_leader',
  /** Characters (a country's file is named `<TAG>.txt`) and the ideology groups their roles use. */
  characters: 'common/characters',
  ideologies: 'common/ideologies',
  /** Technologies, the folders they are shown in, and the defines that set research costs. */
  technologies: 'common/technologies',
  technologyTags: 'common/technology_tags',
  defines: 'common/defines/00_defines.lua',
  /** The research screen, which places each folder's sub-trees (`<root tech>_tree` grid boxes). */
  techTreeLayout: 'interface/countrytechtreeview.gui',
  /** The states of the 1936 map, their categories (building slots) and the buildings sharing slots. */
  states: 'history/states',
  stateCategories: 'common/state_category',
  buildings: 'common/buildings',
  factionTemplates: 'common/factions/templates',
  events: 'events',
  history: 'history/countries',
  localisation: 'localisation/english',
  statDocs: 'documentation/modifiers_documentation.md',
} as const

/** Every path above as a prefix to match file paths against; directories keep a trailing `/`. */
export const READ_PATH_PREFIXES: string[] = Object.values(GAME_PATHS).map((path) =>
  /\.\w+$/.test(path) ? path : `${path}/`,
)
