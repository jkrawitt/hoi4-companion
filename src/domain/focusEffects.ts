/**
 * Turning a focus's `completion_reward` script into the lines the UI shows.
 *
 * The pipeline, in the order it runs:
 *
 * 1. `flattenEffects` turns the parsed script into a flat list of depth-annotated lines
 *    (`effects/lines.ts`, which also holds the helpers every later pass uses).
 * 2. `collapseEffects` folds compound effects into one line each and drops the ones a player is
 *    never shown (`effects/collapse.ts`).
 * 3. `unwrapEventConditions`, `simplifyRandomStates`, `pruneEmptyBlocks` and `markHidden` tidy
 *    what is left; `resolveDlcConditions` picks the branch that applies to the player's DLC
 *    (`effects/passes.ts`). Steps 1-3 happen in `focusTree.ts` and `gameImport.ts`.
 * 4. The importer resolves localised names and stat definitions onto the lines.
 * 5. `foldConditions` reads each `limit` as an English condition on its header, which needs
 *    those names, so it runs last (`effects/conditions.ts`).
 * 6. `formatEffect` and `effectTone` render a line for display (`effects/format.ts`).
 */
export {
  blockEnd,
  childrenOf,
  flattenEffects,
  humanize,
  isCountryTag,
  isOwnScope,
  opensBlock,
  outdent,
} from './effects/lines'
export { collapseEffects } from './effects/collapse'
export {
  markHidden,
  pruneEmptyBlocks,
  resolveDlcConditions,
  simplifyRandomStates,
  unwrapEventConditions,
} from './effects/passes'
export { foldConditions } from './effects/conditions'
export { effectTone, formatEffect } from './effects/format'
export {
  ideaIdsOf,
  ideaLineIndexes,
  removedIdeaLineIndexes,
  reverseModifier,
} from './effects/ideaLines'
export { defaultGoodWhen, isBuildingSpeedModifier, modifierNameKeys } from './effects/statKeys'
