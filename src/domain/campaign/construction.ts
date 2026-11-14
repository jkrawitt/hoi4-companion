/**
 * Planning construction against the campaign: the focus plan decides what is built instantly and
 * where, which builds join the queue, and (with the ideas and technologies) how fast things go up
 * and how many building slots there are. The queue is scheduled against that
 * (`scheduleConstruction`); `constructionEnvironment` builds the dated inputs.
 */
import type { ResearchSchedule, Technology } from '../research'
import type {
  ConstructionEnvironment,
  ConstructionEvent,
  ConstructionFactors,
  ConstructionItem,
  ConstructionSchedule,
  FocusConstruction,
  ProductionData,
} from '../production'
import { scheduleConstruction } from '../plan/constructionPlan'
import { techModifierTotals } from './research'
import { placeBatches, sharedBuildings, startingRows } from './industry'
import { activeModifiers } from './totals'
import type { CountryState } from './types'

/** Stat keys that look like a building speed but are not one. */
const NOT_BUILDINGS = new Set(['buildings', 'buildings_powered'])

/**
 * The construction modifiers over time: they change when a focus completes (ideas come and go,
 * timed ones run out) and when research finishes (technologies add speed and slots).
 */
export const constructionFactors = (
  finalState: Pick<CountryState, 'snapshots'>,
  research: ResearchSchedule,
  techs: Technology[],
  startDate: Date,
  researchEnds: Date[],
): ConstructionFactors[] => {
  const times = new Set<number>([startDate.getTime()])
  for (const s of finalState.snapshots) {
    times.add(s.date.getTime())
    for (const idea of s.ideas) if (idea.until) times.add(idea.until.getTime())
  }
  for (const end of researchEnds) times.add(end.getTime())
  return [...times]
    .sort((a, b) => a - b)
    .map((time) => {
      const date = new Date(time)
      const latest = finalState.snapshots.filter((s) => s.date <= date).pop()
      const active = (latest?.ideas ?? []).filter((idea) => !idea.until || idea.until > date)
      const own = activeModifiers(active, latest?.traits ?? []).totals
      const totals = new Map<string, number>()
      for (const t of [
        ...own.values(),
        ...techModifierTotals(techs, research.researchedBy(date)),
      ]) {
        totals.set(t.key, (totals.get(t.key) ?? 0) + t.total)
      }
      const buildingSpeed: Record<string, number> = {}
      for (const [key, total] of totals) {
        const building = /^production_speed_(.+)_factor$/.exec(key)?.[1]
        if (building && !NOT_BUILDINGS.has(building)) buildingSpeed[building] = total
      }
      return {
        date,
        buildingsSpeed: totals.get('production_speed_buildings_factor') ?? 0,
        buildingSpeed,
        poweredSpeed: totals.get('production_speed_buildings_powered_factor') ?? 0,
        slotFactor: totals.get('global_building_slots_factor') ?? 0,
        consumerExpected: own.get('consumer_goods_expected_value')?.total ?? 0,
        consumerFactor: totals.get('consumer_goods_factor') ?? 0,
        energyGain: totals.get('energy_gain_factor') ?? 0,
        energyConsumption: totals.get('factory_energy_consumption') ?? 0,
      }
    })
}

export interface ConstructionPlanInput {
  production: ProductionData
  /** The country when the focus plan is done: every build of the plan is in `construction`. */
  finalState: CountryState
  research: ResearchSchedule
  techs: Technology[]
  queue: ConstructionItem[]
  startDate: Date
  until: Date
}

export interface PlannedConstruction {
  schedule: ConstructionSchedule
  environment: ConstructionEnvironment
}

/** Schedules the construction queue against the focus plan and the research schedule. */
export const planConstruction = (input: ConstructionPlanInput): PlannedConstruction => {
  const { production, finalState, research, techs, queue, startDate, until } = input
  const researchEnds = research.items.filter((i) => i.slot >= 0).map((i) => i.end)
  const factors = constructionFactors(finalState, research, techs, startDate, researchEnds)

  // Place every build of the plan, with the slots of the day the focus plan is done.
  const shared = sharedBuildings(production)
  const atFinish = factors.filter((f) => f.date <= finalState.date).pop()
  const rows = startingRows(production, shared, atFinish?.slotFactor ?? 0)
  const { placements } = placeBatches(rows, finalState.construction, shared)

  const events: ConstructionEvent[] = []
  const focusBuilds: FocusConstruction[] = []
  for (const { batch, stateId, guessed } of placements) {
    const built: Record<string, number> = {}
    for (const b of batch.buildings) {
      if (b.instant) built[b.type] = (built[b.type] ?? 0) + b.level
      else if (stateId !== undefined) {
        focusBuilds.push({
          date: batch.date,
          focusName: batch.focusName,
          guessed,
          item: { building: b.type, state: stateId, levels: b.level },
        })
      }
    }
    const resources: Record<string, number> = {}
    for (const r of batch.resources) resources[r.type] = (resources[r.type] ?? 0) + r.amount
    events.push({ date: batch.date, state: stateId, built, slots: batch.slots, resources })
  }

  const environment: ConstructionEnvironment = { factors, events, focusBuilds }
  return {
    environment,
    schedule: scheduleConstruction(queue, production, environment, { startDate, until }),
  }
}
