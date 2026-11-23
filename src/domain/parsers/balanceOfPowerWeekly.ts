/**
 * Reads how a balance of power drifts a week. A country's `on_weekly_<TAG>` on action (in
 * `common/on_actions`) has a chain of branches, one for each leader:
 *
 *   if = {
 *     limit = { has_country_leader = { ruling_only = yes character = FIN_x } }
 *     if = { limit = { communism > 0.09 } add_power_balance_modifier = { modifier = M } }
 *     ...
 *   }
 *
 * and each modifier (`common/modifiers`) has a `power_balance_weekly`. A rule is a modifier, the
 * leader whose branch adds it, and the conditions of the `if`s around it. The guards that stop a
 * modifier being added twice (`NOT = { has_power_balance_modifier = ... }`) are left out, and so
 * is what removes a modifier: the rule holds exactly while its conditions do. A scripted effect call
 * such as the one for losing cores is not read.
 */
import type { BopWeeklyRule } from '../balanceOfPower'
import type { Check } from '../focus'
import { checkOfLines } from '../effects/conditions'
import { flattenEffects } from '../effects/lines'
import { GAME_PATHS, type GameFiles } from '../gameFiles'
import {
  findBlocks,
  getAll,
  getBlock,
  getString,
  parseScript,
  type ScriptBlock,
} from './paradoxScript'

/** Whether a block asks about the modifiers already on the balance, anywhere inside. */
const asksAboutModifiers = (block: ScriptBlock): boolean =>
  block.some(
    (e) =>
      e.key === 'has_power_balance_modifier' ||
      (typeof e.value === 'object' && asksAboutModifiers(e.value)),
  )

/** A `limit` as one check, without the guards about modifiers; undefined when nothing is left. */
const limitCheck = (limit: ScriptBlock): Check | undefined => {
  const kept = limit.filter((e) => !(typeof e.value === 'object' && asksAboutModifiers(e.value)))
  return kept.length === 0 ? undefined : checkOfLines(flattenEffects(kept))
}

const allOf = (checks: Check[]): Check | undefined =>
  checks.length === 0 ? undefined : checks.length === 1 ? checks[0] : { type: 'all', of: checks }

/** The character a branch is for: `has_country_leader = { character = X }` in its limit. */
const leaderOf = (limit: ScriptBlock): string | undefined => {
  for (const e of limit) {
    if (e.key === 'has_country_leader' && typeof e.value === 'object') {
      const character = getString(e.value, 'character')
      if (character) return character
    }
    if (typeof e.value === 'object') {
      const inner = leaderOf(e.value)
      if (inner) return inner
    }
  }
  return undefined
}

interface Found {
  leader: string
  modifier: string
  when?: Check
}

/** The modifiers added in a branch, with the conditions of the `if`s around each. */
const modifiersIn = (block: ScriptBlock, leader: string, around: Check[]): Found[] => {
  const found: Found[] = []
  // The limits of the `if` and `else_if` branches before, which an `else_if` or `else` negates.
  let earlier: (Check | undefined)[] = []
  for (const entry of block) {
    if (typeof entry.value !== 'object') continue
    if (entry.key === 'add_power_balance_modifier') {
      const modifier = getString(entry.value, 'modifier')
      if (modifier) found.push({ leader, modifier, when: allOf(around) })
      continue
    }
    if (entry.key !== 'if' && entry.key !== 'else_if' && entry.key !== 'else') continue
    const limit = getBlock(entry.value, 'limit')
    const own = limit ? limitCheck(limit) : undefined
    if (entry.key === 'if') earlier = []
    const negated = earlier.flatMap((c): Check[] => (c ? [{ type: 'not', of: c }] : []))
    const checks = [...negated, ...(own ? [own] : [])]
    earlier.push(own)
    const body = entry.value.filter((e) => e.key !== 'limit')
    found.push(...modifiersIn(body, leader, [...around, ...checks]))
  }
  return found
}

/** The weekly rules in the text of an on actions file, for the country `tag`. */
export const parseWeeklyRules = (text: string, tag: string): Found[] => {
  const weekly = `on_weekly_${tag}`
  const find = (block: ScriptBlock): ScriptBlock | undefined => {
    for (const e of block) {
      if (typeof e.value !== 'object') continue
      if (e.key === weekly) return e.value
      const inner = find(e.value)
      if (inner) return inner
    }
    return undefined
  }
  const effect = getBlock(find(parseScript(text)) ?? [], 'effect')
  if (!effect) return []
  // The chain of branches, one for each leader.
  return effect.flatMap((entry) => {
    if (typeof entry.value !== 'object') return []
    if (entry.key !== 'if' && entry.key !== 'else_if') return []
    const limit = getBlock(entry.value, 'limit')
    const leader = limit && leaderOf(limit)
    if (!leader) return []
    return modifiersIn(
      entry.value.filter((e) => e.key !== 'limit'),
      leader,
      [],
    )
  })
}

/** The weekly rules of the country, with each modifier's `power_balance_weekly`. */
export const readWeeklyRules = async (files: GameFiles, tag: string): Promise<BopWeeklyRule[]> => {
  const found: Found[] = []
  for (const file of await files.listFiles(GAME_PATHS.onActions)) {
    const text = await files.readText(`${GAME_PATHS.onActions}/${file}`)
    if (text?.includes(`on_weekly_${tag}`)) found.push(...parseWeeklyRules(text, tag))
  }
  if (found.length === 0) return []
  const wanted = new Set(found.map((f) => f.modifier))
  const drift = new Map<string, number>()
  for (const file of await files.listFiles(GAME_PATHS.staticModifiers)) {
    const text = await files.readText(`${GAME_PATHS.staticModifiers}/${file}`)
    if (!text?.includes('power_balance_weekly')) continue
    for (const [id, block] of Object.entries(findBlocks(text, wanted))) {
      const value = Number(getAll(block, 'power_balance_weekly')[0]?.value)
      if (Number.isFinite(value)) drift.set(id, value)
    }
  }
  return found.flatMap((f) => {
    const weekly = drift.get(f.modifier)
    return weekly ? [{ ...f, weekly }] : []
  })
}
