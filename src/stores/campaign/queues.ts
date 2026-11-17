import { computed, ref } from 'vue'
import type { ImportedCountry } from '@/domain/focus'
import type { PoliticsItem } from '@/domain/politics'
import {
  addPurchase as addToQueue,
  knownPurchases,
  movePurchase as moveInQueue,
  removePurchase as removeFromQueue,
  setNotBefore as setQueueNotBefore,
} from '@/domain/plan/politicsPlan'
import {
  emptyAdjustments,
  sanitizeAdjustments,
  type Adjustments,
  type AdjustmentEntry,
  type AdjustmentKind,
} from '@/domain/adjustments'
import { isValidConstructionPlan, levelsLeft, type ConstructionItem } from '@/domain/production'
import type { BonusRef, ResearchItem } from '@/domain/research'
import { moveItem, newId, withIds } from '@/domain/queue'
import {
  isValidResearchPlan,
  pathToTech,
  removeWithDependents as removeTechWithDependents,
} from '@/domain/plan/researchSelection'
import { isValidPlan, pathTo, removeWithDependents } from '@/domain/plan/focusSelection'
import type { GameData } from './gameData'
import type { SavedCampaign } from './saved'

/** The player's queues (focuses, research, construction, purchases) and what they entered. */
export const createQueues = (saved: Partial<SavedCampaign>, data: GameData) => {
  const { focuses, production, techs, startTechs } = data

  const plan = ref<string[]>(Array.isArray(saved.plan) ? saved.plan : [])
  /** The research queue: one list the research slots take the next startable tech from. */
  const researchPlan = ref<ResearchItem[]>(
    Array.isArray(saved.researchPlan) ? saved.researchPlan : [],
  )
  /** The construction queue: buildings the spare civilian factories build, in order. */
  const constructionPlan = ref<ConstructionItem[]>(
    withIds(Array.isArray(saved.constructionPlan) ? saved.constructionPlan : []),
  )
  /** The political power purchase queue: bought in order, each as soon as the power is there. */
  const politicsPlan = ref<PoliticsItem[]>(
    withIds(Array.isArray(saved.politicsPlan) ? saved.politicsPlan : []),
  )
  /** The ids of the timeline actions the player has checked off as done in game. */
  const checkedOff = ref<string[]>(Array.isArray(saved.checkedOff) ? saved.checkedOff : [])
  const toggleChecked = (id: string) => {
    checkedOff.value = checkedOff.value.includes(id)
      ? checkedOff.value.filter((x) => x !== id)
      : [...checkedOff.value, id]
  }
  const resetChecked = () => (checkedOff.value = [])
  /** Stability, event modifiers and trade entered from the game, each with its date. */
  const adjustments = ref<Adjustments>(sanitizeAdjustments(saved.adjustments))
  const addAdjustment = <K extends AdjustmentKind>(
    kind: K,
    entry: Omit<AdjustmentEntry<K>, 'id'>,
  ) => {
    const list = adjustments.value[kind] as AdjustmentEntry<K>[]
    adjustments.value = {
      ...adjustments.value,
      [kind]: [...list, { ...entry, id: newId() } as AdjustmentEntry<K>],
    }
  }
  const removeAdjustment = (kind: AdjustmentKind, id: string) => {
    adjustments.value = {
      ...adjustments.value,
      [kind]: adjustments.value[kind].filter((entry) => entry.id !== id),
    }
  }

  /**
   * Keeps the saved queues when the imported data still supports them, and drops them when it
   * does not. Runs once the data is in place.
   */
  const keepValid = ({
    politics: politicsData,
    production: productionData,
    mios,
  }: ImportedCountry) => {
    politicsPlan.value = knownPurchases(politicsPlan.value, politicsData.options)
    const known = plan.value.filter((id) => id in focuses.value)
    plan.value = isValidPlan(known, focuses.value) ? known : []
    researchPlan.value = isValidResearchPlan(researchPlan.value, techs.value, startTechs.value)
      ? withKnownTeams(researchPlan.value, mios ?? [])
      : []
    constructionPlan.value = isValidConstructionPlan(constructionPlan.value, productionData)
      ? constructionPlan.value
      : []
  }

  /** The research queue without design teams the importer did not find (saved queues of a past import). */
  const withKnownTeams = (queue: ResearchItem[], mios: { id: string }[]): ResearchItem[] =>
    queue.map((item) =>
      item.designTeam && !mios.some((m) => m.id === item.designTeam)
        ? { ...item, designTeam: undefined }
        : item,
    )

  /** Another country is another campaign: start its plan from scratch. */
  const clear = () => {
    plan.value = []
    researchPlan.value = []
    constructionPlan.value = []
    politicsPlan.value = []
    checkedOff.value = []
    adjustments.value = emptyAdjustments()
  }

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
    const queue = moveItem(researchPlan.value, index, by)
    if (isValidResearchPlan(queue, techs.value, startTechs.value)) researchPlan.value = queue
  }

  const setTechBonus = (index: number, bonus: BonusRef | undefined) => {
    researchPlan.value = researchPlan.value.map((item, i) =>
      i === index ? { ...item, bonus } : item,
    )
  }

  const setTechDesignTeam = (index: number, designTeam: string | undefined) => {
    researchPlan.value = researchPlan.value.map((item, i) =>
      i === index ? { ...item, designTeam } : item,
    )
  }

  const resetResearch = () => (researchPlan.value = [])

  const addConstruction = (item: ConstructionItem) => {
    if (
      production.value &&
      levelsLeft(production.value, item.building, item.state, constructionPlan.value) >= item.levels
    ) {
      constructionPlan.value = withIds([...constructionPlan.value, item])
    }
  }

  /** Moves a queued building up (-1) or down (1). */
  const moveConstruction = (index: number, by: -1 | 1) => {
    constructionPlan.value = moveItem(constructionPlan.value, index, by)
  }

  const removeConstruction = (index: number) => {
    constructionPlan.value = constructionPlan.value.filter((_, i) => i !== index)
  }

  const resetConstruction = () => (constructionPlan.value = [])
  const addPurchase = (optionId: string, dismiss = false) => {
    politicsPlan.value = withIds(addToQueue(politicsPlan.value, optionId, dismiss))
  }
  const movePurchase = (index: number, by: -1 | 1) => {
    politicsPlan.value = moveInQueue(politicsPlan.value, index, by)
  }
  const removePurchase = (index: number) => {
    politicsPlan.value = removeFromQueue(politicsPlan.value, index)
  }
  const setNotBefore = (index: number, notBefore: string | undefined) => {
    politicsPlan.value = setQueueNotBefore(politicsPlan.value, index, notBefore)
  }
  const resetPolitics = () => (politicsPlan.value = [])

  return {
    plan,
    researchPlan,
    constructionPlan,
    politicsPlan,
    checkedOff,
    adjustments,
    toggleChecked,
    resetChecked,
    addAdjustment,
    removeAdjustment,
    keepValid,
    clear,
    blockedIds,
    toggle,
    reset,
    blockedTechIds,
    toggleTech,
    moveTech,
    setTechBonus,
    setTechDesignTeam,
    resetResearch,
    addConstruction,
    moveConstruction,
    removeConstruction,
    resetConstruction,
    addPurchase,
    movePurchase,
    removePurchase,
    setNotBefore,
    resetPolitics,
  }
}

export type Queues = ReturnType<typeof createQueues>
