import { describe, expect, it } from 'vitest'
import { combineModifiers } from '../campaign/modifiers'
import type { RuleValue, StatTotal } from '../campaign/types'
import { statGroupOf } from '../statGroups'

const total = (key: string, value: number, label = key): StatTotal => ({
  key,
  stat: { key, label },
  total: value,
})

describe('combineModifiers', () => {
  it('merges one key from both sources and remembers each part', () => {
    const [group] = combineModifiers({
      spirits: [total('research_speed_factor', 0.05, 'Research Speed')],
      technology: [total('research_speed_factor', 0.1, 'Research Speed')],
      rules: [],
    })
    expect(group.rows).toHaveLength(1)
    expect(group.rows[0].sources).toEqual({ spirits: 0.05, technology: 0.1 })
    expect(Number(group.rows[0].value)).toBeCloseTo(0.15)
  })

  it('keeps conscription and conscription_factor apart', () => {
    const groups = combineModifiers({
      spirits: [total('conscription', 0.01), total('conscription_factor', 0.05)],
      technology: [],
      rules: [],
    })
    expect(groups.flatMap((g) => g.rows.map((r) => r.key)).sort()).toEqual([
      'conscription',
      'conscription_factor',
    ])
  })

  it('orders groups like the list and drops empty groups and zero totals', () => {
    const groups = combineModifiers({
      spirits: [
        total('naval_speed_factor', 0.1, 'Naval Speed'),
        total('stability_factor', 0.05, 'Stability'),
        total('army_attack_factor', 0.1, 'Division Attack'),
        total('army_defence_factor', 0.1, 'Division Defense'),
        total('army_org_factor', 0, 'Zero'),
      ],
      technology: [total('army_attack_factor', -0.1, 'Division Attack')],
      rules: [],
    })
    expect(groups.map((g) => g.id)).toEqual(['politics', 'army', 'navy'])
    expect(groups[1].rows.map((r) => r.key)).toEqual(['army_defence_factor'])
  })

  it('sorts rows by label within a group', () => {
    const [group] = combineModifiers({
      spirits: [total('b_drift', 1, 'B'), total('a_drift', 1, 'A')],
      technology: [],
      rules: [],
    })
    expect(group.rows.map((r) => r.key)).toEqual(['a_drift', 'b_drift'])
  })

  it('places rules in their groups', () => {
    const rule: RuleValue = { key: 'can_send_volunteers', stat: { key: 'x' }, value: 'yes' }
    const groups = combineModifiers({ spirits: [], technology: [], rules: [rule] })
    expect(groups).toMatchObject([
      { id: 'diplomacy', rows: [{ key: 'can_send_volunteers', value: 'yes' }] },
    ])
  })
})

describe('statGroupOf', () => {
  it.each([
    ['stability_factor', 'politics'],
    ['communism_drift', 'politics'],
    ['economy_cost_factor', 'politics'],
    ['guarantee_cost', 'diplomacy'],
    ['production_speed_arms_factory_factor', 'construction'],
    ['global_building_slots_factor', 'construction'],
    ['conversion_cost_civ_to_mil_factor', 'construction'],
    ['cic_construction_boost_factor', 'construction'],
    ['consumer_goods_factor', 'economy'],
    ['consumer_goods_expected_value', 'economy'],
    ['min_export', 'economy'],
    ['industrial_capacity_factory', 'production'],
    ['production_factory_max_efficiency_factor', 'production'],
    ['industry_repair_factor', 'production'],
    ['nuclear_production_factor', 'production'],
    ['factory_energy_consumption', 'resources'],
    ['max_fuel_factor', 'resources'],
    ['research_speed_factor', 'research'],
    ['conscription_factor', 'manpower'],
    ['land_reinforce_rate', 'manpower'],
    ['army_attack_factor', 'army'],
    ['naval_speed_factor', 'navy'],
    ['transport_capacity', 'navy'],
    ['navy_intel_to_others', 'intelligence'],
    ['navy_anti_air_attack_factor', 'navy'],
    ['tech_air_damage_factor', 'air'],
    ['air_ace_generation_chance_factor', 'air'],
    ['decryption', 'intelligence'],
    ['resistance_damage_to_garrison', 'occupation'],
    ['something_unknown', 'other'],
  ])('puts %s in %s', (key, group) => {
    expect(statGroupOf(key)).toBe(group)
  })
})
