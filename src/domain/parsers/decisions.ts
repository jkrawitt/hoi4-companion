/**
 * Reading the decisions political power pays for (`common/decisions`): each file holds category
 * blocks, each holding decision blocks. A decision becomes a `RawOption` of kind `decision` whose
 * `slot` is its category and whose `modifiers` are its `complete_effect`, written out (scripted
 * effects expanded) like a focus reward. A decision with no `cost` is free; a variable or scripted
 * cost cannot be known, so it counts as free and carries `variableCost`. `visible` is kept on its
 * own (the game hides a decision on it but greys one out on `available`). Missions, targeted decisions (`targets`, `state_target`) and timeouts, cooldowns and
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

/** The categories of the `categories` files: each one's `allowed` and `visible` blocks, when it has them. */
export const parseDecisionCategories = (
  text: string,
  triggers: ScriptedTriggers = {},
): Record<string, { allowed?: Check; visible?: Check }> =>
  Object.fromEntries(
    parseScript(text).flatMap((e) => {
      if (e.key === null || typeof e.value === 'string') return []
      const allowed = getBlock(e.value, 'allowed')
      const visible = getBlock(e.value, 'visible')
      return [
        [
          e.key,
          {
            ...(allowed && { allowed: triggerOf(allowed, triggers).check }),
            ...(visible && { visible: triggerOf(visible, triggers).check }),
          },
        ],
      ]
    }),
  )

const decisionOption = (
  id: string,
  block: ScriptBlock,
  category: string,
  triggers: ScriptedTriggers,
  effects: ScriptedEffects,
): RawOption | undefined => {
  if (/^DEBUG_/i.test(id) || /debug/i.test(category)) return undefined
  if (UNMODELLED_KEYS.some((key) => block.some((e) => e.key === key))) return undefined
  // No `cost` is free; a variable or scripted one cannot be known, so it counts as free and is flagged.
  const rawCost = getString(block, 'cost')
  const parsedCost = rawCost === undefined ? 0 : Number(rawCost)
  const variableCost = !Number.isFinite(parsedCost)
  const cost = variableCost || parsedCost < 0 ? 0 : parsedCost
  // `allowed` and `visible` both rule a decision out for a country; `available` is what the
  // campaign answers on the day. Visible counts as part of it (a decision hidden is not takeable).
  const gate = [...(getBlock(block, 'allowed') ?? []), ...(getBlock(block, 'visible') ?? [])]
  const when = [...(getBlock(block, 'visible') ?? []), ...(getBlock(block, 'available') ?? [])]
  const allowed = gate.length > 0 ? checkOfLines(triggerOf(gate, triggers).lines) : undefined
  const available = triggerOf(when, triggers)
  const visible = getBlock(block, 'visible')
  const visibleCheck = visible ? triggerOf(visible, triggers).check : undefined
  const complete = getBlock(block, 'complete_effect') ?? []
  return {
    id,
    name: id,
    kind: 'decision',
    slot: category,
    group: 'decisions',
    cost,
    ...(variableCost && { variableCost: true }),
    ...(visibleCheck && { visible: visibleCheck }),
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
