/**
 * Reading technologies out of `common/technologies`, the folders they are shown in
 * (`common/technology_tags`) and the research numbers in the defines.
 *
 * A tech file is one `technologies = { ... }` block holding `@name = number` variables (used for
 * folder positions, e.g. `y = @1936`) and one block per tech. A tech lists the techs it leads to
 * (`path = { leads_to_tech = X }`), so the parents of a tech are found by turning those around.
 */
import type { ResearchData, ResearchDefines, TechFolder, Technology } from '../research'
import { GAME_PATHS, type GameFiles } from '../gameFiles'
import { statLines } from './statBlocks'
import {
  getAll,
  getBlock,
  getString,
  getStrings,
  parseScript,
  type ScriptBlock,
} from './paradoxScript'

/** A tech as written in the file, before parents are worked out and folders are filtered. */
export interface RawTechnology {
  id: string
  cost: number
  startYear: number
  folders: { id: string; x: number; y: number }[]
  categories: string[]
  /** The techs this one leads to. */
  leadsTo: string[]
  /** Techs that must all be researched first (`dependencies`). */
  dependencies: string[]
  exclusiveWith: string[]
  /** The equipment and units it unlocks, whose names a tech without a name of its own goes by. */
  enables: string[]
  /** A special project, or one only a focus can grant. */
  notResearchable: boolean
  modifiers: Technology['modifiers']
}

/**
 * Numbers in the tech block that are not stat changes: its cost and year, the experience that can
 * be spent on researching it (`xp_*`), and where it sits among its sub-technologies.
 */
const NOT_STATS = new Set([
  'research_cost',
  'start_year',
  'xp_boost_cost',
  'xp_research_bonus',
  'xp_unlock_cost',
  'sub_tech_index',
])

const DEFAULT_DEFINES: ResearchDefines = { baseCost: 110, aheadPenalty: 2, minSpeed: 0.1 }

/** The first `@name = value` entry of a block (the files define `@1936` more than once). */
const variablesIn = (block: ScriptBlock): Record<string, number> =>
  Object.fromEntries(
    block.flatMap((e) =>
      e.key?.startsWith('@') && typeof e.value === 'string' && Number.isFinite(Number(e.value))
        ? [[e.key, Number(e.value)]]
        : [],
    ),
  )

/** All techs of one file. `@variables` are resolved, using the last definition before the tech. */
export const parseTechnologyFile = (text: string): RawTechnology[] => {
  const top = getBlock(parseScript(text), 'technologies') ?? []
  const later = variablesIn(top)
  const vars: Record<string, number> = {}
  const result: RawTechnology[] = []

  const number = (value: string | undefined): number | undefined => {
    if (value === undefined) return undefined
    const n = value.startsWith('@') ? (vars[value] ?? later[value]) : Number(value)
    return Number.isFinite(n) ? n : undefined
  }

  for (const entry of top) {
    if (entry.key?.startsWith('@') && typeof entry.value === 'string') {
      if (Number.isFinite(Number(entry.value))) vars[entry.key] = Number(entry.value)
      continue
    }
    if (entry.key === null || typeof entry.value !== 'object') continue
    const tech = entry.value
    const allow = getBlock(tech, 'allow') ?? []
    result.push({
      id: entry.key,
      cost: number(getString(tech, 'research_cost')) ?? 1,
      startYear: number(getString(tech, 'start_year')) ?? 1936,
      folders: getAll(tech, 'folder').flatMap((f) => {
        const block = f.value as ScriptBlock
        const position = getBlock(block, 'position') ?? []
        const id = getString(block, 'name')
        const x = number(getString(position, 'x'))
        const y = number(getString(position, 'y'))
        return id !== undefined && x !== undefined && y !== undefined ? [{ id, x, y }] : []
      }),
      categories: (getBlock(tech, 'categories') ?? []).flatMap((c) =>
        c.key === null && typeof c.value === 'string' ? [c.value] : [],
      ),
      leadsTo: getAll(tech, 'path').flatMap((p) =>
        typeof p.value === 'object' ? getStrings(p.value, 'leads_to_tech') : [],
      ),
      dependencies: (getBlock(tech, 'dependencies') ?? []).flatMap((d) =>
        d.key !== null && typeof d.value === 'string' ? [d.key] : [],
      ),
      exclusiveWith: (getBlock(tech, 'XOR') ?? []).flatMap((x) =>
        x.key === null && typeof x.value === 'string' ? [x.value] : [],
      ),
      enables: [
        ...(getBlock(tech, 'enable_equipments') ?? []),
        ...(getBlock(tech, 'enable_subunits') ?? []),
      ].flatMap((e) => (e.key === null && typeof e.value === 'string' ? [e.value] : [])),
      notResearchable:
        getString(tech, 'is_special_project_tech') === 'yes' || getString(allow, 'always') === 'no',
      modifiers: statLines(tech, NOT_STATS),
    })
  }
  return result
}

/** Whether a folder's `available` block holds, for the DLCs the player owns. */
const holds = (block: ScriptBlock, ownedDlc: Record<string, boolean>): boolean =>
  block.every((entry) => {
    const key = entry.key?.toLowerCase()
    if (key === 'has_dlc') return typeof entry.value === 'string' && ownedDlc[entry.value] === true
    if (typeof entry.value !== 'object') return true
    if (key === 'not') return !holds(entry.value, ownedDlc)
    if (key === 'or') return entry.value.some((e) => holds([e], ownedDlc))
    return key === 'and' ? holds(entry.value, ownedDlc) : true
  })

/**
 * The folders the player sees, in the game's order. A folder whose `available` asks for a DLC
 * (`bba_air_techs_folder` for By Blood Alone) is only there when it is owned, and doctrine
 * folders are left out (doctrines are not researched in slots).
 */
export const parseTechFolders = (text: string, ownedDlc: Record<string, boolean>): string[] =>
  (getBlock(parseScript(text), 'technology_folders') ?? []).flatMap((entry) => {
    if (entry.key === null || typeof entry.value !== 'object') return []
    if (getString(entry.value, 'doctrine') === 'yes') return []
    const available = getBlock(entry.value, 'available')
    return !available || holds(available, ownedDlc) ? [entry.key] : []
  })

/**
 * One sub-tree of a folder, from the research screen's layout (`interface/countrytechtreeview.gui`):
 * a `gridboxtype` named `<root tech>_tree` inside the folder's window. Its position is in slots.
 */
export interface TechTreeBox {
  root: string
  x: number
  y: number
  /** `format = "LEFT"`: the tree runs sideways, so a tech's `y` (its year) is drawn as a column. */
  sideways: boolean
}

const numberOr0 = (value: string | undefined): number => {
  // Some boxes are placed in percent of the window (`x = 10%`); a lone tree can start at 0.
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * The sub-trees of each folder. A folder is drawn as several trees side by side, each placed by
 * its own grid box, and a tech's `position` is relative to the box of the tree it belongs to.
 */
export const parseTechTreeLayout = (
  text: string,
  folderIds: string[],
): Record<string, TechTreeBox[]> => {
  const result: Record<string, TechTreeBox[]> = {}
  const collect = (block: ScriptBlock, folder: string | undefined) => {
    for (const entry of block) {
      if (typeof entry.value !== 'object') continue
      const name = getString(entry.value, 'name')
      const key = entry.key?.toLowerCase()
      if (key === 'containerwindowtype' && name && folderIds.includes(name)) {
        collect(entry.value, name)
        continue
      }
      if (key === 'gridboxtype' && folder && name?.endsWith('_tree')) {
        const position = getBlock(entry.value, 'position') ?? []
        const slot = getBlock(entry.value, 'slotsize') ?? []
        const width = numberOr0(getString(slot, 'width')) || 70
        const height = numberOr0(getString(slot, 'height')) || 70
        ;(result[folder] ??= []).push({
          root: name.slice(0, -'_tree'.length),
          x: numberOr0(getString(position, 'x')) / width,
          y: numberOr0(getString(position, 'y')) / height,
          sideways: getString(entry.value, 'format')?.toUpperCase() === 'LEFT',
        })
        continue
      }
      collect(entry.value, folder)
    }
  }
  collect(parseScript(text), undefined)
  return result
}

/**
 * Puts each tech's folder position onto the folder's own grid: the tech belongs to the first tree
 * (in the layout's order) whose root leads to it within the folder, and sits at that tree's box
 * plus its own position. A tech no tree reaches keeps its position as written.
 */
export const placeInTrees = (
  raw: RawTechnology[],
  layout: Record<string, TechTreeBox[]>,
): RawTechnology[] => {
  const byId = new Map(raw.map((t) => [t.id, t]))
  const treeOf = new Map<string, TechTreeBox>()
  for (const [folder, boxes] of Object.entries(layout)) {
    const inFolder = (id: string) => byId.get(id)?.folders.some((f) => f.id === folder) === true
    for (const box of boxes) {
      const key = (id: string) => `${folder}/${id}`
      if (!inFolder(box.root) || treeOf.has(key(box.root))) continue
      treeOf.set(key(box.root), box)
      const queue = [box.root]
      while (queue.length > 0) {
        for (const child of byId.get(queue.shift()!)!.leadsTo) {
          if (inFolder(child) && !treeOf.has(key(child))) {
            treeOf.set(key(child), box)
            queue.push(child)
          }
        }
      }
    }
  }
  return raw.map((tech) => ({
    ...tech,
    folders: tech.folders.map((place) => {
      const box = treeOf.get(`${place.id}/${tech.id}`)
      if (!box) return place
      const [column, row] = box.sideways ? [place.y, place.x] : [place.x, place.y]
      return { id: place.id, x: box.x + column, y: box.y + row }
    }),
  }))
}

/** `NTechnology` of the defines; whatever is missing keeps the game's usual value. */
export const parseResearchDefines = (text: string): ResearchDefines => {
  const section = /NTechnology\s*=\s*\{([\s\S]*?)\n\s*\}/.exec(text)?.[1] ?? ''
  const read = (name: string, fallback: number) => {
    const found = new RegExp(`${name}\\s*=\\s*(-?[\\d.]+)`).exec(section)
    return found && Number.isFinite(Number(found[1])) ? Number(found[1]) : fallback
  }
  return {
    baseCost: read('BASE_TECH_COST', DEFAULT_DEFINES.baseCost),
    aheadPenalty: read('BASE_YEAR_AHEAD_PENALTY_FACTOR', DEFAULT_DEFINES.aheadPenalty),
    minSpeed: read('MIN_RESEARCH_SPEED', DEFAULT_DEFINES.minSpeed),
  }
}

/**
 * Turns the raw techs into `Technology`s. A tech leading to another is that one's parent; all the
 * parents together are one OR group, since researching any of them opens the tech (the game
 * tree is full of techs with two parents that are also each other's children). Techs not in an
 * available folder are kept, so prerequisites and `has_tech` can still name them, but cannot
 * be researched.
 */
export const buildTechnologies = (raw: RawTechnology[], folderIds: string[]): Technology[] => {
  const parents = new Map<string, string[]>()
  for (const tech of raw) {
    for (const child of tech.leadsTo) parents.set(child, [...(parents.get(child) ?? []), tech.id])
  }
  return raw.map((tech) => {
    const folders = tech.folders.filter((f) => folderIds.includes(f.id))
    const own = parents.get(tech.id) ?? []
    return {
      id: tech.id,
      name: tech.id,
      cost: tech.cost,
      startYear: tech.startYear,
      folders,
      categories: tech.categories,
      prerequisites: [...(own.length > 0 ? [own] : []), ...tech.dependencies.map((d) => [d])],
      exclusiveWith: tech.exclusiveWith,
      researchable: !tech.notResearchable && folders.length > 0,
      modifiers: tech.modifiers,
    }
  })
}

/** What `readTechnologies` finds: the data, and the localisation keys to try for unnamed techs. */
export interface ReadResearch {
  data: ResearchData
  /** Names to fall back on for a tech that has none, by tech id. */
  fallbackNames: Record<string, string[]>
}

/** Reads the research data from a game folder; names are the ids until the importer names them. */
export const readTechnologies = async (
  files: GameFiles,
  ownedDlc: Record<string, boolean>,
): Promise<ReadResearch> => {
  const tags = (await files.readText(`${GAME_PATHS.technologyTags}/00_technology.txt`)) ?? ''
  const folderIds = parseTechFolders(tags, ownedDlc)
  const texts = await Promise.all(
    (await files.listFiles(GAME_PATHS.technologies))
      .filter((file) => file.endsWith('.txt'))
      .sort()
      .map((file) => files.readText(`${GAME_PATHS.technologies}/${file}`)),
  )
  const layout = parseTechTreeLayout(
    (await files.readText(GAME_PATHS.techTreeLayout)) ?? '',
    folderIds,
  )
  const raw = placeInTrees(
    texts.flatMap((text) => (text ? parseTechnologyFile(text) : [])),
    layout,
  )
  const folders: TechFolder[] = folderIds.map((id) => ({
    id,
    name: id,
    ...(layout[id]?.some((box) => box.sideways) ? { sideways: true } : {}),
  }))
  return {
    data: {
      techs: buildTechnologies(raw, folderIds),
      folders,
      defines: parseResearchDefines((await files.readText(GAME_PATHS.defines)) ?? ''),
    },
    fallbackNames: Object.fromEntries(raw.map((t) => [t.id, t.enables])),
  }
}
