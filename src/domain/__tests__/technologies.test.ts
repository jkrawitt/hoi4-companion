import { describe, expect, it } from 'vitest'
import type { GameFiles } from '../gameFiles'
import {
  buildTechnologies,
  parseResearchDefines,
  parseTechFolders,
  parseTechnologyFile,
  parseTechTreeLayout,
  placeInTrees,
  readTechnologies,
} from '../parsers/technologies'

const techFile = `
technologies = {
  @1936 = 2
  @1938 = 4
  @1936 = 3
  @wide = 7

  rifles = {
    research_speed_factor = 0.05
    path = { leads_to_tech = rifles2 research_cost_coeff = 1 }
    path = { leads_to_tech = guns }
    research_cost = 1.5
    start_year = 1918
    folder = { name = infantry_folder position = { x = 0 y = -1 } }
    categories = { infantry_weapons infantry_tech }
  }
  rifles2 = {
    research_cost = 2
    start_year = 1936
    folder = { name = infantry_folder position = { x = 0 y = @1936 } }
    category_light_infantry = { soft_attack = 0.05 }
  }
  guns = {
    research_cost = 1
    start_year = 1938
    folder = { name = infantry_folder position = { x = @wide y = @1938 } }
    folder = { name = support_folder position = { x = 1 y = 2 } }
    dependencies = { radio = 1 }
  }
  radio = { start_year = 1936 folder = { name = nsb_armour_folder position = { x = 0 y = 0 } } }
  line_a = {
    XOR = { line_b }
    folder = { name = infantry_folder position = { x = -1 y = 10 } }
  }
  line_b = {
    XOR = { line_a }
    folder = { name = infantry_folder position = { x = 1 y = 10 } }
  }
  project = {
    is_special_project_tech = yes
    folder = { name = infantry_folder position = { x = 0 y = 5 } }
  }
  focus_only = {
    allow = { always = no }
    folder = { name = infantry_folder position = { x = 0 y = 6 } }
  }
  subtech = { research_cost = 1 }
}
`

describe('parseTechnologyFile', () => {
  const raw = parseTechnologyFile(techFile)
  const byId = Object.fromEntries(raw.map((t) => [t.id, t]))

  it('reads cost, year, categories and stats, but not per-category blocks', () => {
    expect(byId.rifles).toMatchObject({
      cost: 1.5,
      startYear: 1918,
      categories: ['infantry_weapons', 'infantry_tech'],
      leadsTo: ['rifles2', 'guns'],
    })
    expect(byId.rifles.modifiers).toEqual([
      { depth: 0, key: 'research_speed_factor', value: '0.05', isModifier: true },
    ])
    expect(byId.rifles2.modifiers).toEqual([])
  })

  it('resolves @variables in positions, using the latest definition before the tech', () => {
    expect(byId.rifles2.folders).toEqual([{ id: 'infantry_folder', x: 0, y: 3 }])
    expect(byId.guns.folders).toEqual([
      { id: 'infantry_folder', x: 7, y: 4 },
      { id: 'support_folder', x: 1, y: 2 },
    ])
  })

  it('reads what a tech unlocks, for naming techs that have no name', () => {
    expect(
      parseTechnologyFile(
        'technologies = { t = { enable_equipments = { eq_1 eq_2 } enable_subunits = { unit } } }',
      )[0].enables,
    ).toEqual(['eq_1', 'eq_2', 'unit'])
  })

  it('reads dependencies, XOR groups and the reasons a tech cannot be researched', () => {
    expect(byId.guns.dependencies).toEqual(['radio'])
    expect(byId.line_a.exclusiveWith).toEqual(['line_b'])
    expect(byId.project.notResearchable).toBe(true)
    expect(byId.focus_only.notResearchable).toBe(true)
    expect(byId.rifles.notResearchable).toBe(false)
  })
})

describe('buildTechnologies', () => {
  const raw = parseTechnologyFile(techFile)
  const techs = Object.fromEntries(
    buildTechnologies(raw, ['infantry_folder', 'support_folder']).map((t) => [t.id, t]),
  )

  it('turns "leads to" around: every parent is one OR group, a dependency its own group', () => {
    expect(techs.rifles.prerequisites).toEqual([])
    expect(techs.rifles2.prerequisites).toEqual([['rifles']])
    expect(techs.guns.prerequisites).toEqual([['rifles'], ['radio']])
  })

  it('treats several parents as alternatives', () => {
    const both = buildTechnologies(
      parseTechnologyFile(
        'technologies = { a = { path = { leads_to_tech = c } } b = { path = { leads_to_tech = c } } c = { } }',
      ),
      [],
    )
    expect(both.find((t) => t.id === 'c')?.prerequisites).toEqual([['a', 'b']])
  })

  it('keeps only the folders that are available, and marks the rest not researchable', () => {
    expect(techs.radio.folders).toEqual([])
    expect(techs.radio.researchable).toBe(false)
    expect(techs.subtech.researchable).toBe(false)
    expect(techs.rifles.researchable).toBe(true)
    expect(techs.project.researchable).toBe(false)
    expect(techs.focus_only.researchable).toBe(false)
    expect(techs.line_a.exclusiveWith).toEqual(['line_b'])
  })
})

describe('parseTechFolders', () => {
  const tags = `
technology_categories = { a b }
technology_folders = {
  infantry_folder = { ledger = army }
  armour_folder = { available = { NOT = { has_dlc = "No Step Back" } } }
  nsb_armour_folder = { available = { has_dlc = "No Step Back" } }
  air_techs_folder = { available = { NOT = { has_dlc = "By Blood Alone" } } }
  bba_air_techs_folder = { available = { has_dlc = "By Blood Alone" } }
  either = { available = { OR = { has_dlc = "A" has_dlc = "B" } } }
  land_doctrine_folder = { doctrine = yes }
}`

  it('picks the DLC variant of a folder, in file order, and drops doctrine folders', () => {
    expect(
      parseTechFolders(tags, { 'By Blood Alone': true, 'No Step Back': false, B: true }),
    ).toEqual(['infantry_folder', 'armour_folder', 'bba_air_techs_folder', 'either'])
  })

  it('counts a DLC that is not listed as not owned', () => {
    expect(parseTechFolders(tags, {})).toEqual([
      'infantry_folder',
      'armour_folder',
      'air_techs_folder',
    ])
  })
})

describe('parseResearchDefines', () => {
  it('reads NTechnology and falls back to the usual values', () => {
    const lua = `NOther = {\n BASE_TECH_COST = 5,\n},\nNTechnology = {\n\tBASE_YEAR_AHEAD_PENALTY_FACTOR = 3, -- c\n\tBASE_TECH_COST = 120,\n\tMIN_RESEARCH_SPEED = 0.2,\n},\n`
    expect(parseResearchDefines(lua)).toEqual({ baseCost: 120, aheadPenalty: 3, minSpeed: 0.2 })
    expect(parseResearchDefines('')).toEqual({ baseCost: 110, aheadPenalty: 2, minSpeed: 0.1 })
  })
})

describe('readTechnologies', () => {
  it('reads every file of the directory, the folders and the defines', async () => {
    const texts: Record<string, string> = {
      'common/technology_tags/00_technology.txt':
        'technology_folders = { infantry_folder = { } support_folder = { } }',
      'common/technologies/a.txt': techFile,
      'common/technologies/b.txt':
        'technologies = { extra = { folder = { name = support_folder position = { x = 0 y = 0 } } } }',
      'common/defines/00_defines.lua': 'NTechnology = {\n BASE_TECH_COST = 100,\n}',
    }
    const files: GameFiles = {
      readText: async (p) => texts[p] ?? null,
      listFiles: async (dir) =>
        Object.keys(texts)
          .filter((p) => p.startsWith(`${dir}/`))
          .map((p) => p.slice(dir.length + 1)),
    }
    const { data } = await readTechnologies(files, {})
    expect(data.folders.map((f) => f.id)).toEqual(['infantry_folder', 'support_folder'])
    expect(data.techs.find((t) => t.id === 'extra')?.researchable).toBe(true)
    expect(data.techs.find((t) => t.id === 'rifles2')?.prerequisites).toEqual([['rifles']])
    expect(data.defines.baseCost).toBe(100)
  })
})

describe('tech stats', () => {
  it('leaves out the numbers that are not stat changes', () => {
    const [tech] = parseTechnologyFile(`technologies = {
      t = {
        research_cost = 2
        start_year = 1938
        xp_boost_cost = 50
        xp_research_bonus = 0.5
        sub_tech_index = 1
        industrial_capacity_factory = 0.1
      }
    }`)
    expect(tech.modifiers.map((m) => m.key)).toEqual(['industrial_capacity_factory'])
  })
})

describe('tech tree layout', () => {
  const gui = `
guiTypes = {
  containerWindowType = {
    name = "industry_folder"
    containerWindowType = {
      name = "size_filler"
      gridboxtype = { name = "tools_tree" position = { x = 0 y = 140 } slotsize = { width = 70 height = 70 } format = "UP" }
      gridboxtype = { name = "dig_tree" position = { x = 700 y = 280 } slotsize = { width = 70 height = 70 } format = "UP" }
      gridboxtype = { name = "stats_grid" position = { x = 5 y = 5 } }
    }
  }
  containerWindowType = {
    name = "infantry_folder"
    gridboxtype = { name = "guns_tree" position = { x = 10% y = 210 } slotsize = { width = 70 height = 70 } format = "LEFT" }
  }
  containerWindowType = {
    name = "nsb_armour_folder"
    gridboxtype = { name = "tank_tree" position = { x = 0 y = 0 } format = "UP" }
  }
}`
  const layout = parseTechTreeLayout(gui, ['industry_folder', 'infantry_folder'])
  const tech = (id: string, folder: string, x: number, y: number, leadsTo: string[] = []) => ({
    id,
    cost: 1,
    startYear: 1936,
    folders: [{ id: folder, x, y }],
    categories: [],
    leadsTo,
    dependencies: [],
    exclusiveWith: [],
    enables: [],
    notResearchable: false,
    modifiers: [],
  })

  it('reads the trees of the folders asked for, in slots', () => {
    expect(layout).toEqual({
      industry_folder: [
        { root: 'tools', x: 0, y: 2, sideways: false },
        { root: 'dig', x: 10, y: 4, sideways: false },
      ],
      // A box placed in percent starts at 0.
      infantry_folder: [{ root: 'guns', x: 0, y: 3, sideways: true }],
    })
  })

  it('places each tech in the tree whose root leads to it', () => {
    const placed = Object.fromEntries(
      placeInTrees(
        [
          tech('tools', 'industry_folder', 0, 0, ['tools2']),
          tech('tools2', 'industry_folder', 0, 2),
          tech('dig', 'industry_folder', 0, 0, ['dig2']),
          tech('dig2', 'industry_folder', 1, 2),
          tech('loose', 'industry_folder', 5, 5),
          tech('guns', 'infantry_folder', 0, 0, ['guns2']),
          tech('guns2', 'infantry_folder', 1, 2),
        ],
        layout,
      ).map((t) => [t.id, t.folders[0]]),
    )
    expect(placed.tools2).toMatchObject({ x: 0, y: 4 })
    expect(placed.dig).toMatchObject({ x: 10, y: 4 })
    expect(placed.dig2).toMatchObject({ x: 11, y: 6 })
    // No tree reaches it, so it stays where it was written.
    expect(placed.loose).toMatchObject({ x: 5, y: 5 })
    // Sideways: the year (`y`) becomes the column.
    expect(placed.guns2).toMatchObject({ x: 2, y: 4 })
  })
})
