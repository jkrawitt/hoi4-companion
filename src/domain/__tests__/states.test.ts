import { describe, expect, it } from 'vitest'
import { parseLawCategories } from '../parsers/laws'
import {
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
    ).toEqual({ minConsumerFactories: 2, minConsumerPercent: 0.2 })
    expect(parseProductionDefines('')).toEqual({ minConsumerFactories: 1, minConsumerPercent: 0.1 })
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
        'buildings = { dockyard = { level_cap = { shares_slots = yes } } }',
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
