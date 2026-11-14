/** The shared shapes of the production side: the states a country owns and how factories fit. */

/** One state as it starts the game, for the country that owns it. */
export interface StateData {
  id: number
  /** The localisation key (`STATE_46`) as read, the display name once the importer has named it. */
  name: string
  /** The state category (`city`, `rural`, ...), which sets its building slots. */
  category: string
  /** State-level buildings only (`arms_factory`, `infrastructure`, ...); province ones are left out. */
  buildings: Record<string, number>
  resources: Record<string, number>
  manpower: number
}

export interface ProductionData {
  states: StateData[]
  /** Building slots of each state category (`local_building_slots`). */
  categorySlots: Record<string, number>
  /** The buildings that share a state's slots (`shares_slots = yes`): factories, dockyards, ... */
  sharedSlotBuildings: string[]
  /** The buildings that can be queued in a state (every building with a `state_max`). */
  buildings: BuildingData[]
  defines: ProductionDefines
}

/** One state-level building from `common/buildings`. */
export interface BuildingData {
  id: string
  name: string
  /** `base_cost`: the progress one level takes. */
  cost: number
  /** `level_cap.state_max`: the most levels a state can hold. */
  stateMax: number
  /** `level_cap.shares_slots`: takes one of the state's building slots per level. */
  sharesSlots: boolean
  /** `infrastructure_construction_effect`: built faster in a state with better infrastructure. */
  infraEffect: boolean
}

/** `NProduction` numbers the consumer goods minimum comes from. */
export interface ProductionDefines {
  /** `MINIMUM_NUMBER_OF_FACTORIES_TAKEN_BY_CONSUMER_GOODS_VALUE` */
  minConsumerFactories: number
  /** `MINIMUM_NUMBER_OF_FACTORIES_TAKEN_BY_CONSUMER_GOODS_PERCENT` */
  minConsumerPercent: number
  /** `MAX_CIV_FACTORIES_PER_LINE`: the civilian factories one project takes at most. */
  maxCivsPerProject: number
  /** `BASE_FACTORY_SPEED` and `POWERED_FACTORY_SPEED`: construction points per civilian a day. */
  baseFactorySpeed: number
  poweredFactorySpeed: number
  /** `INFRA_MAX_CONSTRUCTION_COST_EFFECT` */
  infraEffect: number
  /** `ENERGY_RESOURCE`: the resource that makes energy (coal). */
  energyResource: string
  /** `BASE_COUNTRY_ENERGY_PRODUCTION`, `RESOURCE_TO_ENERGY_COEFFICIENT` */
  baseEnergy: number
  energyPerResource: number
  /** `BASE_ENERGY_COST`, `ENERGY_SCALING_COST_BY_FACTORY_COUNT`, `ENERGY_COST_CAP` */
  baseEnergyCost: number
  energyCostScaling: number
  energyCostCap: number
  /** `BASE_STABILITY_PARTY_POPULARITY_FACTOR`: stability from the ruling party's popularity. */
  partyPopularityStability: number
  /**
   * The `consumer_goods_factor` of `stability_good_modifier` (`common/modifiers`), which applies in
   * full at 100% stability and scales down to nothing at 50%.
   */
  stabilityConsumerGoods: number
}

export const DEFAULT_DEFINES: ProductionDefines = {
  minConsumerFactories: 1,
  minConsumerPercent: 0.1,
  maxCivsPerProject: 15,
  baseFactorySpeed: 4,
  poweredFactorySpeed: 5,
  infraEffect: 1,
  energyResource: 'coal',
  baseEnergy: 10,
  energyPerResource: 9,
  baseEnergyCost: 0.25,
  energyCostScaling: 0.0225,
  energyCostCap: 6.6,
  partyPopularityStability: 0.15,
  stabilityConsumerGoods: -0.2,
}

/** A building queued in a state: it builds its levels one after another. */
export interface ConstructionItem {
  building: string
  state: number
  levels: number
}

/** The modifiers in force from a date on, as the construction speed and the energy need them. */
export interface ConstructionFactors {
  date: Date
  /** `production_speed_buildings_factor` */
  buildingsSpeed: number
  /** `production_speed_<building>_factor`, by building. */
  buildingSpeed: Record<string, number>
  /** `production_speed_buildings_powered_factor`, added to the speed while the country is powered. */
  poweredSpeed: number
  /** `global_building_slots_factor` */
  slotFactor: number
  /** `consumer_goods_expected_value` and `consumer_goods_factor` */
  consumerExpected: number
  consumerFactor: number
  /** The country's stability (see `stabilityOf`), which lowers consumer goods above 50%. */
  stability: number
  /** `energy_gain_factor` and `factory_energy_consumption` */
  energyGain: number
  energyConsumption: number
}

/** What the plan does to one state on a date: buildings handed out, slots, resources. */
export interface ConstructionEvent {
  date: Date
  /** Unset for a build that fits no state: it counts for the country only. */
  state?: number
  built: Record<string, number>
  slots: number
  resources: Record<string, number>
}

/** A build a focus queues: it joins the end of the queue on `date`. */
export interface FocusConstruction {
  date: Date
  focusName: string
  /** The game picks the state of a random block, so this one is a guess. */
  guessed: boolean
  item: ConstructionItem
}

/** The dated inputs the campaign hands the construction planner. */
export interface ConstructionEnvironment {
  factors: ConstructionFactors[]
  events: ConstructionEvent[]
  focusBuilds: FocusConstruction[]
}

export const emptyConstructionEnvironment = (): ConstructionEnvironment => ({
  factors: [],
  events: [],
  focusBuilds: [],
})

export interface ConstructionOptions {
  startDate: Date
  /** How far to look for levels finishing. */
  until: Date
}

export type ConstructionIssue =
  /** A level had to wait for a free building slot in its state. */
  | 'no-slots'
  /** The state already holds the most levels of this building. */
  | 'state-max'
  | 'unknown-building'
  | 'unknown-state'

export interface ScheduledLevel {
  start: Date
  end: Date
  days: number
  /** The civilian factories on it on its last day. */
  civs: number
}

export interface ScheduledConstruction {
  /** The position in its own list: the user's queue or the focus builds. */
  index: number
  source: 'queue' | 'focus'
  item: ConstructionItem
  focusName?: string
  guessed?: boolean
  /** When it joined the queue. */
  joined: Date
  /** The levels finished, in order. */
  levels: ScheduledLevel[]
  issues: ConstructionIssue[]
}

/** One level finished: from `date` it counts as a factory (or whatever it is) of the state. */
export interface BuiltLevel {
  date: Date
  state: number
  building: string
}

export interface ConstructionSchedule {
  /** The user's items in queue order, then the focus builds. */
  items: ScheduledConstruction[]
  /** Every level finished, by date. */
  built: BuiltLevel[]
  /** The last level finished, or the start date when none. */
  finish: Date
}

/** The most levels of `building` that can still be queued in a state, besides the ones queued. */
export const levelsLeft = (
  production: ProductionData,
  building: string,
  stateId: number,
  queue: ConstructionItem[],
): number => {
  const data = production.buildings.find((b) => b.id === building)
  const state = production.states.find((s) => s.id === stateId)
  if (!data || !state) return 0
  const queued = queue
    .filter((q) => q.building === building && q.state === stateId)
    .reduce((n, q) => n + q.levels, 0)
  return Math.max(0, data.stateMax - (state.buildings[building] ?? 0) - queued)
}

/** Whether every item names a building and a state that exist and holds a whole level count. */
export const isValidConstructionPlan = (
  queue: ConstructionItem[],
  production: ProductionData,
): boolean =>
  queue.every(
    (q) =>
      Number.isInteger(q.levels) &&
      q.levels >= 1 &&
      production.buildings.some((b) => b.id === q.building) &&
      production.states.some((s) => s.id === q.state),
  )

export interface ConsumerGoods {
  /** The share of the factories the country wants on consumer goods, 0.35 for 35%. */
  percent: number
  /** The law's share before any modifier (`consumer_goods_expected_value`). */
  expected: number
  /** The stability the country has, 0.69 for 69%. */
  stability: number
  /** The `consumer_goods_factor` that stability gives, e.g. -0.076 at 69%. */
  stabilityFactor: number
  factories: number
}

/**
 * A country's stability: what history and effects set (`add_stability` total), its ideas' and
 * technologies' `stability_factor`, and a share of the ruling party's popularity. Romania in 1936:
 * 60% + 15% x 60% democratic = 69% (checked in game). Between 0 and 1.
 */
export const stabilityOf = (
  base: number,
  stabilityFactor: number,
  rulingPopularity: number,
  defines: ProductionDefines,
): number =>
  Math.min(
    1,
    Math.max(0, base + stabilityFactor + rulingPopularity * defines.partyPopularityStability),
  )

/**
 * The `consumer_goods_factor` from stability: `stability_good_modifier` scaled from nothing at 50%
 * stability to all of it at 100%, so -20% x 0.38 = -7.6% at 69% (checked in game). Below 50% it
 * has none.
 */
export const stabilityConsumerFactor = (stability: number, defines: ProductionDefines): number =>
  stability > 0.5 ? (defines.stabilityConsumerGoods * (stability - 0.5)) / 0.5 : 0

/**
 * The civilian factories the consumer goods take: the share wanted (`consumer_goods_expected_value`)
 * scaled by every `consumer_goods_factor` (ideas, technologies and stability) of the civilian and
 * military factories together, rounded down: Romania in 1936 has 35% x (1 - 7.6%) = 32.3% of 18 =
 * 5.8, and the game takes 5 (checked in game). At least the defines' minimum (a number and a share
 * of the civilian factories, rounded up: not checked) and never more than the civilian factories.
 */
export const consumerGoodsFor = (
  civ: number,
  mil: number,
  expectedValue: number,
  factor: number,
  stability: number,
  defines: ProductionDefines,
): ConsumerGoods => {
  const stabilityFactor = stabilityConsumerFactor(stability, defines)
  const percent = expectedValue * (1 + factor + stabilityFactor)
  const wanted = Math.max(
    // The small allowance keeps a product like 0.35 x 20 = 7 from landing on 6.9999.
    Math.floor(percent * (civ + mil) + 1e-9),
    defines.minConsumerFactories,
    Math.ceil(defines.minConsumerPercent * civ),
  )
  return {
    percent,
    expected: expectedValue,
    stability,
    stabilityFactor,
    factories: Math.min(wanted, civ),
  }
}
