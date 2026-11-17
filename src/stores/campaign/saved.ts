import type { Adjustments } from '@/domain/adjustments'
import type { PoliticsItem } from '@/domain/politics'
import type { ConstructionItem } from '@/domain/production'
import type { ResearchItem } from '@/domain/research'

export const STORAGE_KEY = 'hoi4-companion:campaign'
export const STORAGE_VERSION = 1

export interface SavedCampaign {
  version: number
  countryTag: string
  startDate: string
  speedBonusPercent: number
  plan: string[]
  researchPlan?: ResearchItem[]
  constructionPlan?: ConstructionItem[]
  politicsPlan?: PoliticsItem[]
  /** Timeline actions the player has done in game. */
  checkedOff?: string[]
  /** What the player saw in game: stability, event modifiers, trade. */
  adjustments?: Adjustments
  viewDate: string
}

export const loadSaved = (): Partial<SavedCampaign> => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as SavedCampaign | null
    return saved?.version === STORAGE_VERSION ? saved : {}
  } catch {
    return {}
  }
}

export const save = (campaign: SavedCampaign) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(campaign))
  } catch {
    // Saving is best-effort (private mode, blocked storage).
  }
}
