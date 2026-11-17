/**
 * The plan lists put a banner above the first row of each year. Call the returned function for each
 * row in order: it gives the year when the row starts a new one, otherwise null. A row without a
 * date (not scheduled) gets no banner and does not start a year.
 */
export const yearBanners = () => {
  let previous: number | undefined
  return (date: Date | undefined): number | null => {
    const year = date?.getUTCFullYear()
    if (year === undefined) return null
    const banner = year !== previous ? year : null
    previous = year
    return banner
  }
}
