import { describe, expect, it } from 'vitest'
import { collapseEffects, flattenEffects, formatEffect, ideaIdsOf } from '../focusEffects'
import { parseIdeas } from '../parsers/ideas'
import { parseStaticModifiers } from '../parsers/staticModifiers'
import { parseScript } from '../parsers/paradoxScript'

describe('ideas', () => {
  const ideasText = `ideas = { country = {
    T_idea = { removal_cost = -1 modifier = { guarantee_cost = -0.5 industrial_capacity_factory = 0.05 } }
    OTHER = { modifier = { x = 1 } }
  } }`

  it('extracts only wanted ideas, with their modifier lines', () => {
    expect(parseIdeas(ideasText, new Set(['T_idea']))).toEqual({
      T_idea: [
        { depth: 0, key: 'guarantee_cost', value: '-0.5', isModifier: true },
        { depth: 0, key: 'industrial_capacity_factory', value: '0.05', isModifier: true },
      ],
    })
  })

  it('finds idea lines in both add_ideas forms', () => {
    const effects = flattenEffects(
      parseScript('add_ideas = A add_ideas = { B C } other = { add_ideas = D } x = E'),
    )
    expect(ideaIdsOf(effects)).toEqual(['A', 'B', 'C', 'D'])
  })
})

describe('relation modifiers', () => {
  it('collapses add_relation_modifier and formats it', () => {
    const [line] = collapseEffects(
      flattenEffects(parseScript('add_relation_modifier = { target = GER modifier = M }')),
    )
    expect(line).toEqual({ depth: 0, key: 'add_relation_modifier', value: 'M', subject: 'GER' })
    expect(formatEffect({ ...line, valueName: 'License', subjectName: 'German Reich' })).toBe(
      'Gains License when dealing with German Reich',
    )
  })

  it('reads only non-zero numeric stats from a static modifier', () => {
    const defs = parseStaticModifiers(
      `M = { valid_relation_trigger = { FROM = { NOT = { has_war_with = ROOT } } }
             license_purchase_cost = 0 ai_license_acceptance = 20 ai_badass_factor = 1
             license_production_speed = 0.25 }
       OTHER = { x = 1 }`,
      new Set(['M']),
    )
    // AI-only modifiers are dropped, but the game shows the licence acceptance to the player.
    expect(defs).toEqual({
      M: [
        { depth: 0, key: 'ai_license_acceptance', value: '20', isModifier: true },
        { depth: 0, key: 'license_production_speed', value: '0.25', isModifier: true },
      ],
    })
  })
})
