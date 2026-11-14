/**
 * Planning the whole campaign: the focus plan decides what the country has, and the research queue
 * and the political power purchases are scheduled against it. They depend on each other (a law
 * speeds research up and a technology can make a focus reward differ, and a designer's research
 * bonus follows from when it is bought), so they are settled together by repetition, as
 * `planResearch` does for research and `has_tech` alone: each pass plans the purchases with the
 * technologies the previous pass finished, then plans research with those purchases, until
 * neither schedule changes.
 */
import type { PoliticsData, PoliticsItem } from '../politics'
import type { ResearchData, ResearchItem } from '../research'
import type { FocusSchedule } from '../plan/types'
import { planPolitics, type PlannedPolitics } from './politics'
import { planResearch, type PlannedResearch } from './research'
import type { CountryStateOptions } from './types'

export interface CampaignPlanInput {
  focusSchedule: FocusSchedule
  /** What `countryStateAt` takes (tag, start, leaders, ownedDlc); `hasTech` is worked out here. */
  options: CountryStateOptions
  researchQueue: ResearchItem[]
  researchData?: ResearchData
  politicsQueue: PoliticsItem[]
  politicsData?: PoliticsData
  startDate: Date
  /** How far to look for techs finishing and purchases. */
  until: Date
}

export interface PlannedCampaign extends PlannedResearch {
  politics: PlannedPolitics
}

/** The most times the purchases and the research schedule are settled against each other. */
const MAX_PASSES = 4

const signature = (planned: PlannedCampaign): string =>
  JSON.stringify([
    planned.schedule.items,
    planned.schedule.unscheduled,
    planned.politics.items,
    planned.politics.unscheduled,
  ])

export const planCampaign = (input: CampaignPlanInput): PlannedCampaign => {
  const { focusSchedule, options, startDate, until } = input
  const withPolitics: CountryStateOptions = { ...options, politics: input.politicsData }
  let hasTech: PlannedResearch['hasTech']
  let planned: PlannedCampaign | undefined
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const politics = planPolitics({
      focusSchedule,
      options: { ...withPolitics, hasTech },
      queue: input.politicsQueue,
      data: input.politicsData,
      startDate,
      until,
    })
    const research = planResearch({
      focusSchedule,
      options: { ...withPolitics, extraSteps: politics.steps },
      queue: input.researchQueue,
      data: input.researchData,
      startDate,
      until,
    })
    const next = { ...research, politics }
    const settled = planned !== undefined && signature(planned) === signature(next)
    hasTech = research.hasTech
    planned = next
    if (settled) break
  }
  return planned!
}
