/**
 * Which DLCs the player has, by the name `has_dlc` uses in the game files. Our own content.
 *
 * Some focus rewards branch on a DLC: `if = { limit = { has_dlc = "X" } ... } else = { ... }`.
 * Every DLC name the game files ask about is listed, so every `has_dlc` is settled: the importer
 * keeps only the branch that applies (see `resolveDlcConditions` in `focusEffects.ts`), so the plan
 * shows what the player really gets. A name that is missing here is not settled, and its condition
 * is shown as written.
 *
 * Four of them are base game now (Together for Victory, Death or Dishonor, Waking the Tiger and
 * Man the Guns), so they are always on. The rest are the player's own: owned or not.
 *
 * Military industrial organisations (MIOs) are base game too, so the equipment designers are
 * never bought with political power (`MIO_SLOTS` in `politicsImport.ts`); their design teams are
 * planned with the research.
 */
export const ownedDlc: Record<string, boolean> = {
  // Base game now.
  'Together for Victory': true,
  'Death or Dishonor': true,
  'Waking the Tiger': true,
  'Man the Guns': true,
  // Owned.
  Gotterdammerung: true,
  'Arms Against Tyranny': true,
  'By Blood Alone': true,
  'No Step Back': true,
  'La Resistance': true,
  'No Compromise, No Surrender': true,
  // Not owned.
  'Battle for the Bosporus': false,
  'Thunder at Our Gates': false,
  'Graveyard of Empires': false,
  'Trial of Allegiance': false,
  'Peace For Our Time': false,
  'Poland: United and Ready': false,
}
