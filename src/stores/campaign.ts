/**
 * The one campaign the app is planning: country, imported focuses, focus plan and dates. It is a
 * module-level singleton, so every page shares it and switching pages loses nothing. The plan and
 * settings are saved to localStorage; the imported focuses live in the IndexedDB cache.
 */
import { computed, ref, watch } from 'vue'
import { ownedDlc } from '@/data/dlc'
import { statOverrides } from '@/data/statOverrides'
import { countries } from '@/data/countries'
import type { Focus } from '@/domain/focus'
import { countryStateAt } from '@/domain/campaign/countryState'
import { schedulePlan } from '@/domain/plan/focusPlan'
import { isValidPlan, pathTo, removeWithDependents } from '@/domain/plan/focusSelection'
import { GameFolderError, importCountryFocuses, type GameFiles } from '@/domain/gameImport'
import { loadCachedFocuses, saveCachedFocuses } from '@/import/cache'

const STORAGE_KEY = 'hoi4-companion:campaign'
const STORAGE_VERSION = 1

interface SavedCampaign {
  version: number
  countryTag: string
  startDate: string
  speedBonusPercent: number
  plan: string[]
  viewDate: string
}

const loadSaved = (): Partial<SavedCampaign> => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as SavedCampaign | null
    return saved?.version === STORAGE_VERSION ? saved : {}
  } catch {
    return {}
  }
}

const save = (campaign: SavedCampaign) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(campaign))
  } catch {
    // Saving is best-effort (private mode, blocked storage).
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
const parseDate = (text: string) => new Date(`${text}T00:00:00Z`)
const formatDate = (d: Date) => d.toISOString().slice(0, 10)

const createCampaign = () => {
  const saved = loadSaved()

  const countryTag = ref(
    countries.some((c) => c.tag === saved.countryTag) ? saved.countryTag! : countries[0].tag,
  )
  const country = computed(() => countries.find((c) => c.tag === countryTag.value)!)

  const focuses = ref<Record<string, Focus>>({})
  const hasData = computed(() => Object.keys(focuses.value).length > 0)
  const status = ref('')
  const error = ref('')
  const importing = ref(false)

  const plan = ref<string[]>(Array.isArray(saved.plan) ? saved.plan : [])
  const startDate = ref(saved.startDate ?? '1936-01-01')
  const speedBonusPercent = ref(saved.speedBonusPercent ?? 0)
  /** The date the overview shows the country at. */
  const viewDate = ref(saved.viewDate ?? startDate.value)

  /** Keeps the saved plan when the focuses still support it, and drops it when they do not. */
  const setFocuses = (list: Focus[]) => {
    focuses.value = Object.fromEntries(list.map((f) => [f.id, f]))
    const known = plan.value.filter((id) => id in focuses.value)
    plan.value = isValidPlan(known, focuses.value) ? known : []
  }

  const loadCached = async (tag: string) => {
    const cached = await loadCachedFocuses(tag)
    if (cached && tag === countryTag.value) setFocuses(cached)
  }
  void loadCached(countryTag.value)

  // Another country is another campaign: start its plan from scratch.
  watch(countryTag, async (tag) => {
    focuses.value = {}
    plan.value = []
    error.value = ''
    status.value = ''
    await loadCached(tag)
  })

  const runImport = async (files: GameFiles) => {
    importing.value = true
    error.value = ''
    status.value = 'Reading game files…'
    const target = country.value
    try {
      const list = await importCountryFocuses(files, target, statOverrides, ownedDlc)
      await saveCachedFocuses(target.tag, list)
      if (target.tag === countryTag.value) setFocuses(list)
      status.value = `Imported ${list.length} focuses for ${target.name}.`
    } catch (e) {
      status.value = ''
      error.value = e instanceof GameFolderError ? e.message : `Import failed: ${String(e)}`
    } finally {
      importing.value = false
    }
  }

  const schedule = computed(() =>
    schedulePlan(plan.value, focuses.value, {
      startDate: parseDate(startDate.value),
      speedBonus: speedBonusPercent.value / 100,
    }),
  )

  const blockedIds = computed(
    () =>
      new Set(
        Object.keys(focuses.value).filter(
          (id) => !plan.value.includes(id) && pathTo(id, plan.value, focuses.value) === null,
        ),
      ),
  )

  // Selecting a focus queues its missing prerequisites first; deselecting also drops its dependents.
  const toggle = (id: string) => {
    if (plan.value.includes(id)) {
      plan.value = removeWithDependents(id, plan.value, focuses.value)
      return
    }
    const path = pathTo(id, plan.value, focuses.value)
    if (path) plan.value = [...plan.value, ...path]
  }

  const reset = () => (plan.value = [])

  const state = computed(() =>
    countryStateAt(schedule.value, parseDate(viewDate.value), { tag: countryTag.value }),
  )

  watch([countryTag, plan, startDate, speedBonusPercent, viewDate], () =>
    save({
      version: STORAGE_VERSION,
      countryTag: countryTag.value,
      startDate: startDate.value,
      speedBonusPercent: speedBonusPercent.value,
      plan: plan.value,
      viewDate: viewDate.value,
    }),
  )

  return {
    countryTag,
    country,
    focuses,
    hasData,
    status,
    error,
    importing,
    plan,
    startDate,
    speedBonusPercent,
    viewDate,
    schedule,
    blockedIds,
    state,
    runImport,
    toggle,
    reset,
  }
}

let campaign: ReturnType<typeof createCampaign> | undefined

export const useCampaign = () => (campaign ??= createCampaign())

/** The first whole day on which a focus ending at `end` counts as complete. */
const completionDay = (end: Date): string =>
  formatDate(new Date(Math.ceil(end.getTime() / MS_PER_DAY) * MS_PER_DAY))

export { completionDay, formatDate, parseDate }
