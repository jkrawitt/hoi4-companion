/**
 * Reading the production side of a game install: the states a country owns at the start
 * (`history/states`), their categories (`common/state_category`), which buildings share a state's
 * slots (`common/buildings`) and the consumer goods defines.
 */
import { GAME_PATHS, type GameFiles } from '../gameFiles'
import type { ProductionData, ProductionDefines, StateData } from '../production'
import { getBlock, getString, parseScript, type ScriptBlock } from './paradoxScript'

const DEFAULT_DEFINES: ProductionDefines = { minConsumerFactories: 1, minConsumerPercent: 0.1 }

const numbersOf = (block: ScriptBlock | undefined): Record<string, number> =>
  Object.fromEntries(
    (block ?? []).flatMap((e) =>
      e.key !== null && typeof e.value === 'string' && Number.isFinite(Number(e.value))
        ? [[e.key, Number(e.value)]]
        : [],
    ),
  )

/**
 * Reads one `history/states` file. The owner is the one at the top level of `history` (dated
 * blocks and conditions are ignored), and `buildings` keeps only the state-level buildings, not
 * the `<province id> = { naval_base = 1 }` blocks.
 */
export const parseStateHistory = (text: string): (StateData & { owner?: string }) | undefined => {
  const state = getBlock(parseScript(text), 'state')
  if (!state) return undefined
  const history = getBlock(state, 'history') ?? []
  return {
    id: Number(getString(state, 'id')),
    name: getString(state, 'name') ?? '',
    category: getString(state, 'state_category') ?? '',
    buildings: numbersOf(getBlock(history, 'buildings')),
    resources: numbersOf(getBlock(state, 'resources')),
    manpower: Number(getString(state, 'manpower') ?? 0),
    owner: getString(history, 'owner'),
  }
}

/** `local_building_slots` of each category in a `common/state_category` file. */
export const parseStateCategories = (text: string): Record<string, number> =>
  Object.fromEntries(
    (getBlock(parseScript(text), 'state_categories') ?? []).flatMap((e) => {
      const slots = typeof e.value === 'object' ? getString(e.value, 'local_building_slots') : null
      return e.key !== null && slots != null && Number.isFinite(Number(slots))
        ? [[e.key, Number(slots)]]
        : []
    }),
  )

/** The buildings of a `common/buildings` file whose `level_cap` has `shares_slots = yes`. */
export const parseSharedSlotBuildings = (text: string): string[] => {
  const found: string[] = []
  const visit = (block: ScriptBlock) => {
    for (const e of block) {
      if (typeof e.value !== 'object' || e.key === null) continue
      if (getString(getBlock(e.value, 'level_cap') ?? [], 'shares_slots') === 'yes') {
        found.push(e.key)
      } else {
        visit(e.value)
      }
    }
  }
  visit(parseScript(text))
  return found
}

/** The consumer goods minimums from `NProduction`, by regex like the research defines. */
export const parseProductionDefines = (text: string): ProductionDefines => {
  const read = (name: string, fallback: number) => {
    const found = new RegExp(`${name}\\s*=\\s*(-?[\\d.]+)`).exec(text)
    return found && Number.isFinite(Number(found[1])) ? Number(found[1]) : fallback
  }
  return {
    minConsumerFactories: read(
      'MINIMUM_NUMBER_OF_FACTORIES_TAKEN_BY_CONSUMER_GOODS_VALUE',
      DEFAULT_DEFINES.minConsumerFactories,
    ),
    minConsumerPercent: read(
      'MINIMUM_NUMBER_OF_FACTORIES_TAKEN_BY_CONSUMER_GOODS_PERCENT',
      DEFAULT_DEFINES.minConsumerPercent,
    ),
  }
}

const readAll = async (files: GameFiles, dir: string): Promise<string[]> => {
  const texts = await Promise.all(
    (await files.listFiles(dir))
      .filter((f) => f.endsWith('.txt'))
      .map((f) => files.readText(`${dir}/${f}`)),
  )
  return texts.flatMap((t) => (t === null ? [] : [t]))
}

/** The states `tag` owns at the start of the game, with what decides their building slots. */
export const readProduction = async (files: GameFiles, tag: string): Promise<ProductionData> => {
  const ownerPattern = new RegExp(`owner\\s*=\\s*${tag}\\b`)
  const states = (await readAll(files, GAME_PATHS.states))
    // Cheap check before parsing the whole file, like `ideas.ts` does.
    .filter((text) => ownerPattern.test(text))
    .flatMap((text) => {
      const parsed = parseStateHistory(text)
      if (parsed?.owner !== tag) return []
      delete parsed.owner
      return [parsed]
    })
    .sort((a, b) => a.id - b.id)
  return {
    states,
    categorySlots: Object.assign(
      {},
      ...(await readAll(files, GAME_PATHS.stateCategories)).map(parseStateCategories),
    ),
    sharedSlotBuildings: (await readAll(files, GAME_PATHS.buildings)).flatMap(
      parseSharedSlotBuildings,
    ),
    defines: parseProductionDefines((await files.readText(GAME_PATHS.defines)) ?? ''),
  }
}
