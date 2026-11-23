import { computed, ref, shallowRef, type Ref } from 'vue'
import { ownedDlc } from '@/data/dlc'
import { statOverrides } from '@/data/statOverrides'
import { countries } from '@/data/countries'
import type { BalanceOfPower } from '@/domain/balanceOfPower'
import type { EffectLine, Focus, ImportedCountry, LeaderData } from '@/domain/focus'
import type { PoliticsData } from '@/domain/politics'
import type { ProductionData } from '@/domain/production'
import type { MioData, ResearchData } from '@/domain/research'
import { GameFolderError, importCountry, type GameFiles } from '@/domain/gameImport'
import { loadCachedCountry, saveCachedCountry } from '@/import/cache'

/**
 * What the game files gave for the selected country (focuses, start, research, production,
 * politics) and the import that fills it. `onLoaded` runs after new data is in place, so the
 * queues can be checked against it.
 */
export const createGameData = (
  countryTag: Ref<string>,
  onLoaded: (imported: ImportedCountry) => void,
) => {
  const country = computed(() => countries.find((c) => c.tag === countryTag.value)!)

  const focuses = ref<Record<string, Focus>>({})
  /** What the country starts the game with, as effect lines. */
  const start = ref<EffectLine[]>([])
  /** Who the game could pick as leader when the plan retires one or changes the party. */
  const leaders = ref<LeaderData | undefined>()
  /** The country's balance of power (Finland's public trust), when it has one. */
  const balanceOfPower = shallowRef<BalanceOfPower | undefined>()
  /** The law category of every law idea. */
  const laws = shallowRef<Record<string, string>>({})
  /** The technologies, folders and research numbers from the game. */
  const research = shallowRef<ResearchData | undefined>()
  /** The military industrial organisations that can be the design team of a research. */
  const mios = shallowRef<MioData[]>([])
  /** The states the country owns at the start and what decides their building slots. */
  const production = shallowRef<ProductionData | undefined>()
  const techs = computed(() =>
    Object.fromEntries((research.value?.techs ?? []).map((t) => [t.id, t])),
  )
  /** The technologies the country starts the game with, which need no research. */
  const startTechs = computed(
    () =>
      new Set(
        start.value.flatMap((l) => (l.research?.kind === 'unlock' ? l.research.targets : [])),
      ),
  )
  /** The laws, designers and advisors political power can buy. */
  const politics = shallowRef<PoliticsData | undefined>()
  const hasData = computed(() => Object.keys(focuses.value).length > 0)
  const status = ref('')
  const error = ref('')
  const importing = ref(false)

  const setCountry = (imported: ImportedCountry) => {
    start.value = imported.start
    leaders.value = imported.leaders
    balanceOfPower.value = imported.balanceOfPower
    laws.value = imported.laws ?? {}
    research.value = imported.research
    mios.value = imported.mios ?? []
    production.value = imported.production
    politics.value = imported.politics
    focuses.value = Object.fromEntries(imported.focuses.map((f) => [f.id, f]))
    onLoaded(imported)
  }

  const loadCached = async (tag: string) => {
    const cached = await loadCachedCountry(tag)
    if (cached && tag === countryTag.value) setCountry(cached)
  }

  /** Forgets the imported data, for another country. */
  const clear = () => {
    focuses.value = {}
    start.value = []
    leaders.value = undefined
    balanceOfPower.value = undefined
    laws.value = {}
    research.value = undefined
    mios.value = []
    production.value = undefined
    politics.value = undefined
    error.value = ''
    status.value = ''
  }

  const runImport = async (files: GameFiles) => {
    importing.value = true
    error.value = ''
    status.value = 'Reading game files…'
    const target = country.value
    try {
      const imported = await importCountry(files, target, statOverrides, ownedDlc)
      await saveCachedCountry(target.tag, imported)
      if (target.tag === countryTag.value) setCountry(imported)
      status.value = `Imported ${imported.focuses.length} focuses for ${target.name}.`
    } catch (e) {
      status.value = ''
      error.value = e instanceof GameFolderError ? e.message : `Import failed: ${String(e)}`
    } finally {
      importing.value = false
    }
  }

  return {
    country,
    focuses,
    start,
    leaders,
    balanceOfPower,
    laws,
    research,
    mios,
    production,
    techs,
    startTechs,
    politics,
    hasData,
    status,
    error,
    importing,
    loadCached,
    clear,
    runImport,
  }
}

export type GameData = ReturnType<typeof createGameData>
