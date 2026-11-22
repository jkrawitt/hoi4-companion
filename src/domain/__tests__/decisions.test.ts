import { describe, expect, it } from 'vitest'
import { parseDecisionCategories, parseDecisions } from '../parsers/decisions'
import { parseScriptedEffects } from '../parsers/scriptedEffects'
import { parseScriptedTriggers } from '../parsers/politics'
import { evaluateCheck } from '../campaign/conditions'

const TEXT = `
ROM_category = {
  ROM_fortify = {
    icon = generic
    allowed = { original_tag = ROM }
    visible = { has_government = fascism }
    available = { MY_TRIGGER = yes }
    cost = 50
    fire_only_once = yes
    complete_effect = {
      add_stability = 0.05
      MY_EFFECT = { AMOUNT = 3 }
    }
  }
  ROM_variable_cost = {
    cost = var:my_cost
    complete_effect = { add_stability = 0.1 }
  }
  ROM_free = {
    complete_effect = { add_stability = 0.1 }
  }
  ROM_targeted = {
    cost = 10
    targets = { ROM }
    complete_effect = { add_stability = 0.1 }
  }
}
`

describe('parseDecisions', () => {
  const triggers = parseScriptedTriggers('MY_TRIGGER = { has_war_support > 0.5 }')
  const effects = parseScriptedEffects('MY_EFFECT = { add_war_support = $AMOUNT$ }')
  const options = parseDecisions(TEXT, triggers, effects)

  it('keeps decisions with a plain political power cost', () => {
    expect(options.map((o) => o.id)).toEqual(['ROM_fortify', 'ROM_variable_cost', 'ROM_free'])
    expect(options[0]).toMatchObject({
      kind: 'decision',
      slot: 'ROM_category',
      group: 'decisions',
      cost: 50,
      fireOnce: true,
    })
  })

  it('keeps a variable cost as free and flagged, and a missing cost as free', () => {
    const byId = Object.fromEntries(options.map((o) => [o.id, o]))
    expect(byId.ROM_variable_cost).toMatchObject({ cost: 0, variableCost: true })
    expect(byId.ROM_free.cost).toBe(0)
    expect(byId.ROM_free.variableCost).toBeUndefined()
  })

  it('drops targeted decisions', () => {
    expect(options.map((o) => o.id)).not.toContain('ROM_targeted')
  })

  it('keeps the visible block apart from the available one', () => {
    const fortify = options.find((o) => o.id === 'ROM_fortify')!
    expect(fortify.visible).toBeDefined()
    expect(evaluateCheck(fortify.visible!, { government: () => 'fascism' } as never)).toBe(true)
    expect(evaluateCheck(fortify.visible!, { government: () => 'democratic' } as never)).toBe(false)
  })

  it('writes the complete_effect out with scripted effects expanded', () => {
    expect(options[0].modifiers.map((l) => [l.key, l.value])).toEqual([
      ['add_stability', '0.05'],
      ['add_war_support', '3'],
    ])
  })

  it('reads allowed, and visible plus the expanded available as the condition', () => {
    const ctx = (tag: string, support: number, ruling: string) => ({
      hasIdea: () => undefined,
      hasFocus: () => undefined,
      leader: () => undefined,
      government: () => ruling,
      popularity: () => undefined,
      tag,
      stat: (key: string) => (key === 'war_support' ? support : undefined),
    })
    const { allowed, available } = options[0]
    expect(evaluateCheck(allowed!, ctx('ROM', 0, 'fascism'))).toBe(true)
    expect(evaluateCheck(allowed!, ctx('HUN', 0, 'fascism'))).toBe(false)
    expect(evaluateCheck(available!, ctx('ROM', 0.6, 'fascism'))).toBe(true)
    expect(evaluateCheck(available!, ctx('ROM', 0.4, 'fascism'))).toBe(false)
  })
})

describe('parseDecisionCategories', () => {
  it('reads each category and its allowed block', () => {
    const cats = parseDecisionCategories(
      'a = { allowed = { original_tag = ROM } }\nb = { icon = x }',
    )
    expect(Object.keys(cats)).toEqual(['a', 'b'])
    expect(cats.a.allowed).toBeDefined()
    expect(cats.b.allowed).toBeUndefined()
  })
})
