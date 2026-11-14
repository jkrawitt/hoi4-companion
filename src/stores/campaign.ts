/**
 * The one campaign the app is planning: country, imported focuses, focus plan and dates. It is a
 * module-level singleton, so every page shares it and switching pages loses nothing. The plan and
 * settings are saved to localStorage; the imported focuses live in the IndexedDB cache.
 */
import { computed, ref, shallowRef, watch } from 'vue'
import { ownedDlc } from '@/data/dlc'
import { statOverrides } from '@/data/statOverrides'
import { countries } from '@/data/countries'
import type { EffectLine, Focus, ImportedCountry, LeaderData } from '@/domain/focus'
import { countryStateAt } from '@/domain/campaign/countryState'
import { planResearch, researchStatusAt, techModifierTotals } from '@/domain/campaign/research'
import { industryAt } from '@/domain/campaign/industry'
import { planConstruction } from '@/domain/campaign/construction'
import {
  isValidConstructionPlan,
  levelsLeft,
  type ConstructionItem,
  type ProductionData,
} from '@/domain/production'
import type { BonusRef, ResearchData, ResearchItem } from '@/domain/research'
import { addDays } from '@/domain/plan/focusPlan'
import { fromGameDay, gameDay } from '@/domain/calendar'
import {
  isValidResearchPlan,
  pathToTech,
  removeWithDependents as removeTechWithDependents,
} from '@/domain/plan/researchSelection'
import { schedulePlan } from '@/domain/plan/focusPlan'
import { isValidPlan, pathTo, removeWithDependents } from '@/domain/plan/focusSelection'
import { GameFolderError, importCountryFocuses, type GameFiles } from '@/domain/gameImport'
import { loadCachedCountry, saveCachedCountry } from '@/import/cache'

const STORAGE_KEY = 'hoi4-companion:campaign'
const STORAGE_VERSION = 1

interface SavedCampaign {
  version: number
  countryTag: string
  startDate: string
  speedBonusPercent: number
  plan: string[]
  researchPlan?: ResearchItem[]
  constructionPlan?: ConstructionItem[]
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

/** How long after the focus plan ends research is followed, for techs that take years. */
const RESEARCH_YEARS = 25
/** How long after the focus plan ends construction is followed. */
const CONSTRUCTION_YEARS = 10
const parseDate = (text: string) => new Date(`${text}T00:00:00Z`)
const formatDate = (d: Date) => d.toISOString().slice(0, 10)

const createCampaign = () => {
  const saved = loadSaved()

  const countryTag = ref(
    countries.some((c) => c.tag === saved.countryTag) ? saved.countryTag! : countries[0].tag,
  )
  const country = computed(() => countries.find((c) => c.tag === countryTag.value)!)

  const focuses = ref<Record<string, Focus>>({})
  /** What the country starts the game with, as effect lines. */
  const start = ref<EffectLine[]>([])
  /** Who the game could pick as leader when the plan retires one or changes the party. */
  const leaders = ref<LeaderData | undefined>()
  /** The law category of every law idea. */
  const laws = shallowRef<Record<string, string>>({})
  /** The technologies, folders and research numbers from the game. */
  const research = shallowRef<ResearchData | undefined>()
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
  const hasData = computed(() => Object.keys(focuses.value).length > 0)
  const status = ref('')
  const error = ref('')
  const importing = ref(false)

  const plan = ref<string[]>(Array.isArray(saved.plan) ? saved.plan : [])
  /** The research queue: one list the research slots take the next startable tech from. */
  const researchPlan = ref<ResearchItem[]>(
    Array.isArray(saved.researchPlan) ? saved.researchPlan : [],
  )
  /** The construction queue: buildings the spare civilian factories build, in order. */
  const constructionPlan = ref<ConstructionItem[]>(
    Array.isArray(saved.constructionPlan) ? saved.constructionPlan : [],
  )
  const startDate = ref(saved.startDate ?? '1936-01-01')
  const speedBonusPercent = ref(saved.speedBonusPercent ?? 0)
  /** The date the overview shows the country at. */
  const viewDate = ref(saved.viewDate ?? startDate.value)

  /** Keeps the saved plan when the focuses still support it, and drops it when they do not. */
  const setCountry = ({
    focuses: list,
    start: startLines,
    leaders: leaderData,
    laws: lawData,
    research: researchData,
    production: productionData,
  }: ImportedCountry) => {
    start.value = startLines
    leaders.value = leaderData
    laws.value = lawData ?? {}
    research.value = researchData
    production.value = productionData
    focuses.value = Object.fromEntries(list.map((f) => [f.id, f]))
    const known = plan.value.filter((id) => id in focuses.value)
    plan.value = isValidPlan(known, focuses.value) ? known : []
    researchPlan.value = isValidResearchPlan(researchPlan.value, techs.value, startTechs.value)
      ? researchPlan.value
      : []
    constructionPlan.value = isValidConstructionPlan(constructionPlan.value, productionData)
      ? constructionPlan.value
      : []
  }

  const loadCached = async (tag: string) => {
    const cached = await loadCachedCountry(tag)
    if (cached && tag === countryTag.value) setCountry(cached)
  }
  void loadCached(countryTag.value)

  // Another country is another campaign: start its plan from scratch.
  watch(countryTag, async (tag) => {
    focuses.value = {}
    start.value = []
    leaders.value = undefined
    laws.value = {}
    research.value = undefined
    production.value = undefined
    plan.value = []
    researchPlan.value = []
    constructionPlan.value = []
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
      const imported = await importCountryFocuses(files, target, statOverrides, ownedDlc)
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

  /** The options both the planning and the overview take to work out the country's state. */
  const stateOptions = computed(() => ({
    tag: countryTag.value,
    start: start.value,
    leaders: leaders.value,
    laws: laws.value,
    startDate: parseDate(startDate.value),
  }))

  /** Research is worked out together with the focus plan, which asks about technologies. */
  const planned = computed(() =>
    planResearch({
      focusSchedule: schedule.value,
      options: stateOptions.value,
      queue: researchPlan.value,
      data: research.value,
      startDate: parseDate(startDate.value),
      until: addDays(
        schedule.value.finish > parseDate(startDate.value)
          ? schedule.value.finish
          : parseDate(startDate.value),
        RESEARCH_YEARS * 366,
      ),
    }),
  )
  const researchSchedule = computed(() => planned.value.schedule)

  /** The country when the focus plan is done: every build of the plan, for the construction. */
  const finalState = computed(() =>
    countryStateAt(schedule.value, schedule.value.finish, {
      ...stateOptions.value,
      hasTech: planned.value.hasTech,
    }),
  )
  const plannedConstruction = computed(() =>
    production.value
      ? planConstruction({
          production: production.value,
          finalState: finalState.value,
          research: researchSchedule.value,
          techs: research.value?.techs ?? [],
          queue: constructionPlan.value,
          startDate: parseDate(startDate.value),
          until: addDays(
            schedule.value.finish > parseDate(startDate.value)
              ? schedule.value.finish
              : parseDate(startDate.value),
            CONSTRUCTION_YEARS * 366,
          ),
        })
      : undefined,
  )
  const constructionSchedule = computed(() => plannedConstruction.value?.schedule)

  /** The end of the whole plan: the last focus, research or construction, whichever is latest. */
  const planEnd = computed(() => {
    const latest = researchSchedule.value.items.reduce(
      (latest, item) => (item.slot >= 0 && item.end > latest ? item.end : latest),
      schedule.value.finish,
    )
    const built = constructionSchedule.value?.finish
    return built && built > latest ? built : latest
  })

  // A view that sits at the end of the plan stays there as the plan changes, so new focuses and
  // techs show up; one scrubbed to an earlier date is left where the user put it.
  watch(
    () => completionDay(planEnd.value),
    (end, previousEnd) => {
      if (viewDate.value >= previousEnd) viewDate.value = end
    },
  )
  const researchEnvironment = computed(() => planned.value.environment)
  /** The summed stat changes of the technologies the country has on the viewed date. */
  const researchTotals = computed(() =>
    techModifierTotals(
      research.value?.techs ?? [],
      researchSchedule.value.researchedBy(parseDate(viewDate.value)),
    ),
  )
  const researchStatus = computed(() =>
    researchStatusAt(planned.value.schedule, planned.value.environment, parseDate(viewDate.value)),
  )

  const blockedTechIds = computed(
    () =>
      new Set(
        Object.values(techs.value)
          .filter(
            (t) =>
              t.researchable &&
              !startTechs.value.has(t.id) &&
              !researchPlan.value.some((item) => item.techId === t.id) &&
              pathToTech(t.id, researchPlan.value, techs.value, startTechs.value) === null,
          )
          .map((t) => t.id),
      ),
  )

  // Selecting a tech queues its missing prerequisites first; deselecting also drops its dependents.
  const toggleTech = (id: string) => {
    if (researchPlan.value.some((item) => item.techId === id)) {
      researchPlan.value = removeTechWithDependents(
        id,
        researchPlan.value,
        techs.value,
        startTechs.value,
      )
      return
    }
    const path = pathToTech(id, researchPlan.value, techs.value, startTechs.value)
    if (path) researchPlan.value = [...researchPlan.value, ...path.map((techId) => ({ techId }))]
  }

  /** Moves a queued tech up (-1) or down (1), when the queue stays valid. */
  const moveTech = (index: number, by: -1 | 1) => {
    const queue = [...researchPlan.value]
    const target = index + by
    if (target < 0 || target >= queue.length) return
    ;[queue[index], queue[target]] = [queue[target], queue[index]]
    if (isValidResearchPlan(queue, techs.value, startTechs.value)) researchPlan.value = queue
  }

  const setTechBonus = (index: number, bonus: BonusRef | undefined) => {
    researchPlan.value = researchPlan.value.map((item, i) =>
      i === index ? { techId: item.techId, ...(bonus && { bonus }) } : item,
    )
  }

  const resetResearch = () => (researchPlan.value = [])

  const addConstruction = (item: ConstructionItem) => {
    if (
      production.value &&
      levelsLeft(production.value, item.building, item.state, constructionPlan.value) >= item.levels
    ) {
      constructionPlan.value = [...constructionPlan.value, item]
    }
  }

  /** Moves a queued building up (-1) or down (1). */
  const moveConstruction = (index: number, by: -1 | 1) => {
    const queue = [...constructionPlan.value]
    const target = index + by
    if (target < 0 || target >= queue.length) return
    ;[queue[index], queue[target]] = [queue[target], queue[index]]
    constructionPlan.value = queue
  }

  const removeConstruction = (index: number) => {
    constructionPlan.value = constructionPlan.value.filter((_, i) => i !== index)
  }

  const resetConstruction = () => (constructionPlan.value = [])

  const state = computed(() =>
    countryStateAt(schedule.value, parseDate(viewDate.value), {
      ...stateOptions.value,
      hasTech: planned.value.hasTech,
    }),
  )

  /** The factories, slots and consumer goods on the viewed date. */
  const industry = computed(() =>
    production.value
      ? industryAt(
          production.value,
          state.value,
          researchTotals.value,
          constructionSchedule.value?.built,
        )
      : undefined,
  )

  watch(
    [countryTag, plan, researchPlan, constructionPlan, startDate, speedBonusPercent, viewDate],
    () =>
      save({
        version: STORAGE_VERSION,
        countryTag: countryTag.value,
        startDate: startDate.value,
        speedBonusPercent: speedBonusPercent.value,
        plan: plan.value,
        researchPlan: researchPlan.value,
        constructionPlan: constructionPlan.value,
        viewDate: viewDate.value,
      }),
  )

  return {
    countryTag,
    country,
    focuses,
    hasData,
    research,
    production,
    industry,
    startTechs,
    status,
    error,
    importing,
    plan,
    startDate,
    speedBonusPercent,
    viewDate,
    schedule,
    planEnd,
    blockedIds,
    state,
    researchPlan,
    researchSchedule,
    researchEnvironment,
    researchStatus,
    researchTotals,
    constructionPlan,
    constructionSchedule,
    addConstruction,
    moveConstruction,
    removeConstruction,
    resetConstruction,
    blockedTechIds,
    toggleTech,
    moveTech,
    setTechBonus,
    resetResearch,
    runImport,
    toggle,
    reset,
  }
}

let campaign: ReturnType<typeof createCampaign> | undefined

export const useCampaign = () => (campaign ??= createCampaign())

/** The first whole day on which a focus ending at `end` counts as complete. */
const completionDay = (end: Date): string => formatDate(fromGameDay(Math.ceil(gameDay(end) - 1e-9)))

export { completionDay, formatDate, parseDate }
