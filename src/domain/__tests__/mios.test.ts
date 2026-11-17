import { describe, expect, it } from 'vitest'
import { parseMios } from '../parsers/mios'
import { evaluateCheck } from '../campaign/conditions'

const FILE = `
generic_tank_organization = {
  allowed = { NOT = { original_tag = ROM } }
  research_categories = { mio_cat_tech_tank other_cat }
  initial_trait = {
    name = generic_trait
    organization_modifier = { military_industrial_organization_research_bonus = 0.05 }
  }
}
generic_gun_organization = {
  allowed = { always = yes }
  research_categories = { mio_cat_tech_gun }
}
ROM_works_organization = {
  include = generic_tank_organization
  allowed = { tag = ROM }
  available = { FROM = { has_completed_focus = ROM_focus } }
}
ROM_dlc_organization = {
  include = generic_gun_organization
  allowed = { tag = ROM has_dlc = "Some DLC" }
}
ROM_malaxa_organization = {
  include = generic_tank_organization
  allowed = { tag = ROM }
  initial_trait = {
    organization_modifier = {
      military_industrial_organization_research_bonus = -0.03
      military_industrial_organization_funds_gain = -0.1
    }
  }
}
OTHER_organization = {
  include = generic_gun_organization
  allowed = { tag = OTH }
}
DEBUG_generic_gun_organization = {
  include = generic_gun_organization
  allowed = { has_dlc = "Some DLC" is_debug = yes }
}
`

describe('parseMios', () => {
  const read = (dlc: Record<string, boolean>) =>
    Object.fromEntries(parseMios([FILE], 'ROM', dlc).map((m) => [m.id, m]))

  it('keeps the MIOs the tag and DLCs allow, and leaves out debug copies', () => {
    expect(Object.keys(read({ 'Some DLC': true }))).toEqual([
      'generic_gun_organization',
      'ROM_works_organization',
      'ROM_dlc_organization',
      'ROM_malaxa_organization',
    ])
    // The DLC one goes without the DLC; the generic tank one is not for Romania.
    expect(Object.keys(read({ 'Some DLC': false }))).toEqual([
      'generic_gun_organization',
      'ROM_works_organization',
      'ROM_malaxa_organization',
    ])
  })

  it('copies the fields of the included MIO, own fields winning', () => {
    const mios = read({})
    expect(mios.ROM_works_organization.researchCategories).toEqual([
      'mio_cat_tech_tank',
      'other_cat',
    ])
    expect(mios.ROM_works_organization.researchBonus).toBe(0.05)
    expect(mios.generic_gun_organization.researchBonus).toBe(0)
    // Its own initial trait replaces the included one.
    expect(mios.ROM_malaxa_organization.researchBonus).toBe(-0.03)
  })

  it('reads FROM in available as the country', () => {
    const works = read({}).ROM_works_organization
    expect(works.available).toEqual({ type: 'focus', id: 'ROM_focus' })
    const ctx = (focus: boolean) => ({
      hasIdea: () => undefined,
      hasFocus: (id: string) => focus && id === 'ROM_focus',
      leader: () => undefined,
      government: () => undefined,
      popularity: () => undefined,
    })
    expect(evaluateCheck(works.available!, ctx(true))).toBe(true)
    expect(evaluateCheck(works.available!, ctx(false))).toBe(false)
    expect(read({}).ROM_malaxa_organization.available).toBeUndefined()
  })
})
