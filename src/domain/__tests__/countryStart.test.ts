import { describe, expect, it } from 'vitest'
import { parseStartingLines } from '../parsers/countryStart'
import { defaultLawLines } from '../parsers/laws'

const text = `
capital = 46
set_research_slots = 3
set_stability = 0.6
set_war_support = 0.5
set_technology = { infantry_weapons = 1 }
if = { limit = { has_dlc = "Death or Dishonor" } add_ideas = { king_idea } give_guarantee = GRE }
if = { limit = { has_dlc = "Other" } add_ideas = other_idea }
add_ideas = neutrality_idea
set_politics = { ruling_party = democratic elections_allowed = yes }
set_popularities = { democratic = 60 fascism = 18 }
1939.1.1 = { set_stability = 0.1 add_ideas = late_idea }
`

describe('parseStartingLines', () => {
  it('reads the 1936 stats, ideas, ruling party and popularities', () => {
    const lines = parseStartingLines(text, { 'Death or Dishonor': true })
    expect(lines.map((l) => `${l.depth}:${l.key}=${l.value ?? l.subject ?? ''}`)).toEqual([
      '0:add_research_slot=3',
      '0:add_stability=0.6',
      '0:add_war_support=0.5',
      '0:set_technology=',
      '0:add_ideas=',
      '1:null=king_idea',
      '0:add_ideas=neutrality_idea',
      '0:set_politics=democratic',
      '0:add_popularity=0.6',
      '0:add_popularity=0.18',
    ])
    expect(lines.find((l) => l.subject === 'fascism')?.value).toBe('0.18')
  })

  it('drops DLC ideas for a DLC that is not owned, and ignores dated blocks', () => {
    const lines = parseStartingLines(text)
    expect(lines.some((l) => l.value === 'king_idea' || l.value === 'late_idea')).toBe(false)
  })

  it('reads starting technologies, including the ones in a DLC branch', () => {
    const lines = parseStartingLines(
      `set_technology = { infantry_weapons = 1 tech_support = 1 skipped = 0 }
       if = { limit = { has_dlc = "By Blood Alone" } set_technology = { air_new = 1 } else = { set_technology = { air_old = 1 } } }
       if = { limit = { not = { has_dlc = "Man the Guns" } } set_technology = { ship_old = 1 } }
       1939.1.1 = { set_technology = { late = 1 } }`,
      { 'By Blood Alone': true, 'Man the Guns': true },
    )
    expect(lines.map((l) => l.research)).toEqual([
      { kind: 'unlock', targets: ['infantry_weapons', 'tech_support'] },
      { kind: 'unlock', targets: ['air_new'] },
    ])
  })
})

describe('defaultLawLines', () => {
  const categories = {
    economy: { ideas: ['civilian_economy', 'war_economy'], default: 'civilian_economy' },
    trade_laws: { ideas: ['export_focus', 'free_trade'], default: 'export_focus' },
  }

  it('adds the default idea of each law category the start does not set', () => {
    const lines = defaultLawLines(categories, parseStartingLines('set_stability = 0.5'))
    expect(lines.map((l) => [l.key, l.value])).toEqual([
      ['add_ideas', 'civilian_economy'],
      ['add_ideas', 'export_focus'],
    ])
  })

  it('leaves a category alone when the history adds one of its ideas', () => {
    const start = parseStartingLines('add_ideas = war_economy\nadd_ideas = { other free_trade }')
    expect(defaultLawLines(categories, start)).toEqual([])
  })
})
