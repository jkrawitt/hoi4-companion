/**
 * Strips game markup from a localised string: colour codes (`§Y` ... `§!`), `\n` line breaks and
 * `[SCOPE.GetName]` style dynamic text, which becomes just the scope (e.g. `SOU`).
 */
export const cleanLocalisation = (text: string): string =>
  text
    .replace(/§./g, '')
    .replace(/\\n/g, '\n')
    .replace(/\[([^\].]+)\.[^\]]*\]/g, '$1')
    .replace(/\[[^\]]*\]/g, '')

/**
 * Parses a HoI4 localisation `.yml` file (`KEY:0 "text"` or `KEY: "text"` lines) into a map.
 * When `wanted` is given, only those keys are kept. When `raw` is given, the original text of
 * entries containing `[...]` dynamic text is also stored there, for callers that can resolve it.
 */
export const parseLocalisation = (
  text: string,
  wanted?: Set<string>,
  raw?: Record<string, string>,
): Record<string, string> => {
  const result: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const match = /^\s*([^\s:#]+):\d*\s*"(.*)"\s*(?:#.*)?$/.exec(line)
    if (match && (!wanted || wanted.has(match[1]))) {
      result[match[1]] = cleanLocalisation(match[2])
      if (raw && match[2].includes('[')) raw[match[1]] = match[2]
    }
  }
  return result
}

/** Who the `From` and `Root` of an event are, for resolving its dynamic text. */
export interface EventTextContext {
  from?: string
  root?: string
  /** Name of the faction `Root` leads, when known. */
  rootFaction?: string
}

/**
 * Fills in `[From.GetName]`, `[Root.GetName]` and `[Root.GetFactionName]` in event text. An
 * unknown faction reads as "our faction", since events are written from the receiver's view.
 * Anything else dynamic degrades to the plain scope name like `cleanLocalisation` does.
 */
export const resolveEventText = (rawText: string, context: EventTextContext): string => {
  const faction = context.rootFaction ? `the ${context.rootFaction}` : 'our faction'
  return cleanLocalisation(
    rawText
      .replace(/the \[Root\.GetFactionName\]/gi, faction)
      .replace(/\[Root\.GetFactionName\]/gi, context.rootFaction ?? 'our faction')
      .replace(/\[From\.GetName\w*\]/gi, context.from ?? 'From')
      .replace(/\[Root\.GetName\w*\]/gi, context.root ?? 'Root'),
  )
}
