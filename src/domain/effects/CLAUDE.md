# Effect pipeline and display (`src/domain/effects/`, `focusEffects.ts`)

A focus's reward is flattened into `EffectLine`s, run through a series of passes, and drawn by `EffectList.vue`. What was checked in game and what is only assumed is collected at the end, under [Verified in game](#verified-in-game) and [Assumptions and open questions](#assumptions-and-open-questions).

## Layout

- `focusEffects.ts` is a barrel over `src/domain/effects/`. Its header documents the whole effect pipeline in the order it runs.
- Inside `effects/`:
  - `lines.ts`: flattening, plus `opensBlock` / `blockEnd` / `childrenOf` / `outdent`, which every pass uses instead of hand-rolled index arithmetic.
  - `collapse.ts`, `passes.ts`, `conditions.ts`, `format.ts`, `ideaLines.ts`, `statKeys.ts`.
  - `modifierLines.ts` and `onlyWhatHappens.ts`, described below.

## Wording of effects

- Effects are humanized script lines, not translated to in-game wording, with reward values resolved to localised names.
- The wording of each effect lives in:
  - `effects/format.ts` (`FORMATTERS`, dispatched on the effect name; a formatter that returns null falls through to the generic `<key>: <value>`);
  - `effects/collapse.ts` (`COLLAPSERS`: header key to a one-line replacement, mostly built by the `aboutSubject` / `namedBy` factories).
- The tests show examples.
- To add a compound effect, add a collapser. For a one-word effect, add it to `LABELLED_EFFECTS` in `format.ts`.

## Definitions read by id

- Ideas (`parsers/ideas.ts`): the country's `ideasFile` first, then other `common/ideas` files only for ids still missing, with a plain `includes` check before parsing. Only the `modifier` and `rule` blocks are read, not `targeted_modifier`.
- Opinion modifiers, static modifiers (relation modifiers) and leader traits (`parsers/statBlocks.ts`): plain non-zero numbers only. Corps commander traits are not read.
- Their stats are listed beneath the line that applies them (`effects/modifierLines.ts`), reversed for removals (`reverseModifier`).
- `readDefinitions` is the shared helper, and `findBlocks` in `paradoxScript.ts` the layout-independent lookup.
- **`custom_modifier_tooltip`** in an idea's `modifier` block is the game's own text for something it cannot show as a stat (a support company bonus). The line has no `stat`, `nameLines.ts` names it from the key's localisation, `format.ts` shows that text, and nothing sums it.

## Stats (`stats.ts`)

All stats go through one pipeline. A `StatDefinition` (label, kind percent/number/flag, decimals, goodWhen) is resolved from these sources, in priority order:

1. `src/data/statOverrides.ts`. Extend this when a stat displays wrong.
2. The game's own tooltip text for the modifier (`<key>_tt`, or `modifier_<key>_tt`, asked for with every modifier line). `parseTooltipFormat` reads the value template, e.g. `$RIGHT|+=%1$`:
   - the first letter is the colour: `+` positive is good, `-` negative is good, any other letter is neutral (which clears a guessed direction);
   - `%` is percent, and `%%` is percent already in percentage points (`StatDefinition.percentPoints`, not multiplied by 100);
   - no `%` is a number, and a digit is the decimals;
   - a rule stays a flag.
3. The game's `documentation/modifiers_documentation.md`: decimals and booleans only, not percent vs number.
4. A guess: `_factor` keys and fractional values are percent.

Also:

- Labels come from the `<key>_tt` text first (it is what the game shows for that key, and tells `conscription` from `conscription_factor`, whose `MODIFIER_` names are swapped), then `MODIFIER_<KEY>` / `modifier_<key>` localisation, falling back to the humanized key.
- `defaultGoodWhen` sets the tone by key before the overrides: `*_cost_factor` is better lower, building construction speeds are better higher.
- Plain `key = number` effects (`STAT_EFFECT_KEYS`) also use this pipeline, so their labels live in `statOverrides.ts`.

## What is left out

- On purpose: `set_state_flag`, `add_ai_strategy`, the script variable effects (`set_variable`, `add_to_variable`, ... plain or in a block), array effects and `log`.
- `division_template` blocks (the focus tooltip already describes the unit).
- Any block left empty by that (`pruneEmptyBlocks`; a `limit` is not an effect).
- Everything inside `hidden_effect` is kept but marked `hidden`, and drawn grey and italic under a `Hidden effect:` header.

## Conditions (`foldConditions`)

- `foldConditions` runs after names are resolved. It folds a `limit` into the header it belongs to, as an English `condition`, and records the readable ones as data in `EffectLine.check`. A limit holding anything else stays raw.
- The headers it folds into: `if`, `else_if`, `every_other_country`, and the state scopes `every_` / `random_` `core_state`, `controlled_state`, `owned_state` and `state` (these read `Every core state where ...:`).
- A `limit` that is not the first line of its block is moved there first (`limitFirst`).
- An `if` with an empty limit (the game files comment the DLC check out) always applies, so its `else` branches are dropped and the body is shown.

## DLC branches and MIOs

- `resolveDlcConditions` resolves `has_dlc` for the DLCs in `src/data/dlc.ts` (`ownedDlc`, hard-coded). The branch that applies replaces the `if`.
  - Every name the game files check is listed, so every `has_dlc` is settled.
  - Together for Victory, Death or Dishonor, Waking the Tiger and Man the Guns are base game now and always on. The rest are the player's own, owned or not.
- **MIOs are base game** (since 1.14), so the political power planner always leaves out the tank, naval, aircraft and materiel designers (`MIO_SLOTS` in `politicsImport.ts`). The industrial and electronics concerns and the theorist stay.
- MIO effects such as `mio:<id> = { add_mio_funds }` are not formatted (they show as raw lines).
- The MIO import is described in `src/domain/parsers/CLAUDE.md`.

## Effect display

### Where it appears

- Hovering a card (`FocusTreeGraph.vue`) shows the description (`<id>_desc` localisation), prerequisites and the flattened `completion_reward` (`Focus.effects`). The plan shows the same lines.
- Both draw the reward as of its completion (`CountryState.focusEffects`), with the branches of `if` / `else` chains that do not apply dimmed and marked `(does not apply)` (`EffectList.vue`, from `EffectLine.branch`).
- A focus not in the plan shows a preview under `If added next`, with its missing prerequisites first.
  - It is worked out only on hover, by `previewFocusEffects` in `campaign/preview.ts`.
  - It does not rerun the research or political power planning, so `hasTech` and the purchases are the current campaign's.
- A focus blocked by exclusivity shows the raw lines.

### Display options (`components/focus/effectDisplay.ts`)

These are shared refs kept in localStorage.

- **Show branches that do not apply** (off by default): by default `EffectList.vue` leaves the skipped branches out entirely; the checkbox draws them dimmed again.
- **Show hidden effects** (`showHiddenEffects`, on by default): off drops every line marked `hidden` before the other two apply.
- **Simplify** (`simplifyEffects`, off by default, overrides the other two) runs the lines through `onlyWhatHappens` (`effects/onlyWhatHappens.ts`):
  - Skipped branches are dropped.
  - The header of the branch that applies is dissolved with its lines lifted a level (at any depth).
  - Blocks left empty go.
  - A `swap_ideas` block becomes plain `add idea` / `remove idea` lines. When it removes and adds an idea of the same name, it becomes `Replace idea X with X:` over a `Net change:` line and the summed modifiers (`replace_idea` / `net_change` in `format.ts`).
  - Chains the campaign could not settle carry no marks and stay as written.
- `EffectList.vue` draws all of it and colours good and bad changes.

## Verified in game

- None recorded for this area.

## Assumptions and open questions

- Not modelled for MIOs: trait unlocks, policies, funds and size.
- `ownedDlc` is hard-coded in `src/data/dlc.ts`; a DLC missing from it counts as not owned elsewhere (start state, `countryStateAt`).
