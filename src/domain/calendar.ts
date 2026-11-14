/**
 * The game's calendar. HoI4 has no leap years: every year is 365 days and there is no 29 February,
 * so 282 days after 1 January 1936 is 10 October in the game (9 October in the real calendar).
 * Dates are still plain `Date`s (UTC), but every count of days between them, and every date that
 * many days on, goes through here. A fraction of a day (a focus taking 52.5 days) is kept as time
 * within the day.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000
export const DAYS_PER_YEAR = 365

/** Days before each month in a 365-day year. */
const MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]

/** The game day a date falls on, counted from year 0, with the time of day as a fraction. */
export const gameDay = (date: Date | number): number => {
  const d = typeof date === 'number' ? new Date(date) : date
  const month = d.getUTCMonth()
  // 29 February does not exist in the game; treat it as 1 March.
  const dayOfMonth = month === 1 && d.getUTCDate() === 29 ? 28 : d.getUTCDate() - 1
  const timeOfDay =
    month === 1 && d.getUTCDate() === 29
      ? 0
      : (d.getTime() - Date.UTC(d.getUTCFullYear(), month, d.getUTCDate())) / MS_PER_DAY
  return d.getUTCFullYear() * DAYS_PER_YEAR + MONTH_STARTS[month] + dayOfMonth + timeOfDay
}

/** The date of a game day number (see `gameDay`). */
export const fromGameDay = (day: number): Date => {
  const whole = Math.floor(day)
  const year = Math.floor(whole / DAYS_PER_YEAR)
  const dayOfYear = whole - year * DAYS_PER_YEAR
  let month = 11
  while (MONTH_STARTS[month] > dayOfYear) month--
  return new Date(
    Date.UTC(year, month, dayOfYear - MONTH_STARTS[month] + 1) + (day - whole) * MS_PER_DAY,
  )
}

/** The date `days` game days after `date`. */
export const addDays = (date: Date, days: number): Date => fromGameDay(gameDay(date) + days)

/** Game days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: Date | number, to: Date | number): number =>
  gameDay(to) - gameDay(from)
