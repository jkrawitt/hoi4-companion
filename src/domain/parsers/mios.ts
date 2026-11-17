/**
 * Reading the military industrial organisations (MIOs) a country can use as design teams, from
 * `common/military_industrial_organization/organizations`. Each file defines MIOs:
 *
 *   <id> = {
 *     include = <another MIO>       copy its fields; this MIO's own fields win
 *     allowed = { ... }             which countries can have it (unknown terms count as allowed)
 *     available = { FROM = { has_completed_focus = X } }   when it can be used (`FROM` is the country)
 *     research_categories = { mio_cat_tech_... }
 *     initial_trait = { organization_modifier = { military_industrial_organization_research_bonus = N } }
 *   }
 *
 * The trait unlocks, policies, funds and size of a MIO are not read.
 */
import type { Check, EffectLine } from '../focus'
import { checkOfLines } from '../effects/conditions'
import { flattenEffects } from '../effects/lines'
import { GAME_PATHS, type GameFiles } from '../gameFiles'
import { isAllowed, readScriptedTriggers } from '../politicsImport'
import { expandTriggers, type ScriptedTriggers } from './politics'
import { getBlock, getString, parseScript, type ScriptBlock } from './paradoxScript'

/** A MIO as read: `MioData` before it is named. */
export interface RawMio {
  id: string
  researchCategories: string[]
  researchBonus: number
  available?: Check
  /** The `available` block as lines, to be written out in English. */
  availableLines: EffectLine[]
}

const RESEARCH_BONUS = 'military_industrial_organization_research_bonus'

/** The fields a MIO takes from the MIO it includes. */
interface Fields {
  allowed?: ScriptBlock
  available?: ScriptBlock
  categories?: string[]
  trait?: ScriptBlock
}

/** `FROM = { ... }` is the country: it is read as its contents. */
const unwrapFrom = (block: ScriptBlock): ScriptBlock =>
  block.flatMap((entry) => {
    if (typeof entry.value === 'string') return [entry]
    const inner = unwrapFrom(entry.value)
    return entry.key?.toLowerCase() === 'from' ? inner : [{ ...entry, value: inner }]
  })

const fieldsOf = (block: ScriptBlock): Fields => {
  const categories = getBlock(block, 'research_categories')
  return {
    allowed: getBlock(block, 'allowed'),
    available: getBlock(block, 'available'),
    categories: categories?.flatMap((e) =>
      e.key === null && typeof e.value === 'string' ? [e.value] : [],
    ),
    trait: getBlock(block, 'initial_trait'),
  }
}

const resolve = (id: string, defs: Map<string, ScriptBlock>, depth = 0): Fields => {
  const block = defs.get(id)
  if (!block) return {}
  const own = fieldsOf(block)
  const included = getString(block, 'include')
  const base = included && depth < 5 ? resolve(included, defs, depth + 1) : {}
  return {
    allowed: own.allowed ?? base.allowed,
    available: own.available ?? base.available,
    categories: own.categories ?? base.categories,
    trait: own.trait ?? base.trait,
  }
}

/** The MIOs of the files that the country (by tag and owned DLCs) can have. */
export const parseMios = (
  texts: string[],
  tag: string,
  ownedDlc: Record<string, boolean>,
  triggers: ScriptedTriggers = {},
): RawMio[] => {
  const defs = new Map<string, ScriptBlock>()
  for (const text of texts) {
    for (const entry of parseScript(text)) {
      if (entry.key !== null && typeof entry.value !== 'string' && !defs.has(entry.key)) {
        defs.set(entry.key, entry.value)
      }
    }
  }
  const mios: RawMio[] = []
  for (const id of defs.keys()) {
    // The debug copies of the generic MIOs ask `is_debug`, which the check machinery cannot answer.
    if (id.startsWith('DEBUG_')) continue
    const fields = resolve(id, defs)
    // `allowed` must name something: a MIO without one is a template (an `include` target).
    if (!fields.allowed) continue
    const allowed = checkOfLines(flattenEffects(expandTriggers(fields.allowed, triggers)))
    if (!isAllowed({ allowed }, tag, ownedDlc)) continue
    const availableLines = fields.available
      ? flattenEffects(expandTriggers(unwrapFrom(fields.available), triggers))
      : []
    const modifier = fields.trait && getBlock(fields.trait, 'organization_modifier')
    const bonus = Number(modifier ? getString(modifier, RESEARCH_BONUS) : 0)
    mios.push({
      id,
      researchCategories: fields.categories ?? [],
      researchBonus: Number.isFinite(bonus) ? bonus : 0,
      available: availableLines.length > 0 ? checkOfLines(availableLines) : undefined,
      availableLines,
    })
  }
  return mios
}

/** Reads every organizations file (a name starting with `_` is documentation) and keeps the country's MIOs. */
export const readMios = async (
  files: GameFiles,
  tag: string,
  ownedDlc: Record<string, boolean>,
): Promise<RawMio[]> => {
  const names = (await files.listFiles(GAME_PATHS.mios)).filter(
    (f) => f.endsWith('.txt') && !f.startsWith('_'),
  )
  const texts = await Promise.all(names.map((f) => files.readText(`${GAME_PATHS.mios}/${f}`)))
  return parseMios(
    texts.map((t) => t ?? ''),
    tag,
    ownedDlc,
    await readScriptedTriggers(files),
  )
}
