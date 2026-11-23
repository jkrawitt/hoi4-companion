/** Small number helpers shared by the parsers, the effects and the campaign. */

/** Rounds to 6 decimals, which hides the noise of adding fractions. */
export const round = (n: number) => Number(n.toFixed(6))

/** Whether a line's value is a plain number (not a variable or an empty value). */
export const isNumeric = (value: string | undefined): value is string =>
  value !== undefined && value !== '' && Number.isFinite(Number(value))
