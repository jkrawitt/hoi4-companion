import { formatDay, fromGameDay, parseDay, wholeDay } from '@/domain/calendar'

/** `parseDay` and `formatDay` from the calendar, under the names the components use. */
export const parseDate = parseDay
export const formatDate = formatDay

/** The first whole day on which a focus ending at `end` counts as complete. */
export const completionDay = (end: Date): string => formatDate(fromGameDay(wholeDay(end)))
