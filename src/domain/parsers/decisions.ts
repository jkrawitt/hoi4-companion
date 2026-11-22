/**
 * Reading the decisions political power pays for (`common/decisions`): each file holds category
 * blocks, each holding decision blocks. A decision becomes a `RawOption` of kind `decision` whose
 * `slot` is its category and whose `modifiers` are its `complete_effect`, written out (scripted
 * effects expanded) like a focus reward. Only decisions with a plain political power `cost` are
 * kept: a cost that is a variable or a scripted expression cannot be known, so the decision is
 * dropped. Missions, targeted decisions (`targets`, `state_target`) and timeouts, cooldowns and
 * `remove_effect` are not modelled.
 */
import type { Check } from '../focus'
import { flattenEffects } from '../effects/lines'
import { checkOfLines } from '../effects/conditions'
import { expandEffects, type ScriptedEffects } from './scriptedEffects'
import { triggerOf, type RawOption, type ScriptedTriggers } from './politics'
import { getBlock, getString, parseScript, type ScriptBlock } from './paradoxScript'

/** A decision with any of these is per target or a timed mission, which the planner does not model. */
const UNMODELLED_KEYS = [
  'targets',
  'target_array',
  'targets_dynamic',
  'state_target',
  'target_trigger',
  'days_mission_timeout',
  'selectable_mission',
]

/** The categories of the `categories` files: each one's `allowed` block, when it has one. */
export const parseDecisionCategories = (
  text: string,
  triggers: ScriptedTriggers = {},
): Record<string, { allowed?: Check }> =>
  Object.fromEntries(
    parseScript(text).flatMap((e) => {
      if (e.key === null || typeof e.value === 'string') return []
      const allowed = getBlock(e.value, 'allowed')
      return [[e.key, allowed ? { allowed: triggerOf(allowed, triggers).check } : {}]]
    }),
  )

const decisionOption = (
  id: string,
  block: ScriptBlock,
  category: string,
  triggers: ScriptedTriggers,
  effects: ScriptedEffects,
): RawOption | undefined => {
  if (UNMODELLED_KEYS.some((key) => block.some((e) => e.key === key))) return undefined
  const cost = Number(getString(block, 'cost'))
  if (!Number.isFinite(cost) || cost <= 0) return undefined
  // `allowed` and `visible` both rule a decision out for a country; `available` is what the
  // campaign answers on the day. Visible counts as part of it (a decision hidden is not takeable).
  const gate = [...(getBlock(block, 'allowed') ?? []), ...(getBlock(block, 'visible') ?? [])]
  const when = [...(getBlock(block, 'visible') ?? []), ...(getBlock(block, 'available') ?? [])]
  const allowed = gate.length > 0 ? checkOfLines(triggerOf(gate, triggers).lines) : undefined
  const available = triggerOf(when, triggers)
  const complete = getBlock(block, 'complete_effect') ?? []
  return {
    id,
    name: id,
    kind: 'decision',
    slot: category,
    group: 'decisions',
    cost,
    ...(getString(block, 'fire_only_once') === 'yes' && { fireOnce: true }),
    modifiers: flattenEffects(expandEffects(complete, effects)),
    ...(allowed && { allowed }),
    ...(available.check && { available: available.check, availableLines: available.lines }),
  }
}

/** The decisions of one `common/decisions` file: `<category> = { <decision> = { ... } }`. */
export const parseDecisions = (
  text: string,
  triggers: ScriptedTriggers = {},
  effects: ScriptedEffects = {},
): RawOption[] =>
  parseScript(text).flatMap((category) =>
    category.key === null || typeof category.value === 'string'
      ? []
      : category.value.flatMap((decision) => {
          if (decision.key === null || typeof decision.value === 'string') return []
          const option = decisionOption(
            decision.key,
            decision.value,
            category.key!,
            triggers,
            effects,
          )
          return option ? [option] : []
        }),
  )
