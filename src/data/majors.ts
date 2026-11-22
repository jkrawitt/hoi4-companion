/**
 * The countries that are major powers at the 1936 start (`is_major = yes`): the game ranks the
 * countries by industry, and these seven lead it. Our own content; the planner does not track
 * rank changes, so a country is taken to stay as it starts.
 */
export const MAJORS_1936: ReadonlySet<string> = new Set([
  'GER',
  'SOV',
  'USA',
  'ENG',
  'FRA',
  'ITA',
  'JAP',
])
