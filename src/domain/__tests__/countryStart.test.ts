import { describe, expect, it } from 'vitest'
import { parseStartingLines } from '../parsers/countryStart'

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
})
