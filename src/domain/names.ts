/**
 * Loading the English display names the UI needs out of `localisation/english`.
 *
 * Names can live in any of the install's localisation files, and there are hundreds of them, so
 * keys are collected first and looked up in one pass: focus-named files are read before the
 * rest, and reading stops as soon as every key has been found.
 */
import { GAME_PATHS, type GameFiles } from './gameFiles'
import { parseLocalisation } from './parsers/localisation'

/** Texts that are built out of other texts, written `$SOME_OTHER_KEY$`. */
const REFERENCE = /\$([\w.]+)\$/g
const MAX_REFERENCE_DEPTH = 8

export interface LoadedNames {
  /** Display text by localisation key, with `$KEY$` references filled in. */
  names: Record<string, string>
  /**
   * Original text of the entries that hold `[Root.GetName]` style dynamic parts, which only the
   * caller knows how to fill in (see `resolveEventText`).
   */
  rawNames: Record<string, string>
}

/** Reads the display text for `wanted`, plus whatever the texts it finds refer to in turn. */
export const loadNames = async (files: GameFiles, wanted: Set<string>): Promise<LoadedNames> => {
  const names: Record<string, string> = {}
  const rawNames: Record<string, string> = {}

  const all = (await files.listFiles(GAME_PATHS.localisation)).filter((f) => f.endsWith('.yml'))
  const isFocusFile = (f: string) => f.toLowerCase().includes('focus')
  // Focus text is nearly always in a focus-named file, so those are worth reading first.
  const batches = [all.filter(isFocusFile), all.filter((f) => !isFocusFile(f))]

  const load = async (want: Set<string>) => {
    for (const batch of batches) {
      if ([...want].every((key) => key in names)) return
      for (const file of batch) {
        const text = await files.readText(`${GAME_PATHS.localisation}/${file}`)
        if (text !== null) Object.assign(names, parseLocalisation(text, want, rawNames))
      }
    }
  }

  await load(wanted)
  // A text can refer to one that refers to another (`modifier_bunker_...` -> `... $bunker$ ...`),
  // so keep reading what the newly found texts name until nothing new turns up. Keys that do not
  // exist stay unread, and each round only asks for keys it has not asked for before.
  const asked = new Set(wanted)
  for (;;) {
    const unread = new Set(
      Object.values(names)
        .flatMap((text) => [...text.matchAll(REFERENCE)].map((m) => m[1]))
        .filter((key) => !(key in names) && !asked.has(key)),
    )
    if (unread.size === 0) break
    unread.forEach((key) => asked.add(key))
    await load(unread)
  }
  // Fill them in round by round (a text may only be complete after the ones it names are), up to
  // a depth that no real text reaches, so references that loop cannot go on forever.
  for (let round = 0; round < MAX_REFERENCE_DEPTH; round++) {
    let changed = false
    for (const key of Object.keys(names)) {
      const filled = names[key].replace(REFERENCE, (whole, ref: string) => names[ref] ?? whole)
      if (filled !== names[key]) {
        names[key] = filled
        changed = true
      }
    }
    if (!changed) break
  }
  return { names, rawNames }
}
