/**
 * Political power as the game shows it next to the value the planner works with. The game cuts
 * (does not round) what it displays: Finland's 0.798 a day reads 0.79, and a balance of 27.33
 * reads 27. Showing both makes the planner easy to check against the game.
 */

/** `n` cut (not rounded) to `decimals` places, as the game displays it. */
export const shown = (n: number, decimals: number): string =>
  (Math.trunc(n * 10 ** decimals + 1e-9) / 10 ** decimals).toFixed(decimals)

/** What the game shows, then the value the planner uses: `0.79 (0.798)`, or `27 (27.334)`. */
export const withExact = (n: number, shownDecimals: number): string =>
  `${shown(n, shownDecimals)} (${n.toFixed(3)})`
