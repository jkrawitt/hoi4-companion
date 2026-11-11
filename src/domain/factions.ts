import { findBlocks, getString } from './paradoxScript'

/**
 * Reads the display name of each wanted faction template from `common/factions/templates`, e.g.
 * `faction_template_axis = { name = Axis ... }`.
 */
export const parseFactionTemplates = (text: string, wanted: Set<string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(findBlocks(text, wanted)).flatMap(([id, block]) => {
      const name = getString(block, 'name')
      return name ? [[id, name]] : []
    }),
  )
