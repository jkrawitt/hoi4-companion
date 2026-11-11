import type { Focus } from './focus'
import { parseFocusTreeFile } from './focusTree'
import { parseLocalisation } from './localisation'

/** Read-only view of a HoI4 installation folder. Paths use `/` and are relative to its root. */
export interface GameFiles {
  /** File contents, or null if the file does not exist. */
  readText(path: string): Promise<string | null>
  /** File names (not paths) directly inside a directory; empty if it does not exist. */
  listFiles(dir: string): Promise<string[]>
}

const LOCALISATION_DIR = 'localisation/english'

export class GameFolderError extends Error {}

/**
 * Reads a country's focus tree from the game files and attaches English display names.
 * Throws GameFolderError if the folder does not look like a HoI4 installation.
 */
export const importCountryFocuses = async (
  files: GameFiles,
  focusTreeFile: string,
): Promise<Focus[]> => {
  const treeText = await files.readText(focusTreeFile)
  if (treeText === null) {
    throw new GameFolderError(
      `Could not find ${focusTreeFile}. Choose the Hearts of Iron IV installation folder (the one containing "common" and "localisation").`,
    )
  }
  const focuses = parseFocusTreeFile(treeText)

  // Names can live in any localisation file; focus-named files are by far the likeliest.
  const wanted = new Set(focuses.map((f) => f.id))
  const names: Record<string, string> = {}
  const localisationFiles = (await files.listFiles(LOCALISATION_DIR)).filter((f) =>
    f.endsWith('.yml'),
  )
  const isFocusFile = (f: string) => f.toLowerCase().includes('focus')
  const batches = [
    localisationFiles.filter(isFocusFile),
    localisationFiles.filter((f) => !isFocusFile(f)),
  ]
  for (const batch of batches) {
    if (Object.keys(names).length >= wanted.size) break
    for (const file of batch) {
      const text = await files.readText(`${LOCALISATION_DIR}/${file}`)
      if (text !== null) Object.assign(names, parseLocalisation(text, wanted))
    }
  }

  return focuses.map((f) => ({ ...f, name: names[f.id] ?? f.id }))
}
