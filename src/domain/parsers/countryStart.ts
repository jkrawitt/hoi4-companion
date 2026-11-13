/**
 * What a country starts the 1936 game with, read from its `history/countries/<TAG> - *.txt` file
 * and written as the same effect lines a focus reward is, so ideas and stats go through the one
 * pipeline (names, modifiers, stat definitions) and `countryStateAt` applies them like a reward.
 *
 * Read: starting ideas (`add_ideas`), stability, war support and research slots, the ruling party
 * and the popularities. Skipped: technologies, characters, orders of battle, and everything inside
 * a dated block (`1939.1.1 = { ... }`), which is the later start.
 *
 * A top-level `if = { limit = { has_dlc = X } ... }` is kept or dropped by `ownedDlc`; a DLC
 * that is not listed there counts as not owned, and any other kind of condition is dropped.
 */
import type { EffectLine } from '../focus'
import { blockEnd, childrenOf, flattenEffects, opensBlock, outdent } from '../effects/lines'
import { resolveDlcConditions } from '../effects/passes'
import { parseScript } from './paradoxScript'

/** Effects of the form `key = number` that set a stat, and the additive stat each becomes. */
const SET_STATS: Record<string, string> = {
  set_stability: 'add_stability',
  set_war_support: 'add_war_support',
  set_research_slots: 'add_research_slot',
}

/** The DLC a block's `limit` asks for, when that is all it asks for. */
const dlcOf = (lines: EffectLine[], index: number): string | undefined => {
  const limit = lines[index + 1]
  if (!opensBlock(limit, 'limit')) return undefined
  const inside = childrenOf(lines, index + 1)
  return inside.length === 1 && inside[0].key === 'has_dlc' ? inside[0].value : undefined
}

const pick = (lines: EffectLine[], ownedDlc: Record<string, boolean>): EffectLine[] => {
  const result: EffectLine[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const end = blockEnd(lines, i)
    if (line.key === 'if' && opensBlock(line)) {
      const dlc = dlcOf(lines, i)
      if (dlc !== undefined && ownedDlc[dlc]) {
        const body = lines.slice(blockEnd(lines, i + 1), end)
        const otherwise = body.findIndex((l) => l.depth === line.depth + 1 && l.key === 'else')
        result.push(...pick(outdent(otherwise === -1 ? body : body.slice(0, otherwise)), ownedDlc))
      }
    } else if (line.key === 'add_ideas') {
      result.push(...lines.slice(i, end))
    } else if (line.key !== null && line.value !== undefined && line.key in SET_STATS) {
      result.push({ depth: 0, key: SET_STATS[line.key], value: line.value, isModifier: true })
    } else if (opensBlock(line, 'set_politics')) {
      const party = childrenOf(lines, i).find((l) => l.key === 'ruling_party')?.value
      if (party) result.push({ depth: 0, key: 'set_politics', value: party })
    } else if (opensBlock(line, 'set_popularities')) {
      for (const field of childrenOf(lines, i)) {
        const percent = Number(field.value)
        if (field.key && Number.isFinite(percent)) {
          result.push({
            depth: 0,
            key: 'add_popularity',
            subject: field.key,
            value: String(percent / 100),
            isModifier: true,
          })
        }
      }
    }
    i = end - 1
  }
  return result
}

export const parseStartingLines = (
  text: string,
  ownedDlc: Record<string, boolean> = {},
): EffectLine[] => {
  const topLevel = parseScript(text).filter((entry) => !/^\d{4}\./.test(entry.key ?? ''))
  return pick(resolveDlcConditions(flattenEffects(topLevel), ownedDlc), ownedDlc)
}
