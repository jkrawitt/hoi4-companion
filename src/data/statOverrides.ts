import type { StatOverrides } from '@/domain/stats'

/**
 * Hand-maintained corrections for how stats are shown, for when the game's own data is missing
 * or ambiguous (it does not say percent vs number). Add entries as wrong ones are spotted.
 * This is our own content, not extracted game data.
 */
export const statOverrides: StatOverrides = {
  guarantee_tension: {
    label: 'Guarantee tension limit',
    kind: 'percent',
    decimals: 0,
    goodWhen: 'negative',
  },
  // Popularity changes are unclear in value, so any gain is shown as good.
  add_popularity: { kind: 'percent', goodWhen: 'positive' },
  guarantee_cost: { kind: 'percent', decimals: 0, goodWhen: 'negative' },
  // Daily drift of an ideology's popularity, shown as a plain number; any gain counts as good.
  ...Object.fromEntries(
    ['communism', 'fascism', 'democratic', 'neutrality'].map((ideology) => [
      `${ideology}_drift`,
      {
        kind: 'number' as const,
        decimals: 2,
        fixedDecimals: true,
        showPlus: false,
        goodWhen: 'positive' as const,
      },
    ]),
  ),
  // `Division Recovery Rate`: more is better.
  army_morale: { goodWhen: 'positive' },
  army_morale_factor: { goodWhen: 'positive' },
  send_volunteer_divisions_required: { kind: 'percent', decimals: 0, goodWhen: 'negative' },
  send_volunteer_size: { kind: 'number', decimals: 0, goodWhen: 'positive' },
  can_send_volunteers: { label: 'Can send volunteers' },
  can_create_factions: { label: 'Can create factions' },
  // Effects of the form `key = number`, see `STAT_EFFECT_KEYS` in `focusEffects.ts`.
  add_stability: { label: 'Stability', kind: 'percent', goodWhen: 'positive' },
  add_war_support: { label: 'War support', kind: 'percent', goodWhen: 'positive' },
  add_political_power: {
    label: 'Political power',
    kind: 'number',
    decimals: 0,
    goodWhen: 'positive',
  },
  // Political power: the daily gain is a plain number, the drain and the factor are changes to it.
  political_power_gain: {
    label: 'Political power gain',
    kind: 'number',
    decimals: 2,
    goodWhen: 'positive',
  },
  political_power_factor: { label: 'Political power gain', kind: 'percent', goodWhen: 'positive' },
  political_power_cost: {
    label: 'Political power cost',
    kind: 'number',
    decimals: 2,
    goodWhen: 'negative',
  },
  add_research_slot: { label: 'Research slots', kind: 'number', decimals: 0, goodWhen: 'positive' },
  army_experience: { label: 'Army experience', kind: 'number', decimals: 0, goodWhen: 'positive' },
  air_experience: { label: 'Air experience', kind: 'number', decimals: 0, goodWhen: 'positive' },
  navy_experience: { label: 'Navy experience', kind: 'number', decimals: 0, goodWhen: 'positive' },
  add_extra_state_shared_building_slots: {
    label: 'Building slots',
    kind: 'number',
    decimals: 0,
    goodWhen: 'positive',
  },
  // Leader traits such as `hedonist` (-5%) change stability as a factor.
  stability_factor: { label: 'Stability', kind: 'percent', goodWhen: 'positive' },
  // A shorter time to justify a war goal is an improvement.
  justify_war_goal_time: { goodWhen: 'negative' },
  // Fewer consumer goods means more factories for everything else.
  consumer_goods_factor: { goodWhen: 'negative' },
  ai_license_acceptance: { goodWhen: 'positive' },
  license_production_speed: { goodWhen: 'positive' },
  license_tech_difference_speed: { goodWhen: 'positive' },
  conscription: {
    label: 'Recruitable Population',
    kind: 'percent',
    decimals: 2,
    fixedDecimals: true,
    showPlus: false,
    goodWhen: 'positive',
  },
  // Not in the game's tooltips or localisation, or shown wrong there: our own direction and format.
  // The game's `%0` format would show a flat cap of 6 as 600%.
  special_forces_cap_flat: { kind: 'number', decimals: 0, goodWhen: 'positive' },
  special_forces_no_supply_grace: {
    label: 'Special Forces Supply Grace (hours)',
    kind: 'number',
    decimals: 0,
    goodWhen: 'positive',
  },
  // The share of factories the game puts on consumer goods: fewer is better.
  consumer_goods_expected_value: { kind: 'percent', goodWhen: 'negative' },
  energy_gain_factor: { goodWhen: 'positive' },
  fuel_gain_factor_from_states: { kind: 'percent', goodWhen: 'positive' },
  conversion_cost_mil_to_civ_factor: { goodWhen: 'negative' },
  improve_relations_maintain_cost_factor: { goodWhen: 'negative' },
  license_armor_purchase_cost: { goodWhen: 'negative' },
  critical_receive_chance: { label: 'Critical hit chance received', goodWhen: 'negative' },
  naval_critical_effect_factor: { goodWhen: 'negative' },
  naval_invasion_prep_days: {
    label: 'Naval invasion preparation days',
    kind: 'number',
    decimals: 0,
    goodWhen: 'negative',
  },
  naval_invasion_plan_cap: { kind: 'number', decimals: 0, goodWhen: 'positive' },
  naval_invasion_division_cap: { kind: 'number', decimals: 0, goodWhen: 'positive' },
  naval_retreat_speed: { goodWhen: 'positive' },
  encryption: { kind: 'number', decimals: 0, goodWhen: 'positive' },
  decryption: { kind: 'number', decimals: 0, goodWhen: 'positive' },
  // `Troop convoy requirements`: fewer convoys needed is better.
  transport_capacity: { goodWhen: 'negative' },
  // The game's own misspelling is the key.
  foreign_subversive_activites: { label: 'Foreign subversive activities', goodWhen: 'negative' },
  bunker_max_level_terrain_limit: { kind: 'number', decimals: 0, goodWhen: 'positive' },
  coastal_bunker_max_level_terrain_limit: { kind: 'number', decimals: 0, goodWhen: 'positive' },
}
