import { computed, watch, type Ref } from 'vue'
import { ownedDlc } from '@/data/dlc'
import { MAJORS_1936 } from '@/data/majors'
import { statOverrides } from '@/data/statOverrides'
import { countryStateAt } from '@/domain/campaign/countryState'
import { previewFocusEffects } from '@/domain/campaign/preview'
import { blockedByAvailability, unavailableInPlan } from '@/domain/campaign/availability'
import { removeWithDependents } from '@/domain/plan/focusSelection'
import { planCampaign } from '@/domain/campaign/plan'
import { conditionsOf } from '@/domain/campaign/politics'
import { evaluateCheck } from '@/domain/campaign/conditions'
import { viewCheck } from '@/domain/campaign/checkView'
import type { PoliticalOption } from '@/domain/politics'
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
  const {
    focuses,
    start,
    leaders,
    balanceOfPower,
    laws,
    research,
    mios,
    production,
    politics,
    techs,
  } = data
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
    balanceOfPower: balanceOfPower.value,
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
  /** What the conditions ask about the country on the viewed date. */
  const viewContext = computed(() => ({
    ...conditionsOf(state.value, { ...stateOptions.value, hasTech: planned.value.hasTech }),
    // The terms of a decision's `visible` that only the store can answer (assumed: the factory
    // count is civilian plus military on the viewed date, and a country stays as it starts).
    factories: () => {
      const counts = industry.value?.factories
      if (!counts) return undefined
      return counts
        .filter((f) => ['industrial_complex', 'arms_factory'].includes(f.type))
        .reduce((n, f) => n + f.count, 0)
    },
    isMajor: () => MAJORS_1936.has(countryTag.value),
  }))
  /**
   * Whether an option's `available` is known to hold in the country on the viewed date. With
   * `unknownCounts` a condition the campaign cannot answer counts as holding, like in the planner.
   */
  const availableOnViewDate = (option: PoliticalOption, unknownCounts = true) => {
    if (!option.available) return true
    const holds = evaluateCheck(option.available, viewContext.value)
    return holds === undefined ? unknownCounts : holds
  }
  /**
   * Whether a decision is in the list on the viewed date: its `available` is known to hold, or its
   * `visible` is (no `visible` block counts). The game also greys out what is visible but not
   * available; one whose `visible` the planner cannot answer stays out, so the list stays short.
   */
  const decisionListed = (option: PoliticalOption) =>
    availableOnViewDate(option, false) ||
    !option.visible ||
    // No flag is known to be set (events set them too, which are not played), so none counts as set.
    evaluateCheck(option.visible, { ...viewContext.value, hasFlag: () => false }) === true
  /** An option's `available` as a readable tree, each term marked as holding on the viewed date. */
  const availabilityOnViewDate = (option: PoliticalOption) =>
    option.available
      ? viewCheck(option.available, viewContext.value, {
          idea: (id) =>
            politics.value?.options.find((o) => o.id === id)?.name ??
            state.value.ideas.find((i) => i.id === id)?.name,
          focus: (id) => focuses.value[id]?.name,
          tech: (id) => research.value?.techs.find((t) => t.id === id)?.name,
        })
      : undefined
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

  /** What the focus previews and availability checks work from: the plan and how the country is. */
  const focusInput = computed(() => ({
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
  }))

  /**
   * What a focus not in the plan would do if taken next (see `previewFocusEffects`), worked out on
   * first ask and kept until the plan, the data or the campaign changes.
   */
  const previewFocus = computed(() => {
    const input = focusInput.value
    const cache = new Map<string, ReturnType<typeof previewFocusEffects>>()
    return (id: string) => {
      if (!cache.has(id)) cache.set(id, previewFocusEffects(id, input))
      return cache.get(id)
    }
  })

  /**
   * The focuses that cannot be added: those that conflict with the plan (exclusivity), and those
   * whose `available` would not hold when they start (popularity or stability too low, ...).
   */
  const availabilityBlocks = computed(() => blockedByAvailability(focusInput.value))
  const blockedFocusIds = computed(
    () => new Set([...queues.blockedIds.value, ...availabilityBlocks.value.keys()]),
  )

  /** The planned focuses skipped because their `bypass` holds as they start. */
  const bypassedFocusIds = computed(() => new Set(finalState.value.bypassed))

  /** Adds or removes a focus; a blocked one is not added, and removing drops what it made unavailable. */
  const toggleFocus = (id: string) => {
    if (!plan.value.includes(id) && blockedFocusIds.value.has(id)) return
    queues.toggle(id)
    for (;;) {
      const bad = unavailableInPlan(focusInput.value)
      const first = plan.value.find((p) => bad.has(p))
      if (!first) return
      plan.value = removeWithDependents(first, plan.value, focuses.value)
    }
  }

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
    blockedFocusIds,
    availabilityBlocks,
    bypassedFocusIds,
    toggleFocus,
    plannedConstruction,
    constructionSchedule,
    planEnd,
    researchEnvironment,
    researchTotals,
    researchStatus,
    state,
    stabilityOn,
    availableOnViewDate,
    decisionListed,
    availabilityOnViewDate,
    trade,
    industry,
    timeline,
  }
}
