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
  communism_drift: {
    kind: 'number',
    decimals: 2,
    fixedDecimals: true,
    showPlus: false,
    goodWhen: 'positive',
  },
  send_volunteer_divisions_required: { kind: 'percent', decimals: 0, goodWhen: 'negative' },
  send_volunteer_size: { kind: 'number', decimals: 0, goodWhen: 'positive' },
  can_send_volunteers: { label: 'Can send volunteers' },
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
}
