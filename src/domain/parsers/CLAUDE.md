# Game import: parsers and importers (`src/domain/parsers/`, `gameImport.ts`)

The importer reads the user's own Hearts of Iron IV install and turns it into `ImportedCountry` (`{ focuses, start, leaders, research, politics, production, balanceOfPower, mios, laws }`), cached in IndexedDB. What was checked in game and what is only assumed is collected at the end, under [Verified in game](#verified-in-game) and [Assumptions and open questions](#assumptions-and-open-questions).

## Pipeline

### Generic pieces

- `parsers/paradoxScript.ts` is a generic parser for Paradox script. It keeps duplicate keys and order. `findBlocks` is the layout-independent lookup.
- The other files in `parsers/` each read one kind of definition out of it, and are used only by `gameImport.ts`.
- `parsers/localisation.ts` reads `.yml` names.
- `parsers/focusTree.ts` extracts `Focus` objects from a `common/national_focus` file.
  - Cost is in weeks, converted to days.
  - Each `prerequisite = { ... }` block is an OR group, and multiple blocks are ANDed.
- `parsers/scriptedEffects.ts` (`expandEffects`, read by `parsers/scriptedEffectsImport.ts` from `common/scripted_effects`) writes each scripted effect call out in a focus's reward before it is flattened (`FIN_x_effect = yes` or `= { ARG = 3 }`, `$ARG$` filled in, nested calls too). Its contents therefore go through every pass like any other effect.

### `gameImport.ts`

It ties these together, in phases:

1. Parse the tree.
2. Read the definitions its effects refer to.
3. Read the countries and events it mentions.
4. Load localisation.
5. Put names and stat definitions onto the effect lines (`nameLines.ts`; `effects/modifierLines.ts` lists the stats of ideas, relation modifiers and leader traits beneath the lines applying them).

The start lines and leader candidates go through every phase as lists of lines of their own. Its helpers live in:

- `gameFiles.ts`: the `GameFiles` interface of `readText` / `listFiles`, and `GAME_PATHS`.
- `definitions.ts`: `readDefinitions`, `readCountryHistory`.
- `names.ts`: loading localised text.

Every path the importer reads is listed once in `GAME_PATHS`. The non-Chromium folder fallback derives its filter from it (`READ_PATH_PREFIXES`), so adding a directory there makes it readable in every browser.

## Starting state (`countryStart.ts`)

- It reads the 1936 part of `history/countries/<TAG> - *.txt` as effect lines: starting `add_ideas`, `set_stability` / `set_war_support` / `set_research_slots`, `set_politics`, `set_popularities`, and `set_technology` as an unlock line. It does not read characters, OOBs or dated `1939.1.1` blocks.
- Stats become the additive keys (`add_stability`, ...) and popularities become `add_popularity` fractions.
- A top-level `if = { limit = { has_dlc = X } }` follows `ownedDlc` (a DLC missing from `dlc.ts` counts as not owned).
- `importCountryFocuses` returns `{ focuses, start, leaders, research }` (`ImportedCountry`). The start lines ride through the same name, modifier and stat passes as lines of their own and are cached with the focuses. `ImportTarget` needs the country `tag`.
- The starting leader is a `promote_character` line the importer adds (`parsers/leaders.ts`): the first `recruit_character` in the history whose `common/characters/<TAG>.txt` `country_leader` ideology belongs to the ruling party (sub-ideology to group via `common/ideologies`).
- `CountryState.leader` is `{ name, ideology, traits }`. Traits listed beneath a `create_country_leader` / `add_country_leader_role` count as the leader's, not as one-off stat changes, and their stats are summed into the modifier totals. The overview shows it in its own Leader section.

## Research import (`technologies.ts`)

- `readTechnologies` reads:
  - every file of `common/technologies`;
  - the folders from `common/technology_tags`: a folder's `available` picks the DLC variant by `ownedDlc` (BBA air, MtG navy, No Step Back armour), and doctrine folders are left out;
  - `NTechnology` from `common/defines/00_defines.lua` (by regex, with fallbacks).
- `@variables` in positions (`y = @1936`) are defined per file, in the `technologies` block, and resolved in file order.
- **Parents:** a tech lists the techs it leads to, so its parents are found by turning those around.
  - **All parents together are one OR group:** any one opens the tech. The tank and cruiser lines lead to each other, so AND would deadlock.
  - A `dependencies` entry is a group of its own (AND).
  - `XOR` gives `exclusiveWith`.
- A tech can sit in several folders (`Technology.folders`).
- **A folder is several trees:** a tech's `position` is relative to the grid box of its tree in `interface/countrytechtreeview.gui` (`gridboxtype` named `<root tech>_tree` inside the folder's window, in 70px slots).
  - `placeInTrees` assigns each tech to the first tree whose root leads to it and stores absolute slot coordinates.
  - A box with `format = "LEFT"` (the army folders) runs sideways: the tech's `y` (its year) becomes the column, and the folder is marked `sideways` for the connectors.
- `researchable` is false for special projects, `allow = { always = no }` and techs with no available folder (sub-technologies have none).
- Names come from localisation, falling back to the name of the first equipment the tech unlocks, then the id. Stats are plain numbers only (`statBlocks.ts`).
- `ImportedCountry.research` (`ResearchData`) is the same for every country but cached with each.
- The start techs are `set_technology` lines in `countryStart.ts` (`research.kind = 'unlock'`, also inside top-level `has_dlc` branches). A top-level `add_political_power` is read too (the starting balance).

## Politics import (`politics.ts`, `politicsImport.ts`)

### What is read (`parsers/politics.ts`)

- `PoliticalOption`s (`politics.ts`) for what political power buys:
  - **Laws:** the `law = yes` categories of `common/ideas/_economic.txt` and `_manpower.txt`. `default = yes` marks the starting law.
  - **Designers and industrial concerns:** the slot categories of the country's ideas file and `zzz_generic.txt`, with `research_bonus`.
  - **Advisors:** the `advisor` block of `common/characters/<TAG>.txt`. Traits are listed beneath a `leader_trait` line with their stats, like a leader's.
  - **Slots:** `common/idea_tags`, with the `slot` / `character_slot` counts.
- `PoliticsDefines`, each with a fallback (`DEFAULT_POLITICS_DEFINES`):
  - from the defines (regex): `BASE_POLITICAL_POWER_INCREASE`, `POLITICAL_POWER_UPPER_CAP` and `BASE_STABILITY_PARTY_POPULARITY_FACTOR`;
  - from `common/modifiers/00_static_modifiers.txt`: the `political_power_factor` of `stability_good_modifier` / `stability_bad_modifier` and the `political_power_cost` of `gain_focus`.

### What is kept (`politicsImport.ts`)

- It drops what `allowed` rules out for the tag and `ownedDlc`. Unknown terms count as allowed.
  - A generic designer whose `allowed` asks `has_allowed_idea_with_traits = { idea = X }` steps aside when the country has one of its own with trait X. So `generic_electronics_concern` stays beside ROMLOC while `generic_industrial_concern` goes.
- It keeps `available` as a `Check`, and in English as `availableText` when the condition folds.
- It seeds `recruited` from the history's `recruit_character`.
- It puts `slot` / `researchBonus` on every `add_ideas` line of a law or designer (`EffectLine.slot`, `EffectLine.researchBonus`).
- `ImportedCountry.politics` is cached with the rest.

### Default laws (`parsers/laws.ts`)

- History files do not set laws. The `default = yes` idea of each `law = yes` category applies (categories are merged by name across `common/ideas` files).
- `gameImport.ts` adds an `add_ideas` start line for each category whose ideas the history does not add (`defaultLawLines`). They go through the idea and modifier passes and show as spirits, and `consumer_goods_expected_value` reaches `modifierTotals`.
- `ImportedCountry.laws` maps every law idea to its category (`lawCategoryOf`) and is passed on as `options.laws`, so adding a law in a reward removes the active law of the same category.

## Decisions import (`decisions.ts`)

### What is read

- `parseDecisions` and `parseDecisionCategories` read `common/decisions` (and its `categories` folder) into `PoliticalOption`s of kind `decision`:
  - `slot` is the category id, and the group is `decisions`.
  - `fireOnce` comes from `fire_only_once`.
  - `modifiers` is the `complete_effect` with scripted effects expanded.
- A decision with no `cost` is free. A variable or scripted cost (`cost = FIN_prioritize_light_industry_dec_cost`) counts as free too, with `PoliticalOption.variableCost` set: the list says "cost varies" and the planner adds a `cost-unknown` issue.
- `DEBUG_` decisions, missions and targeted decisions (`targets`, `state_target`, `days_mission_timeout`, ...) are dropped.
- `gameImport.ts` reads the scripted effects once, runs the rewards through DLC resolution, definitions and naming like a focus reward, and merges them into `politics.options` (category names go in `categoryNames`).

### Allowed, visible and available

- `allowed` + `visible` (and the category's `allowed`) go through `isAllowed` for tag and DLC (`readDecisions` in `politicsImport.ts`). `visible` + `available` become the option's `available` Check.
- `PoliticalOption.visible` keeps the `visible` block alone, with the category's `visible` joined to it (`parseDecisionCategories`).
- The list (`decisionListed` in `planning.ts`) shows a decision when its `available` is known to hold, or its `visible` is known true or absent (the game greys these out). It is dimmed when `available` fails. A `visible` the planner cannot answer keeps the decision out, so the list stays short.
- For that `visible`:
  - the country is not a subject and has no civil war (`is_subject`, `has_civil_war`: a `situation` check, answered only there);
  - no flag counts as set (`has_global_flag` is read as a flag check too);
  - `num_of_factories` is civilian plus military factories on the viewed date;
  - `is_major` comes from `MAJORS_1936` (`src/data/majors.ts`).
- `available` (visible + available) still gates the planner.

## Production import (`states.ts`)

- `readProduction` reads:
  - the states the country owns at the start, from `history/states`. `parseStateHistory` reads the `owner` at the top level of `history`, so dated and `if` blocks are ignored. It reads state-level `buildings` only, not `<province> = { naval_base }`. A cheap `owner = TAG` regex check comes before parsing.
  - `common/state_category` (`local_building_slots`);
  - the `shares_slots = yes` buildings of `common/buildings`;
  - the state-level buildings with their `base_cost`, `state_max`, `shares_slots` and `infrastructure_construction_effect` (`ProductionData.buildings`; `province_max` ones are left out);
  - the `NProduction` consumer goods, construction speed and energy defines (regex, with fallbacks in `DEFAULT_DEFINES`).
- `ImportedCountry.production` (`ProductionData`, types in `production.ts`) is cached with each country. State names come from `STATE_<id>` localisation.

## Balance of power (Finland's public trust)

### Import

- `parsers/balanceOfPower.ts` (`readBalanceOfPower`, from `common/bop/<TAG>.txt`) reads the ranges (min, max, modifiers) into `ImportedCountry.balanceOfPower` (`BalanceOfPower`, `balanceOfPower.ts`). Names come from localisation, and modifier lines go through the stat pass.
- The start value comes from `set_power_balance` in the 1936 `if = { limit = { has_start_date < 1936.01.02 } }` block, which `countryStart.ts` reads.
- The starting leader's traits come from the character's `country_leader` role (`parseLeaderRoleTraits`; `LeaderData.candidates[].traits` for replacements).
- A start fleet with a `pride_of_the_fleet = yes` ship (`history/units`, read through `set_naval_oob`) adds the `pride_of_the_fleet_country` static modifier (+5% war support) as a spirit.

### In the campaign

- In `applyReward.ts` the `powerBalance` handler moves `Working.balance`: `set_power_balance` with `set_value` / `set_default`, and `add_power_balance_value`, kept between -1 and 1. `CountryState.balance` is the value.
- `syncBalanceOfPower` keeps the range it is in as a national spirit `bop:<id>` (none when the range has no modifiers). Its stability, war support, political power and recruitable pop modifiers therefore flow everywhere an idea's do.

### Weekly drift

- `parsers/balanceOfPowerWeekly.ts` (`readWeeklyRules`) reads the country's `on_weekly_<TAG>` on action from `common/on_actions` into `BalanceOfPower.weekly`. A `BopWeeklyRule` holds:
  - the ruling leader;
  - the modifier, with `weekly` from the modifier's `power_balance_weekly` in `common/modifiers`;
  - the `when` check, from the `if`s around the `add_power_balance_modifier`. The `NOT has_power_balance_modifier` guards are dropped, and `else` negates the branches before it.
- Svinhufvud's rules: democratic or communist above 9% is -0.01 a week, both below 1% is +0.01.
- In `campaign/drift.ts`:
  - The weekly script (`weeklyScript`) runs on day 3 after the start (4 January) and every 7th day after. The rules of the ruling leader that hold stay in force until the next run (an unanswered `when` does not hold).
  - Every day from day 3 (`driftBalance`) the balance moves a seventh of those rules' weekly total. It is kept unrounded, and the range spirit is kept in sync.
  - A move into another range is in `CountryState.balanceChanges` (and a snapshot for the research and construction planners), and `planPolitics` treats those days as change points.
- Display: the screen shows the value cut to a whole percent, and the spirit's name shows both (`formatBalance`: `-46% (-0.463)`).

## Names

- A country is named after its ruling party at game start, from `history/countries/<TAG> - *.txt` (`SOV_communism` is "Soviet Union", plain `SOV` is "Russia").
- A state scope `46 = { ... }` is named from `STATE_46`.
- Texts built from other texts (`$KEY$`) are filled in after loading.
- An idea with `name = X` is named from `X` (`parseIdeaNames`).
- `cleanLocalisation` strips colour codes and turns `[SCOPE.GetName]` into the scope tag.
- A `country_event` shows the title from its definition (`parsers/events.ts`, trying the file named like the id prefix first). `From` / `Root` in the raw text (`parseLocalisation`'s `raw` map) are filled in by `resolveEventText`. The faction name comes from the receiving country's `create_faction_from_template`.

## Verified in game

- Balance of power (Finland): the trust holds until 4 January, then falls 0.14 a day on the screen's -100% to 100% scale, which is -0.01 a week. The screen shows -46% on 11 January.

## Assumptions and open questions

- `MAJORS_1936` (`src/data/majors.ts`) is assumed not to change.
- Not modelled (balance of power):
  - the weekly rules about losing cores (a scripted effect call);
  - conditions on the value (`power_balance_value`);
  - what a range does besides its modifiers (swapping `FIN_sisu_*`, decision costs).
- Not modelled (decisions): timeouts, cooldowns and `remove_effect`.
