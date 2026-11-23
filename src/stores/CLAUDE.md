# Campaign store (`src/stores/`)

`src/stores/campaign/` (`useCampaign()`, from `index.ts`) is the one shared campaign. It is a module-level singleton, so every page shares it. Nothing in it has been recorded as checked in game; it is plumbing around the planners.

## What it holds

- The country, the imported focuses and research data, the plan, the start date, the speed bonus, the overview's `viewDate` and the import status.
- Three queues, each saved and cleared when the country changes:
  - the research queue (`researchPlan`), kept when still valid;
  - the construction queue (`constructionPlan`), kept when `isValidConstructionPlan`. `constructionSchedule` is its schedule from `planConstruction`, and `industry` includes the levels built by `viewDate`;
  - the political power purchase queue (`politicsPlan`), filtered to known options on load. It is edited through `addPurchase`, `movePurchase`, `removePurchase`, `setNotBefore` and `resetPolitics`.
- `production`, and the computed `industry` (`industryAt` at the viewed date).
- `researchSchedule`, `researchEnvironment`, `researchStatus` and `politicsSchedule`, all via `planCampaign`. The overview's `state` uses its `hasTech` and the purchases as `extraSteps`.
- `researchTotals`: what the technologies the country has on the viewed date add up to (`techModifierTotals` in `campaign/research.ts`: the plain stats of the start techs, focus grants and finished research, summed). The overview shows it as Modifiers from technology.
- `planEnd`: the end of the whole plan (the latest of the last focus, research and construction level and purchase). The overview's date slider runs to it, and a view sitting at the end follows it.

## Parts

- `index.ts`: the settings refs, the wiring, the country-change and save watches, `completionDay` / `formatDate` / `parseDate`.
- `saved.ts`: localStorage.
- `gameData.ts`: `createGameData`, the imported data and the import.
- `queues.ts`: `createQueues`, the queues and their edits, `keepValid`.
- `planning.ts`: `createPlanning`, everything computed.
- `dates.ts`: the date helpers.

## Persistence and views

- The plan and settings are saved to localStorage (`hoi4-companion:campaign`). Focuses stay in the IndexedDB cache.
- A saved plan is kept when the focuses load and it is still valid, and cleared when the country changes.
- Every view of the country (`stateOn`: the overview's `state`, the construction's `finalState`, the planners) goes through `stateOptions`, which holds the start, leaders, laws, `politics` and the adjustments. None of them can therefore miss one.
