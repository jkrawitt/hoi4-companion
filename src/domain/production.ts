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
  defines: ProductionDefines
}

/** `NProduction` numbers the consumer goods minimum comes from. */
export interface ProductionDefines {
  /** `MINIMUM_NUMBER_OF_FACTORIES_TAKEN_BY_CONSUMER_GOODS_VALUE` */
  minConsumerFactories: number
  /** `MINIMUM_NUMBER_OF_FACTORIES_TAKEN_BY_CONSUMER_GOODS_PERCENT` */
  minConsumerPercent: number
}
