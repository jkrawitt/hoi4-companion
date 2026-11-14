/**
 * Which DLCs the player owns, by the name `has_dlc` uses in the game files. Our own content.
 *
 * Some focus rewards branch on a DLC: `if = { limit = { has_dlc = "X" } ... } else = { ... }`.
 * For a DLC listed here the importer keeps only the branch that applies (see
 * `resolveDlcConditions` in `focusEffects.ts`), so the plan shows what the player really gets.
 * A DLC not listed here is not resolved, and its condition is shown as written.
 *
 * "Arms Against Tyranny" is owned, so focus rewards show their military industrial organisation
 * (MIO) branch. MIO effects (`mio:<id> = { add_mio_funds ... }`, `show_mio_tooltip`) are not
 * formatted yet and show as raw lines, and the political power planner leaves out the equipment
 * designers, which this DLC turns into MIOs (MIOs themselves are not planned yet).
 */
export const ownedDlc: Record<string, boolean> = {
  'Arms Against Tyranny': true,
  'Battle for the Bosporus': false,
  'By Blood Alone': true,
  'Death or Dishonor': true,
  'Man the Guns': true,
  'No Step Back': false,
}
