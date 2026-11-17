/**
 * The one campaign the app is planning: country, imported focuses, focus plan and dates. It is a
 * module-level singleton, so every page shares it and switching pages loses nothing. The plan and
 * settings are saved to localStorage; the imported focuses live in the IndexedDB cache.
 *
 * The parts: `saved.ts` (localStorage), `gameData.ts` (what the game files gave), `queues.ts`
 * (the player's queues and their edits) and `planning.ts` (everything worked out from them).
 */
import { ref, watch } from 'vue'
import { countries } from '@/data/countries'
import { hasAdjustments } from '@/domain/adjustments'
import { completionDay, formatDate, parseDate } from './dates'
import { createGameData } from './gameData'
import { createPlanning } from './planning'
import { createQueues } from './queues'
import { STORAGE_VERSION, loadSaved, save } from './saved'

const createCampaign = () => {
  const saved = loadSaved()

  const countryTag = ref(
    countries.some((c) => c.tag === saved.countryTag) ? saved.countryTag! : countries[0].tag,
  )
  const startDate = ref(saved.startDate ?? '1936-01-01')
  const speedBonusPercent = ref(saved.speedBonusPercent ?? 0)
  /** The date the overview shows the country at. */
  const viewDate = ref(saved.viewDate ?? startDate.value)

  // The data tells the queues when new data arrives; the queues need the data, so they are
  // reached through a constant that is set just after (the callback runs later).
  const data = createGameData(countryTag, (imported) => queues.keepValid(imported))
  const queues = createQueues(saved, data)
  const planning = createPlanning(
    { countryTag, startDate, speedBonusPercent, viewDate },
    data,
    queues,
  )
  void data.loadCached(countryTag.value)

  // Another country is another campaign: start its plan from scratch.
  watch(countryTag, async (tag) => {
    data.clear()
    queues.clear()
    await data.loadCached(tag)
  })

  watch(
    [
      countryTag,
      queues.plan,
      queues.researchPlan,
      queues.constructionPlan,
      queues.politicsPlan,
      queues.checkedOff,
      queues.adjustments,
      startDate,
      speedBonusPercent,
      viewDate,
    ],
    () =>
      save({
        version: STORAGE_VERSION,
        countryTag: countryTag.value,
        startDate: startDate.value,
        speedBonusPercent: speedBonusPercent.value,
        plan: queues.plan.value,
        researchPlan: queues.researchPlan.value,
        constructionPlan: queues.constructionPlan.value,
        politicsPlan: queues.politicsPlan.value,
        checkedOff: queues.checkedOff.value,
        adjustments: hasAdjustments(queues.adjustments.value)
          ? queues.adjustments.value
          : undefined,
        viewDate: viewDate.value,
      }),
  )

  return {
    countryTag,
    country: data.country,
    focuses: data.focuses,
    hasData: data.hasData,
    research: data.research,
    production: data.production,
    industry: planning.industry,
    politics: data.politics,
    startTechs: data.startTechs,
    status: data.status,
    error: data.error,
    importing: data.importing,
    plan: queues.plan,
    startDate,
    speedBonusPercent,
    viewDate,
    schedule: planning.schedule,
    planEnd: planning.planEnd,
    blockedIds: queues.blockedIds,
    state: planning.state,
    researchPlan: queues.researchPlan,
    researchSchedule: planning.researchSchedule,
    politicsPlan: queues.politicsPlan,
    politicsSchedule: planning.politicsSchedule,
    addPurchase: queues.addPurchase,
    movePurchase: queues.movePurchase,
    removePurchase: queues.removePurchase,
    setNotBefore: queues.setNotBefore,
    resetPolitics: queues.resetPolitics,
    researchEnvironment: planning.researchEnvironment,
    researchStatus: planning.researchStatus,
    researchTotals: planning.researchTotals,
    constructionPlan: queues.constructionPlan,
    constructionSchedule: planning.constructionSchedule,
    timeline: planning.timeline,
    checkedOff: queues.checkedOff,
    adjustments: queues.adjustments,
    addAdjustment: queues.addAdjustment,
    removeAdjustment: queues.removeAdjustment,
    stabilityOn: planning.stabilityOn,
    trade: planning.trade,
    toggleChecked: queues.toggleChecked,
    resetChecked: queues.resetChecked,
    addConstruction: queues.addConstruction,
    moveConstruction: queues.moveConstruction,
    removeConstruction: queues.removeConstruction,
    resetConstruction: queues.resetConstruction,
    blockedTechIds: queues.blockedTechIds,
    toggleTech: queues.toggleTech,
    moveTech: queues.moveTech,
    setTechBonus: queues.setTechBonus,
    resetResearch: queues.resetResearch,
    runImport: data.runImport,
    toggle: queues.toggle,
    reset: queues.reset,
  }
}

let campaign: ReturnType<typeof createCampaign> | undefined

export const useCampaign = () => (campaign ??= createCampaign())

export { completionDay, formatDate, parseDate }
