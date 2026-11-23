# Campaign state (`src/domain/campaign/`)

The campaign is the whole picture built from the plans. This folder settles what the country looks like on any date (`countryStateAt`), what its industry is (`industryAt`), runs the planners against each other (`planCampaign`) and merges their schedules (`buildTimeline`). What was checked in game and what is only assumed is collected at the end, under [Verified in game](#verified-in-game) and [Assumptions and open questions](#assumptions-and-open-questions).

## Industry (`industry.ts`)

`industryAt(production, state, techTotals, built)` returns factories per type, building slots per state and consumer goods.

### Factories and slots

- Factories are the start states plus instant focus builds plus the levels the construction queue finished by the state's date (`ConstructionSchedule.built`). Non-instant focus builds are listed as queued and are scheduled in the queue instead.
- Building slots per state are `floor(categorySlots * (1 + global_building_slots_factor))` (the factor from ideas and technologies) plus the focuses' extra slots.
- `industryAt` takes the trade of the date (`Industry.trade`, in `availableCivs`).

### Focus builds

- Focus builds come as `CountryState.construction` (`ConstructionBatch[]`), recorded in reward order by `recordBatches` in `applyReward.ts`. There is one batch per header block, with the numbered `state`, the `prefer` states, `random`, buildings, extra `slots` and resources. The country-wide totals stay as they were.
- `placeBatches` (exported, also returns each batch's `placements`) puts the batches into the state rows in order:
  - A numbered scope goes in its state (unplaced if the country does not own it).
  - A `random_owned_*` block goes in the first preferred state where, after its extra slots, the free shared slots hold its shared-slot buildings (queued builds reserve slots). Failing that, it goes in the fitting state with most free slots (lowest id on ties), and failing that the one with most free slots. Those last two are marked `guessed`.
- Slots are those of the viewed date, while the game decides with the slots of the completion date.
- Only instant builds count in a row (`fromFocuses` notes what was placed). Queued ones are listed in `queued` with their state, and `unplaced` holds what fits no state.

### Consumer goods

- `consumerGoodsFor` (`production.ts`, shared with the construction planner) gives `consumer_goods_expected_value * (1 + consumer_goods_factor + stability factor)` of civ + mil factories, rounded down, with the define minimums, capped at the civs.
- Above 50% stability, `stability_good_modifier`'s `consumer_goods_factor` (`common/modifiers/00_static_modifiers.txt`) applies, scaled from 0 at 50% to all of it at 100% (`stabilityConsumerFactor`).

### Stability

- Stability is `state.stability`, the actual value the overview shows. Without a start, it is `stabilityFrom(state.stabilityBeforeModifiers, stability_factor)` kept between 0 and 1.
- `stabilityFrom` (`totals.ts`) is the one formula: `stabilityBeforeModifiers` (the scripted part plus `BASE_STABILITY_PARTY_POPULARITY_FACTOR` x the ruling party's popularity, on `CountryState` and every `StateSnapshot`) plus the ideas' and leader's `stability_factor`.
- Technologies do not change stability (no `stability_factor` in `common/technologies` in the 1.x install). A mod that adds it would belong in `countryStateAt`.

## `countryStateAt`

`countryState.ts` only runs the rewards in order and totals them. The other files:

- `applyReward.ts`: what one reward does, as a list of handlers over a `Working` state. A new kind of effect is a new handler.
- `rewardScopes.ts`: sorts a reward's lines into certain and conditional.
- `types.ts`: the shapes.

### The simulation (`simulateCountry`)

- `countryStateAt(schedule, date, options)` is `simulateCountry(schedule, options).at(date)`. A planner that asks about hundreds of dates (`planPolitics`, the store's `stateOn`, `unavailableInPlan`, the MIO questions of `planResearch`) makes one simulation and asks it, instead of replaying the country from 1936 each time (Finland with 40 focuses, 8 purchases and 30 techs took about 150 s in `planCampaign`, and takes under 2 s now).
- It keeps one running country (the cursor) and carries it on for a later date. For an earlier date it goes back to the latest checkpoint on or before it: a copy of the country (`cloneWorking`) taken after every reward applied and every `CHECKPOINT_DAYS` (28) of drift. All steps (focuses, `extraSteps`, `adjustments`) are ordered once; the date only decides how many are applied.
- `addStep(step)` adds a purchase as an `extraSteps` entry (after the earlier ones) and drops the checkpoints from its day on, which is all it can change. `planPolitics` adds each purchase at its current day, which never moves back, so most checkpoints stay.
- A state handed out is not changed by later questions: `stateFrom` copies what the cursor goes on changing (`statChanges` totals, the lists), and `research` (the environment) is worked out when first read, since it is the costliest part and the planners of political power never read it.
- Without `startDate` the start is finished on the date asked for, so nothing can be reused and each date is its own run (only tests do this).
- Checked: `countrySimulation.test.ts` compares the simulation, asked in any order, with a fresh `countryStateAt` (also after `addStep`). Assumed: a `Working` field that is mutated in place is one of the copies in `cloneWorking`; a new one that is mutated in place must be added there.
- `accrueDrift` gives the same result however the time is split (the drift map is taken again the day after the balance of power moves into another range, since the range's modifiers can carry a party drift). Before, it was taken once per stretch between idea expiries, which made the result depend on where a call split the time.

It applies the rewards of the focuses completed by a date. With `options.start` / `startDate`, the start lines are applied first as a step with id `START_ID`, so stat totals and popularity are absolute (start plus plan).

### What counts

- Top-level lines and those inside `hidden_effect` or the country's own scope count.
- `if` / `else` / `random_*` / `every_*` blocks are only listed (`conditional`). The exception is `add_resource`, `add_building_construction` and building slots, which are always collected: top-level, inside a `random_owned_*state` block (which picks one of the country's own states), and inside a numbered state scope `46 = { ... }`. Those are summed per type, with instant builds counted apart.
- Other countries' scopes, state scopes and other countries' characters are skipped.
- Ideas are added, removed or (`add_timed_idea`) expire, and their modifiers are summed. A leader's traits are the leader's, not one-off stat changes, and their stats are summed into the modifier totals.

### Party drift (`drift.ts`)

- `<party>_drift` modifiers (`fascism_drift = 0.1` on a spirit, advisor or leader trait) add that many percentage points to the party a day while active, taken from the others like any change.
- `accrueDrift` runs it day by day (one tick per midnight, the drift map taken again where timed ideas expire or the balance changes range) between the rewards and purchases that `countryStateAt` applies and up to the viewed date. It runs from the start on; nothing drifts without the start. The hire day itself does not drift.
- **Daily drift is scaled above 20% and 30%:** a party above 20% drifts up at half its drift and above 30% at a third (`scaledDrift`, `DRIFT_SCALES` in `applyReward.ts`, used by `accrueDrift`). Losses are not scaled.
- An `add_popularity` effect is not scaled.
- **Popularity always adds up to 100%:** once the start has set the parties, an `add_popularity` change to one is taken from (or given back to) the others in proportion to their share, kept between 0 and 100% (the `popularity` handler in `applyReward.ts`). Without a start the changes are plain sums.
- The overview shows popularity cut to two decimals like the game, with the exact value beside it.
- The weekly balance of power drift is in `drift.ts` too; see `src/domain/parsers/CLAUDE.md`.

### Research events (`researchEvents.ts`)

- As each reward is applied, it records:
  - the slots (the `add_research_slot` total, which includes the start);
  - the research speed (`research_speed_factor` of the ideas and leader traits, also at each timed idea's expiry);
  - `set_technology` grants (the start's become `startTechs`);
  - `add_tech_bonus` bonuses, numbered per focus in the order they happen (`BonusRef = { focusId, index }`).
- `CountryState.research` is that environment, so `countryStateAt(schedule, finish)` gives the whole timeline.
- `researchEvents.ts` also turns the ideas' `researchBonus` into `categorySpeed`.
- `research.ts` has `planResearch`, which reads the environment at the later of the last focus and the last purchase. It settles `has_tech` and the schedule together: pass one leaves `has_tech` unanswered, and each later pass answers it (`options.hasTech(id, date)`, from the previous schedule's `researchedBy`) until the schedule stops changing, at most 3 passes.
- `researchStatusAt` is what the overview's Research section shows.

### Purchases in the state

- `CountryStateOptions.extraSteps` (the purchases) are applied in date order with the completed focuses, a focus first on the same day.
- `options.politics` (`PoliticsData`) gives slot sizes and seeds the recruited characters; a `recruit_character` reward adds to them. An idea added with a `slot` that is full pushes out the oldest in it, so a new law replaces the old one.
- `CountryState.politics` is `{ held (active ideas by slot), recruited }`. `ActiveIdea` has `slot` / `researchBonus`, and `CountryState.government` is the ruling group.
- `planCampaign` runs `planPolitics` then `planResearch` (given the purchases as `extraSteps`) until neither schedule changes, at most 4 passes, with `has_tech` answered from the previous research schedule.
- `options.ownedDlc` answers `has_dlc` (unlisted counts as not owned).

### Adjustments (what the player saw in game)

- Types, `adjustmentSteps` and `tradeOverTime` are in `domain/adjustments.ts`. The store keeps them as `adjustments` (saved, cleared when the country changes, edited with `addAdjustment` / `removeAdjustment`).
- `adjustmentSteps` turns each into a `Step` for `CountryStateOptions.adjustments` (in `stateOptions`, so `planPolitics`, `planResearch`, `finalState` and the overview all get them through `options`). They are merged in `countryStateAt` after a focus and a purchase of the same day. `planPolitics` treats their dates as change points, and `planResearch` reads the environment no earlier than the last one.
- A stability entry (`StabilityAdjustment.value` is a fraction) is a `set_actual_stability` line. The `setActualStability` handler in `applyReward.ts` adds `target - current` to `add_stability`, with `current` being `rawCountryStat` (unclamped) at that moment. The actual stability is therefore the target on that date whatever the plan did before, and later rewards move on from it.
- An event modifier is an `add_timed_idea` (or `add_ideas` without days) named `adjust:<id>` with one modifier line from `ADJUSTABLE_STATS`, so it shows among the national spirits and is summed and expires like a real one.
- `finalState` is taken at the later of the plan's end and the last adjustment, so the construction factors see them.
- The UI is `components/overview/AdjustmentsPanel.vue` under the date scrubber, and the timeline lists them as `adjustment` entries.

## Conditions (`conditions.ts`)

### Resolving a reward's conditions

- `resolveConditions` settles each `EffectLine.check` against what the campaign knows when the focus completes. It only does so for a chain in the country's own scope: top level, `hidden_effect`, the country's tag, `ROOT` / `THIS` and branches of such chains. Inside `every_other_country`, another country, a state scope or a character, the limit asks about something else, so the chain is left as written.
- `annotateConditions` makes the same decision per chain (one `readChain` / `decideChain` for both) but keeps every line and marks `EffectLine.branch`: `applies` on the header of the branch that runs, `skipped` on every line of the branches that do not, nothing from an unanswered branch on.
- `applyReward` computes it with the same context for each planned focus, and `CountryState.focusEffects` holds it by focus id (not for the start, purchases or adjustments).
- It uses the state before the focus's own effects, so a popularity change and an `if` on it in the same reward see the old value.
- The branch that applies replaces the whole chain and counts like any other lines. A chain that cannot be settled stays from its first unanswered branch on (a leading `else_if` becomes an `if`) and is listed as conditional.
- Evaluation is three-valued (`evaluateCheck`: true, false or undefined); one decisive term settles an `all` / `any` beside an unknown one.

### What it answers

- Ideas active, focuses completed earlier in the plan, the ruling party so far, `original_tag` / `tag`, `has_dlc` (`ownedDlc`), `always`, and who leads.
- Popularity and `has_war_support` / `has_stability` (`CountryState.stability` / `warSupport`, see `countryStat`), once the start has set them.
- `has_tech`, from `options.hasTech` (the research schedule, see above). Without it the branch stays conditional.
- `ROOT = { ... }` in a condition is read as its contents (ROOT is always our country).
- A term like `not_already_hired_except_as` is `unknown`.
- Not answered yet: factions and other countries' state (their leaders).

### Triggers (`checkOfLines`)

- `checkOfLines` (`effects/conditions.ts`) reads a whole trigger block (an `available` or `allowed`).
  - `if` / `else_if` / `else` chains inside a trigger are read as `any(not limit, body)` / `any(all(limit, body), all(not limit, else))`.
  - `hidden_trigger` and `custom_trigger_tooltip` are read as their terms (all required).
- `has_war` is a `war` check that only the political power planner answers (`atWar: false`, purchases are planned for peace), so focus rewards leave it unknown.
- The politics import writes scripted triggers (`common/scripted_triggers`, e.g. `PHI_SEA = yes`) out in place before reading `available` / `allowed` (`expandTriggers` in `parsers/politics.ts`).

### State control

- `controls_state` / `has_full_control_of_state` / `owns_state = <id>` (a `state` check) is true for the states in `options.ownedStates` (the importer's start states) and unknown otherwise.
- Claims, wars and transfers are not tracked.

### Country flags

- `set_country_flag` / `clr_country_flag` are kept on the line with `EffectLine.bookkeeping` (not shown: `EffectList.vue` filters them, `pruneEmptyBlocks` ignores them).
- The `countryFlags` handler records them in `Working.flags`, so `has_country_flag = X` (a `flag` check) is true or false once a reward of the plan has set or cleared it, and unknown before.
- The block form with `days` is unknown.

### Wars

- Wars are entered by hand: `WarAdjustment` in `adjustments.ts` has a date and the enemy tags, or none for peace, and replaces the entry before. It is applied as a `set_enemies` line by the `setEnemies` handler into `Working.enemies` / `CountryState.enemies`.
- `has_war` and `has_war_with = TAG` (`war_with` check) are answered from them, and stay unknown until the first entry, so the plan never assumes a war (no hardcoded dates).

## Leaders

- `has_country_leader = { id = N }` / `{ character = X }` is answered from `identity`:
  - `create_country_leader` carries its `id` as `EffectLine.leaderId`.
  - `promote_character` and `add_country_leader_role` give a character.
  - It is unknown again after `retire_country_leader`, since the game picks the next leader.
  - A character never matches a legacy id, so in a 1936 start `id = 550` (Carol II, only created in the `1939.1.1` block) is false.
- The game picking a new leader is modelled from `ImportedCountry.leaders` (`LeaderData`, passed on as `options.leaders`): the recruited characters with a `country_leader` role, in order, as named `promote_character` lines grouped by ideology group, plus the sub-ideology to group map.
  - When a reward retires the leader, or changes the ruling party to one the leader does not lead for, and does not make a leader itself, the leader becomes the first candidate of the ruling party who has not been retired.
- `CountryState.leader` is `{ name, ideology, traits }`, and the overview shows it in its own Leader section.

## Timeline (`timeline.ts`)

- `buildTimeline` merges every planner's schedule into game days. Each day has what finished (`done`) and what starts (`todo`, the player's next actions; focus builds are `automatic`), plus counts of what never happens.
- Every entry has an `id` with no date in it: `focus:<id>`, `research:<tech>`, and for the queues the player orders, the item's own `id` from `domain/queue.ts` `withIds` (given on add and on load, kept through moves and edits; `moveItem` there is the one move up/down of every queue).
- That keeps the actions the player checks off as done in game (`checkedOff` in the store, saved with the campaign, cleared when the country changes) checked when the plan moves.
- The store exposes it as `timeline`; `wholeDay` in `calendar.ts` is the day an instant falls on.

## Verified in game

- Consumer goods and stability (Romania 1936): 69% stability gives -7.6%, and 32.3% of 18 factories = 5.
- Drift scaling (Finland): fascism 19% at the start, 20.80% on 1 March with Susitaival hired 4 February, 26.30% on 11 March, 32.21% on 29 July. The 20% and 30% thresholds are read from those cases.
- An `add_popularity` effect is not scaled: the coup focus added its full 5 points (21.3 + 5 = 26.3 on 11 March).

## Assumptions and open questions

- Consumer goods: the define minimums are not checked.
- A numbered state scope `46 = { ... }` is assumed to be the country's own. Add an escape hatch if that turns out wrong.
- What happens to drift past 40% is not known.
- Placement of focus builds uses the slots of the viewed date, while the game uses the slots of the completion date; the `guessed` placements are heuristics.
- A state held at the start is assumed kept (see State control).
- Events and other countries' scripts can set country flags too, and are not modelled.
