/**
 * Which DLCs the player owns, by the name `has_dlc` uses in the game files. Our own content.
 *
 * Some focus rewards branch on a DLC: `if = { limit = { has_dlc = "X" } ... } else = { ... }`.
 * For a DLC listed here the importer keeps only the branch that applies (see
 * `resolveDlcConditions` in `focusEffects.ts`), so the plan shows what the player really gets.
 * A DLC not listed here is not resolved, and its condition is shown as written.
 *
 * TODO: "Arms Against Tyranny" (military industrial organizations, MIOs) is NOT owned for now,
 * so the `else` branch is shown, e.g. a designer idea in place of an MIO. This is meant to
 * change: flip it to `true` (or make it a user setting) and the MIO branch is shown instead.
 * MIO effects (`mio:<id> = { add_mio_funds ... }`, `show_mio_tooltip`) are not formatted yet,
 * so that branch needs its own display work when it is switched on.
 */
export const ownedDlc: Record<string, boolean> = {
  'Arms Against Tyranny': false,
  'Battle for the Bosporus': false,
  'By Blood Alone': true,
  'Death or Dishonor': true,
  'Man the Guns': true,
  'No Step Back': false,
}
