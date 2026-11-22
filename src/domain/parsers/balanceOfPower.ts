/**
 * Reads a country's balance of power from `common/bop`:
 *
 *   <id> = {
 *     initial_value = 0.1
 *     range = { id = X min = -0.1 max = 0.1 modifier = { ... } }      the middle
 *     side = { id = Y  range = { id = Z min max modifier = { ... } } } each side's ranges
 *   }
 *
 * Only the ranges and their modifiers are read. The file is the one named after the country tag.
 */
import type { BalanceOfPower, BopRange } from '../balanceOfPower'
import { flattenEffects } from '../effects/lines'
import { GAME_PATHS, type GameFiles } from '../gameFiles'
import { getAll, getBlock, getString, parseScript, type ScriptBlock } from './paradoxScript'

export type RawBalanceOfPower = Omit<BalanceOfPower, 'name' | 'ranges'> & {
  ranges: Omit<BopRange, 'name'>[]
}

const rangesOf = (block: ScriptBlock): Omit<BopRange, 'name'>[] =>
  getAll(block, 'range').flatMap((entry) => {
    if (typeof entry.value === 'string') return []
    const id = getString(entry.value, 'id')
    const min = Number(getString(entry.value, 'min'))
    const max = Number(getString(entry.value, 'max'))
    if (!id || !Number.isFinite(min) || !Number.isFinite(max)) return []
    const modifiers = flattenEffects(getBlock(entry.value, 'modifier') ?? []).map((m) => ({
      ...m,
      isModifier: true,
    }))
    return [{ id, min, max, modifiers }]
  })

/** The balances a `common/bop` file defines, ranges unnamed. */
export const parseBalancesOfPower = (text: string): RawBalanceOfPower[] =>
  parseScript(text).flatMap((entry) => {
    if (entry.key === null || typeof entry.value === 'string') return []
    const ranges = [
      ...rangesOf(entry.value),
      ...getAll(entry.value, 'side').flatMap((side) =>
        typeof side.value === 'string' ? [] : rangesOf(side.value),
      ),
    ]
    if (ranges.length === 0) return []
    const initial = Number(getString(entry.value, 'initial_value') ?? 0)
    return [{ id: entry.key, initial: Number.isFinite(initial) ? initial : 0, ranges }]
  })

/** The balance of power of the country, when its tag names a file in `common/bop`. */
export const readBalanceOfPower = async (
  files: GameFiles,
  tag: string,
): Promise<RawBalanceOfPower | undefined> => {
  const file = (await files.listFiles(GAME_PATHS.bop)).find((f) => f === `${tag}.txt`)
  const text = file ? await files.readText(`${GAME_PATHS.bop}/${file}`) : null
  return text ? parseBalancesOfPower(text)[0] : undefined
}
