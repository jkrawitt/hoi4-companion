/**
 * Parses a HoI4 localisation `.yml` file (`KEY:0 "text"` or `KEY: "text"` lines) into a map.
 * When `wanted` is given, only those keys are kept.
 */
export const parseLocalisation = (text: string, wanted?: Set<string>): Record<string, string> => {
  const result: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const match = /^\s*([^\s:#]+):\d*\s*"(.*)"\s*(?:#.*)?$/.exec(line)
    if (match && (!wanted || wanted.has(match[1]))) result[match[1]] = match[2]
  }
  return result
}
