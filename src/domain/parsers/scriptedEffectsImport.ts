import { GAME_PATHS, type GameFiles } from '../gameFiles'
import { parseScriptedEffects, type ScriptedEffects } from './scriptedEffects'

/** Every scripted effect of the install (files are cheap to parse, and calls cross countries). */
export const readScriptedEffects = async (files: GameFiles): Promise<ScriptedEffects> => {
  const names = (await files.listFiles(GAME_PATHS.scriptedEffects)).filter((f) =>
    f.endsWith('.txt'),
  )
  const texts = await Promise.all(
    names.map((f) => files.readText(`${GAME_PATHS.scriptedEffects}/${f}`)),
  )
  return Object.assign({}, ...texts.map((t) => parseScriptedEffects(t ?? '')))
}
