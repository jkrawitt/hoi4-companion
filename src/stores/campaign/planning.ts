import { computed, watch, type Ref } from 'vue'
import { ownedDlc } from '@/data/dlc'
import { statOverrides } from '@/data/statOverrides'
import { countryStateAt } from '@/domain/campaign/countryState'
import { previewFocusEffects } from '@/domain/campaign/preview'
import { planCampaign } from '@/domain/campaign/plan'
import { researchStatusAt, techModifierTotals } from '@/domain/campaign/research'
import { adjustmentSteps, tradeOverTime } from '@/domain/adjustments'
import { industryAt } from '@/domain/campaign/industry'
import { planConstruction } from '@/domain/campaign/construction'
import { tradeAt } from '@/domain/production'
import { addDays, schedulePlan } from '@/domain/plan/focusPlan'
import { DAYS_PER_YEAR } from '@/domain/calendar'
import { buildTimeline } from '@/domain/campaign/timeline'
import { completionDay, parseDate } from './dates'
import type { GameData } from './gameData'
import type { Queues } from './queues'

/** How long after the focus plan ends research is followed, for techs that take years. */
const RESEARCH_YEARS = 25
/** How long after the focus plan ends construction is followed. */
const CONSTRUCTION_YEARS = 10

export interface CampaignSettings {
  countryTag: Ref<string>
  startDate: Ref<string>
  speedBonusPercent: Ref<number>
  /** The date the overview shows the country at. */
  viewDate: Ref<string>
}

/** Everything worked out from the settings, the imported data and the queues. */
export const createPlanning = (settings: CampaignSettings, data: GameData, queues: Queues) => {
  const { countryTag, startDate, speedBonusPercent, viewDate } = settings
  const { focuses, start, leaders, laws, research, mios, production, politics, techs } = data
  const { plan, researchPlan, constructionPlan, politicsPlan, adjustments } = queues

  const schedule = computed(() =>
    schedulePlan(plan.value, focuses.value, {
      startDate: parseDate(startDate.value),
      speedBonus: speedBonusPercent.value / 100,
    }),
  )

  /** The options both the planning and the overview take to work out the country's state. */
  const stateOptions = computed(() => ({
    tag: countryTag.value,
    start: start.value,
    leaders: leaders.value,
    laws: laws.value,
    startDate: parseDate(startDate.value),
    ownedDlc,
    ownedStates: production.value?.states.map((st) => st.id),
    // Slot sizes and the party stability define: every view of the country needs them, so they
    // are here rather than passed by each caller.
    politics: politics.value,
    adjustments: adjustmentSteps(adjustments.value, statOverrides),
  }))

  /** Where the planners' horizons count from: the end of the focus plan, or the start. */
  const planBase = computed(() => {
    const begin = parseDate(startDate.value)
    return schedule.value.finish > begin ? schedule.value.finish : begin
  })

  /**
   * Research and political power are worked out together with the focus plan: it asks about
   * technologies, and what is bought speeds research up.
   */
  const planned = computed(() =>
    planCampaign({
      focusSchedule: schedule.value,
      options: stateOptions.value,
      researchQueue: researchPlan.value,
      researchData: research.value,
      mios: mios.value,
      politicsQueue: politicsPlan.value,
      politicsData: politics.value,
      startDate: parseDate(startDate.value),
      until: addDays(planBase.value, RESEARCH_YEARS * DAYS_PER_YEAR),
    }),
  )
  const researchSchedule = computed(() => planned.value.schedule)
  const politicsSchedule = computed(() => planned.value.politics)

  /** The country on a date, with the research, purchases and adjustments of the campaign. */
  const stateOn = (date: Date) =>
    countryStateAt(schedule.value, date, {
      ...stateOptions.value,
      hasTech: planned.value.hasTech,
      extraSteps: planned.value.politics.steps,
    })

  /** The later of `date` and the last thing the player entered from the game. */
  const lastChange = (date: Date) =>
    (stateOptions.value.adjustments ?? []).reduce((l, s) => (s.end > l ? s.end : l), date)
  /** The later of `date` and the last political power purchase. */
  const lastPurchase = (date: Date) =>
    politicsSchedule.value.items.reduce((l, p) => (p.date > l ? p.date : l), date)

  /**
   * The country once the focus plan, the purchases and the adjustments are all done: every build of
   * the plan, and every change to consumer goods and build speed, for the construction.
   */
  const finalState = computed(() => stateOn(lastPurchase(lastChange(schedule.value.finish))))
  const plannedConstruction = computed(() =>
    production.value
      ? planConstruction({
          production: production.value,
          finalState: finalState.value,
          research: researchSchedule.value,
          techs: research.value?.techs ?? [],
          queue: constructionPlan.value,
          adjustments: adjustments.value,
          startDate: parseDate(startDate.value),
          until: addDays(planBase.value, CONSTRUCTION_YEARS * DAYS_PER_YEAR),
        })
      : undefined,
  )
  const constructionSchedule = computed(() => plannedConstruction.value?.schedule)

  /** The end of the whole plan: the last focus, research, construction or purchase. */
  const planEnd = computed(() => {
    const lastResearch = researchSchedule.value.items.reduce(
      (latest, item) => (item.slot >= 0 && item.end > latest ? item.end : latest),
      schedule.value.finish,
    )
    const latest = politicsSchedule.value.items.reduce(
      (latest, item) => (item.date > latest ? item.date : latest),
      lastResearch,
    )
    const built = constructionSchedule.value?.finish
    // An adjustment entered after the rest of the plan still needs the slider to reach it.
    return lastChange(built && built > latest ? built : latest)
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

  const state = computed(() => stateOn(parseDate(viewDate.value)))
  /** The stability the plan has on a date, `YYYY-MM-DD`, or undefined before the start is known. */
  const stabilityOn = (date: string): number | undefined => stateOn(parseDate(date)).stability

  /** What trade does to the civs, from the imports and the civs received, as change points. */
  const trade = computed(() =>
    production.value
      ? tradeOverTime(
          adjustments.value,
          production.value.resourceCost ?? {},
          production.value.defines.energyResource,
        )
      : [],
  )

  /** The factories, slots and consumer goods on the viewed date. */
  const industry = computed(() =>
    production.value
      ? industryAt(
          production.value,
          state.value,
          researchTotals.value,
          constructionSchedule.value?.built,
          tradeAt(trade.value, parseDate(viewDate.value)),
        )
      : undefined,
  )

  /** Each planned focus's reward with the branches that apply or not marked. */
  const plannedFocusEffects = computed(() => finalState.value.focusEffects)

  /**
   * What a focus not in the plan would do if taken next (see `previewFocusEffects`), worked out on
   * first ask and kept until the plan, the data or the campaign changes.
   */
  const previewFocus = computed(() => {
    const input = {
      plan: plan.value,
      focuses: focuses.value,
      scheduleOptions: {
        startDate: parseDate(startDate.value),
        speedBonus: speedBonusPercent.value / 100,
      },
      stateOptions: {
        ...stateOptions.value,
        hasTech: planned.value.hasTech,
        extraSteps: planned.value.politics.steps,
      },
    }
    const cache = new Map<string, ReturnType<typeof previewFocusEffects>>()
    return (id: string) => {
      if (!cache.has(id)) cache.set(id, previewFocusEffects(id, input))
      return cache.get(id)
    }
  })

  const timeline = computed(() =>
    buildTimeline({
      focusSchedule: schedule.value,
      research: researchSchedule.value,
      techs: techs.value,
      mios: mios.value,
      construction: constructionSchedule.value,
      production: production.value,
      politics: politicsSchedule.value,
      options: politics.value?.options ?? [],
      adjustments: adjustments.value,
      resourceCost: production.value?.resourceCost,
    }),
  )

  return {
    schedule,
    stateOptions,
    planBase,
    planned,
    researchSchedule,
    politicsSchedule,
    stateOn,
    lastChange,
    lastPurchase,
    finalState,
    plannedFocusEffects,
    previewFocus,
    plannedConstruction,
    constructionSchedule,
    planEnd,
    researchEnvironment,
    researchTotals,
    researchStatus,
    state,
    stabilityOn,
    trade,
    industry,
    timeline,
  }
}
