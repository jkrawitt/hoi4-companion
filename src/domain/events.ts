import { getAll, getBlock, getString, parseScript } from './paradoxScript'

/**
 * Reads the title localisation key of each wanted event from an `events/*.txt` file. Events are
 * repeated top-level `country_event = { id = X title = KEY ... }` blocks. A title that depends
 * on conditions (`title = { text = KEY trigger = { ... } }`) uses its first text.
 */
export const parseEventTitles = (text: string, wanted: Set<string>): Record<string, string> => {
  const titles: Record<string, string> = {}
  for (const entry of parseScript(text)) {
    if (typeof entry.value !== 'object' || !entry.key?.endsWith('_event')) continue
    const id = getString(entry.value, 'id')
    if (!id || !wanted.has(id) || id in titles) continue
    const title = getString(entry.value, 'title')
    const conditional = getAll(entry.value, 'title').find((t) => typeof t.value === 'object')
    const key =
      title ?? (conditional ? getString(getBlock([conditional], 'title') ?? [], 'text') : undefined)
    if (key) titles[id] = key
  }
  return titles
}
