# Planners (`src/domain/plan/`)

Each planner is a pure function of a user queue plus an environment built by `campaign/`; none reads game files. Behaviour is described first, per planner. What was checked in game and what is only assumed is collected at the end, under [Verified in game](#verified-in-game) and [Assumptions and open questions](#assumptions-and-open-questions).

## Focus planner

### Scheduling (`focusPlan.ts`)

- `schedulePlan` schedules an ordered list of focus ids back to back, at `days / (1 + speedBonus)` each.
- `PlanOptions.loadedDays` (the store passes 1) takes that many days off the first focus only; the focuses after it start with nothing done.
- It reports prerequisite, exclusivity and duplicate problems per focus, and still schedules invalid focuses.

### Selection (`focusSelection.ts`)

- `pathTo` returns the focuses to append so a clicked focus becomes valid: missing prerequisites first, the cheapest option for OR groups, null if exclusivity blocks it.
- `removeWithDependents` drops a focus plus anything that loses its prerequisites.
- `isValidPlan` gates reordering.
- The UI therefore keeps the plan valid at all times; `schedulePlan` still reports rule violations as a safety net.

### `available` and `bypass`

- `parsers/focusTree.ts` reads both triggers into `Focus.available` / `Focus.bypass` as `Check`s, only when they hold a term the campaign can answer (popularity, stability, government, focuses, ...). A trigger of only unknown terms is dropped, so it never blocks.
- `campaign/availability.ts` asks `available` of the country on the day the focus would start (`countryConditions`; unknown counts as available).
  - `blockedByAvailability` adds the focuses that fail (with the prerequisites they need first) to the blocked cards.
  - `unavailableInPlan` finds planned focuses that no longer pass.
  - The store's `toggleFocus` (`planning.ts`) refuses a blocked focus and, after a removal, drops planned focuses that became unavailable.
- `Focus.availableText` is the `available` block in English. Its lines go through the name pass like a political option's, and `availableLines` is dropped after.
- The focus tooltip says why a card is greyed out: `availabilityBlocks` (focus, start day, its `availableText`) or the planned focus that excludes it.
- A focus whose `bypass` holds as it starts gives no reward (`CountryState.bypassed`, shown on the plan row). Its duration is unchanged.

### Layout (`focusLayout.ts`)

- Resolves each focus's `x`/`y` (relative to `relative_position_id` when set) into absolute grid positions.
- `FocusTreeGraph.vue` draws the tree from them: absolutely positioned cards over an SVG of connector lines (the px-per-grid-unit constants are at its top). Clicking a card toggles it in the plan; blocked cards are disabled.
- Game icons are deliberately not shown (copyrighted DDS art).

## Research planner (`researchPlan.ts`)

`scheduleResearch(queue, techs, env, options)` is a pure function of the queue (`ResearchItem[]`: a tech id and the optional focus bonus chosen for it), the techs and a `ResearchEnvironment` (dated start techs, research slots, research speed, `set_technology` grants and `add_tech_bonus` bonuses, all from the campaign).

### Scheduling

- It runs day by day. Each free slot (lowest first) takes the first queued tech whose prerequisites are done and that no queued tech excludes, so a tech waiting for a prerequisite does not hold up the ones behind it.
- A slot adds `(1 + speed + bonus) / (BASE_TECH_COST * cost * (1 + penalty * max(0, yearsAhead - bonus.ahead)))` a day, done at 1, in whole days. Years ahead are counted from that day to Jan 1 of `start_year`.
- A tech the country already has (start or granted) gets `already-researched` and no slot. Queued techs that never run are `unscheduled` with a reason.
- `plan/researchSelection.ts` mirrors `focusSelection.ts`: `pathToTech`, `removeWithDependents`, `isValidResearchPlan`, with the start techs as `known`.

### Ahead-of-time penalty

- `aheadOfTime` is the one place the penalty is worked out (years early, years a bonus ignores, cost factor).
- The factor is a linear `1 + penalty x years`, recomputed every day.
- Each `ScheduledResearch.ahead` holds it for the day the tech started, which the queue rows show.
- The folder graph marks cards that would be early if added when the earliest research slot is free (`earliestFreeSlot`: amber bar, factor in the tooltip). It ignores gaps where a slot waits on a prerequisite, and what the new tech itself needs first.
- `describeAhead` (`research.ts`) is the text for both.

### Opening slots

- A tech that starts on the first day has a day of progress done (`ResearchOptions.loadedDays`; the store passes `FIRST_TECH_LOADED_DAYS` = 1, the plain scheduler default is 0). A tech that starts later gets none.
- The first day's progress is applied when research starts, and the in-game tooltip shows the days left after it.

### Techs that speed research up

- A tech's own `research_speed_factor` (Electronic Mechanical Engineering: +3%) is added to the speed from the day the tech is had (finished, start or granted), inside `scheduleResearch` (`techSpeedOn`).

### Focus bonuses

- A bonus is spent when the tech starts, and only if it matches (a category or a tech id, told apart by `targetKinds`), was granted by then and has uses left. Otherwise the row gets `bonus-unavailable`.
- A bonus granted on a day (`bonus.date`) is applied at once to the running techs it matches that have no bonus yet, in slot order, until its uses run out. This happens before free slots take new techs (`ScheduledResearch.bonusApplied`, shown as "bonus from <date>").
- `availableBonuses` fills a row's dropdown.

### Design teams

- `ResearchItem.designTeam` (a MIO id, saved with the queue, unknown ids dropped on load) adds `designTeamBonus + mio.researchBonus` to a slot's daily rate when one of the tech's categories is in the MIO's `researchCategories`.
- Otherwise the row gets one of these issues, and the tech runs without the team:
  - `design-team-mismatch`: no category matches.
  - `design-team-busy`: a MIO is the team of one research at a time.
  - `design-team-unavailable`: its `available` is false on the start day, answered by `ResearchEnvironment.mioAvailable` (built in `campaign/research.ts` from `countryStateAt`; unknown counts as available).
- `ResearchSchedule.designTeams` lists the `{ mio, start, end }` intervals; the timeline says "with <MIO>".
- `ResearchEnvironment.categorySpeed` (a designer's `research_bonus` per category, dated like `speed`) is summed for the tech's categories into a slot's daily rate (`categoryBonusAt`).

## Political power planner (`politicsPlan.ts`, `campaign/politics.ts`)

`politicsPlan.ts` depends on `politics.ts` only.

### Daily gain and cost

- `dailyGain` is `(BASE_POLITICAL_POWER_INCREASE + political_power_gain) x (1 + political_power_factor + stability factor) - political_power_cost - focus cost - design team cost x teams in use`.
  - The stability factor scales `stability_good_modifier`'s +10% from 50% to 100% stability, and `stability_bad_modifier`'s -20% from 50% down to 0% (`stabilityFactor`).
  - The focus cost is `gain_focus`: -1 a day while a national focus runs. A focus is taken to be always running.
- The balance starts at the first day's net gain.
- `purchaseCost` applies `<slot>_cost_factor`, plus `<army|navy|air>_advisor_cost_factor` for an advisor's ledger. Base costs:
  - Economy and trade laws: 150 flat.
  - Mobilization laws: 150 for every rank moved (their `level`, `PoliticalOption.level`; `purchaseCost` takes the law it replaces, found with `replacedBy`).
  - Political advisors 150, military staff 100, concerns 150 (rounded to whole PP).
- Queue edits: `addPurchase`, `movePurchase`, `removePurchase`, `setNotBefore`, `knownPurchases`. Items have no dependencies, so every order is valid.
- `CountryState.stability` / `warSupport` are the actual values (`countryStat` in `campaign/totals.ts`): the start's `set_*` or 50% when the history sets none, plus changes, plus `<key>_factor` modifiers, plus for stability the ruling party's popularity x 0.15. War is not modelled. `has_stability` / `has_war_support` conditions use the same values.

### Design teams

- `planPolitics` takes `designTeams` (`{ start, end }` intervals: the previous pass's research schedule in `planCampaign`; the first pass has none).
- It subtracts `PoliticsDefines.designTeamCost` (0.1) a day for each team in use, from the day its research starts until it ends. Those dates are change points, so `balanceAt` stays exact.
- `PoliticsSchedule.designTeamsAt` feeds the overview line "Design teams: -0.1 x n".

### Scheduling (`campaign/politics.ts`)

- `planPolitics` works the queue (`PoliticsItem`: `optionId`, `dismiss`, `notBefore`) in order, event-driven on one `simulateCountry` (see `campaign/CLAUDE.md`): each purchase is added to it with `addStep`, and `firstDayAvailable` skips the day-by-day look when the check only changes with an event (`changesWithoutEvents`).
- At each change (a focus ends, a timed idea runs out, a purchase) it asks the state what is held, available and costs what, and buys the head of the queue the first day the balance covers it, if that is before the next change. Otherwise it looks again at the change, since a focus may make it available.
- The head waits for PP and the rest wait behind it.
- Items that can never happen are `unscheduled` with a reason: `slots-full` (an advisor), `is-leader`, `not-recruited`, `unavailable`, `unaffordable`, `not-held`, ...
- An `available` the campaign cannot answer is allowed, with an `availability-unknown` issue.
- **An option that is not available yet** is looked for in the days before the next change (`firstDayAvailable`: a week at a time, then day by day in the week it turns), since popularity and stability drift over a threshold with no event. Finland's Secure the Military (`fascism > 0.3`) is bought on 25 May, not at the next focus.
- A law or designer replaces the one in its slot; an advisor needs a free slot (dismiss first).
- The balance is the gain summed over time (capped at the define), plus `add_political_power` from the state's stat totals, minus what was spent (`balanceAt`, `gainAt`).
- Each purchase becomes a `Step` in `PlannedPolitics.steps`: id `politics:<index>`, `add_ideas` with the option's `slot`, `researchBonus` and modifier lines, or `remove_ideas`.

### Decisions

- A decision is bought like an option with no slot: flat `cost` (`purchaseCost`, no cost factor), `available` answered, never held as an idea.
- Its step is just the `complete_effect` lines (`purchaseEffects`).
- A `fireOnce` decision taken earlier in the queue is `already-taken`.
- The politics tab lists them in a Decisions group by category.

## Construction planner (`constructionPlan.ts`)

`scheduleConstruction(queue, production, env, options)` is a pure day-by-day scheduler like the research one.

### Queue and daily progress

- The queue is the user's `ConstructionItem`s (`building`, `state`, `levels`, built one level after another), then the focus-queued builds, which join the end on their focus's date.
- Each day the spare civs (civs minus `consumerGoodsFor`, from the factories built so far) go to the projects in queue order, up to 15 each (`civCapPerProject`, the production line cap `MAX_CIV_FACTORIES_PER_LINE`).
- A project adds `civs x per-civ speed (4, or 5 when powered) x (1 + production_speed_buildings_factor + production_speed_<building>_factor) x infrastructure factor` a day to its level.
  - `infraSpeedFactor` is `1 + effect * infra / 5`.
  - `isPowered` compares energy (base + coal) against the factories' scaled cost; unpowered drops the per-civ speed to 4.
- A level is done at the building's `base_cost` and built from the next day (a new civ joins, consumer goods rise).
- A level starts only with a free shared slot (a level in progress holds one) and room under `state_max`. One that waits gets `no-slots` and does not hold up the rest.

### Trade

- `ConstructionEnvironment.trade` is a list of `TradePoint`s (`received`, `importCost`, `coal`), built by `tradeOverTime` from the player's `TradeImport`s and `TradeReceived` entries and read off `tradeAt` like the factors. `industryAt` takes the trade of the date (`Industry.trade`, in `availableCivs`).
- An import costs `ceil(amount x cic)` civs from its start to its end, and its coal adds to the energy. `cic` is per resource in `common/resources` (0.125 for all), read into `ProductionData.resourceCost` with the fallback `DEFAULT_RESOURCE_COST`.
- A received entry replaces the one before.
- The spare civs are `civs - consumer goods + received - importCost`, and `isPowered` gets `coal + imported coal`.
- Civs received count `ENERGY_SCALE_PER_TRADE_FACTORY_EXPORT` (`ProductionDefines.energyScalePerTradeFactory`, 0.25) of a factory in the energy cost scaling.
- Exports are not modelled (the received civs do not say which resource left), so exporting coal does not lower the energy.

### Environment (`campaign/construction.ts`)

`planConstruction` builds the `ConstructionEnvironment` (`production.ts`):

- Dated `factors`: modifier totals of the ideas and techs, sampled at each reward, timed idea expiry and research end, from `CountryState.snapshots` and the research schedule.
- `events`: instant builds, extra slots and resources per placed batch.
- `focusBuilds`: non-instant builds in their placed state.
- The batches are placed with the slots of the day the focus plan finishes.

## Verified in game

### Focus planner

- A 35-day first focus started on 1 Jan 1936 ends on 4 Feb (the `loadedDays` day off).

### Research planner

- At the 1936 start, the first day's progress is applied when research starts and the tooltip shows the days left after it. Basic Machine Tools (1 + 157 days) and Construction II (1937, 1 + 374) match the planner exactly.
- Opening slot (Finland): Basic Machine Tools finishes 5 June.
- Tech speed (Finland): with the +3% tech finished mid-research, Basic Machine Tools finished 5 June, not 8 June. The planner had only the Export Focus's +5%; the in-game speed read 8%.

### Political power planner

- PP ticks once a day.
- Romania on 1 Jan 1936 (69.00% stability): base 2, a +3% stability line in the tooltip (`stabilityFactor` gives +3.8%), and -1 a day for the running focus. It gains 1.076 a tick with a focus running, as the model says. Displays truncate; the wiki confirms the stability bonus is linear from 50% and only shown rounded down.
- The first day's net gain: Romania shows 2 on 1 January and 1 once the first focus is picked; Finland 1 and then 0 (its 1.798 gross and 0.798 net).
- Partial Mobilization becomes affordable on 20 May 1936.
- Costs: economy and trade laws 150 flat, mobilization laws 150 per rank moved, political advisors 150, military staff 100, concerns 150.
- Finland's Secure the Military is bought on 25 May.

### Construction planner

- A civilian factory queued on 1 January 1936 is done on 10 October in Muntenia (infrastructure 3: 6 spare civs x 5 (powered) x 0.8 x 1.6) and on 19 November in Bessarabia (infrastructure 2: x 1.4). So the linear infrastructure factor and the powered speed hold for Romania's start.
- State slots (city 6, rural 2) match.
- The production line cap of 15 matches the game's construction cap.

## Assumptions and open questions

### Focus planner

- The focuses after the first start with nothing done (only the first one's `loadedDays` day is checked).
- A bypassed focus still counts as done, and its duration is unchanged.

### Research planner

- Construction III (1939, 1 + 871) is a day off from the game (the linear factor is checked only to the earlier two).
- Every opening slot gets the first-day progress (seen only on Finland's Basic Machine Tools).
- Bonuses mid-research (to check in game): the application order and timing above. Unknown: whether the game also uses a bonus automatically on a tech that starts, and which tech gets it when two matching techs run at once.

### Political power planner

- Design team cost (the overview's "Design teams: -0.1 x n") is not checked in game.
- Not checked yet: whether `political_power_factor` also multiplies `political_power_gain`.

### Construction planner

- Three helpers are checked only on Romania's start: `infraSpeedFactor`, `isPowered` and `civCapPerProject`.
- Trade (imports, received civs, the energy scaling) is not checked in game.
