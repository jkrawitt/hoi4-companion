import { describe, expect, it } from 'vitest'
import { DEFAULT_DEFINES } from '../production'
import { parseLawCategories } from '../parsers/laws'
import {
  parseBuildings,
  parseProductionDefines,
  parseSharedSlotBuildings,
  parseStateCategories,
  parseStateHistory,
  readProduction,
} from '../parsers/states'

const state = `
state = {
	id = 46
	name = "STATE_46" # Muntenia
	manpower = 3971400
	resources = { oil = 44 }
	state_category = city
	history = {
		owner = ROM
		buildings = {
			infrastructure = 3
			arms_factory = 3
			industrial_complex = 1
			657 = { naval_base = 2 }
		}
		1939.1.1 = { owner = GER buildings = { arms_factory = 9 } }
		if = { limit = { has_dlc = "X" } owner = SOV }
	}
}`

describe('parseStateHistory', () => {
  it('reads the top-level owner and the state-level buildings only', () => {
    expect(parseStateHistory(state)).toEqual({
      id: 46,
      name: 'STATE_46',
      category: 'city',
      manpower: 3971400,
      resources: { oil: 44 },
      buildings: { infrastructure: 3, arms_factory: 3, industrial_complex: 1 },
      owner: 'ROM',
    })
  })
})

describe('state categories, shared slots and defines', () => {
  it('reads local building slots per category', () => {
    expect(
      parseStateCategories(
        'state_categories={ city = { local_building_slots = 6 color = { 0 1 2 } } }',
      ),
    ).toEqual({ city: 6 })
  })

  it('finds the buildings that share slots', () => {
    expect(
      parseSharedSlotBuildings(`buildings = {
        arms_factory = { level_cap = { shares_slots = yes state_max = 20 } }
        air_base = { level_cap = { state_max = 10 } }
        dockyard = { level_cap = { shares_slots = yes } }
      }`),
    ).toEqual(['arms_factory', 'dockyard'])
  })

  it('reads the consumer goods defines, with fallbacks', () => {
    expect(
      parseProductionDefines(
        'MINIMUM_NUMBER_OF_FACTORIES_TAKEN_BY_CONSUMER_GOODS_VALUE = 2,\nMINIMUM_NUMBER_OF_FACTORIES_TAKEN_BY_CONSUMER_GOODS_PERCENT = 0.2,',
      ),
    ).toMatchObject({ minConsumerFactories: 2, minConsumerPercent: 0.2 })
    expect(parseProductionDefines('')).toEqual(DEFAULT_DEFINES)
  })

  it('reads the construction and energy defines', () => {
    const defines = parseProductionDefines(`NProduction = {
      MAX_CIV_FACTORIES_PER_LINE = 12,
      BASE_FACTORY_SPEED = 4,
      BASE_FACTORY_SPEED_MIL = 3.5,
      POWERED_FACTORY_SPEED = 6,
      INFRA_MAX_CONSTRUCTION_COST_EFFECT = 0.5,
      ENERGY_RESOURCE = "oil",
      BASE_COUNTRY_ENERGY_PRODUCTION = 8.0,
      RESOURCE_TO_ENERGY_COEFFICIENT = 7.5,
      BASE_ENERGY_COST = 0.3,
      ENERGY_SCALING_COST_BY_FACTORY_COUNT = 0.02,
      ENERGY_COST_CAP = 5,
    }`)
    expect(defines).toMatchObject({
      maxCivsPerProject: 12,
      baseFactorySpeed: 4,
      poweredFactorySpeed: 6,
      infraEffect: 0.5,
      energyResource: 'oil',
      baseEnergy: 8,
      energyPerResource: 7.5,
      baseEnergyCost: 0.3,
      energyCostScaling: 0.02,
      energyCostCap: 5,
    })
  })
})

describe('parseBuildings', () => {
  it('reads the buildings that sit in a state, with cost and caps', () => {
    expect(
      parseBuildings(`buildings = {
        # a comment
        infrastructure = { base_cost = 6000 infrastructure_construction_effect = yes level_cap = { state_max = 5 } }
        industrial_complex = { base_cost = 10800 level_cap = { shares_slots = yes state_max = 20 } }
        bunker = { base_cost = 500 level_cap = { province_max = 10 } }
        naval_facility = { base_cost = 10000 level_cap = { province_max = 1 state_max = 1 } }
        odd = { base_cost = 1 }
      }`),
    ).toEqual([
      {
        id: 'infrastructure',
        name: 'infrastructure',
        cost: 6000,
        stateMax: 5,
        sharesSlots: false,
        infraEffect: true,
      },
      {
        id: 'industrial_complex',
        name: 'industrial_complex',
        cost: 10800,
        stateMax: 20,
        sharesSlots: true,
        infraEffect: false,
      },
    ])
  })
})

describe('readProduction', () => {
  it('keeps the states the country owns', async () => {
    const other = state.replace('id = 46', 'id = 47').replace('owner = ROM', 'owner = BUL')
    const files: Record<string, string> = {
      'history/states/46-a.txt': state,
      'history/states/47-b.txt': other,
      'common/state_category/city.txt':
        'state_categories = { city = { local_building_slots = 6 } }',
      'common/buildings/00.txt':
        'buildings = { dockyard = { base_cost = 6400 level_cap = { shares_slots = yes state_max = 20 } } }',
    }
    const production = await readProduction(
      {
        readText: async (p) => files[p] ?? null,
        listFiles: async (dir) =>
          Object.keys(files)
            .filter((p) => p.startsWith(`${dir}/`))
            .map((p) => p.slice(dir.length + 1)),
      },
      'ROM',
    )
    expect(production.states.map((s) => s.id)).toEqual([46])
    expect(production.categorySlots).toEqual({ city: 6 })
    expect(production.sharedSlotBuildings).toEqual(['dockyard'])
    expect(production.buildings.map((b) => [b.id, b.cost])).toEqual([['dockyard', 6400]])
  })
})

describe('parseLawCategories', () => {
  it('finds the default idea of law categories only', () => {
    expect(
      parseLawCategories(`ideas = {
        economy = { law = yes civilian_economy = { default = yes } war_economy = { } }
        country = { some_spirit = { default = yes } }
      }`),
    ).toEqual({
      economy: { ideas: ['civilian_economy', 'war_economy'], default: 'civilian_economy' },
    })
  })
})
