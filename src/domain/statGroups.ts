/**
 * The groups the overview sorts the summed modifiers into. A stat's group is judged from its key
 * by an ordered list of patterns (the first match wins), so a new key lands somewhere sensible
 * and anything unrecognised ends up in `other`.
 */
export type StatGroupId =
  | 'politics'
  | 'diplomacy'
  | 'industry'
  | 'resources'
  | 'research'
  | 'manpower'
  | 'army'
  | 'navy'
  | 'air'
  | 'intelligence'
  | 'occupation'
  | 'other'

export interface StatGroup {
  id: StatGroupId
  name: string
}

/** In display order. */
export const STAT_GROUPS: StatGroup[] = [
  { id: 'politics', name: 'Politics and stability' },
  { id: 'diplomacy', name: 'Diplomacy' },
  { id: 'industry', name: 'Industry and construction' },
  { id: 'resources', name: 'Resources, energy and fuel' },
  { id: 'research', name: 'Research' },
  { id: 'manpower', name: 'Manpower' },
  { id: 'army', name: 'Army' },
  { id: 'navy', name: 'Navy' },
  { id: 'air', name: 'Air' },
  { id: 'intelligence', name: 'Intelligence' },
  { id: 'occupation', name: 'Occupation' },
  { id: 'other', name: 'Other' },
]

/** Earlier rules win, so the narrow ones (`navy_intel_`, `tech_air_`) come before their families. */
const RULES: [StatGroupId, RegExp][] = [
  ['intelligence', /intel|encryption|decryption|subversive|agency|operative/],
  [
    'politics',
    /^(add_)?(stability|war_support|political_power|popularity)|drift|party_popularity|(_chief|_leader|_doctrine|_advisor|_laws)_cost_factor$|^(economy|high_command)_cost_factor$/,
  ],
  [
    'diplomacy',
    /_tension|guarantee|embargo|faction|volunteer|relations|license|opinion|justify_war_goal|lend_lease|^can_access_market/,
  ],
  [
    'industry',
    /^production_|^industrial_capacity|consumer_goods|conversion_cost|building_slots|line_change_production|equipment_conversion|^industry_|^cic_|^min_export|^nuclear_|^thermonuclear_/,
  ],
  ['resources', /^local_resources|^resource|fuel|energy/],
  ['air', /^tech_air|^air_|^experience_gain_air|static_anti_air/],
  ['research', /^research_|^tech_|^sp_|_research_|add_research_slot|design_team/],
  ['manpower', /conscription|manpower|experience_loss|land_reinforce/],
  [
    'navy',
    /^naval_|^navy_|^amphibious|transport_capacity|convoy|critical_receive_chance|underway_/,
  ],
  [
    'army',
    /^army_|^land_|coordination|bunker|division|breakthrough|planning|entrenchment|special_forces|paratrooper|paradrop|training_time|experience_gain/,
  ],
  ['occupation', /resistance|garrison|compliance/],
]

export const statGroupOf = (key: string): StatGroupId =>
  RULES.find(([, pattern]) => pattern.test(key))?.[0] ?? 'other'
