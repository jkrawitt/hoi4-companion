# Campaign store (`src/stores/`)

`src/stores/campaign/` (`useCampaign()`, from `index.ts`) is the one shared campaign: a module-level singleton, so every page shares it. It is plumbing around the planners; nothing in it has been checked in game.

## Parts

- `index.ts`: the settings refs, the wiring, the country-change and save watches, `completionDay` / `formatDate` / `parseDate`.
- `saved.ts`: localStorage.
- `gameData.ts`: `createGameData`, the imported data and the import.
- `queues.ts`: `createQueues`, the queues and their edits, `keepValid`.
- `planning.ts`: `createPlanning`, everything computed (the schedules come from `planCampaign`). `campaignOptions` is the state options with the campaign's research and purchases, `scheduleOptions` the focus schedule's, and `powerOnViewDate` the political power summary (balance, gain, next purchase, design teams) the overview and the politics page share. The factory count the store assumes is `factoryCount` from `campaign/industry.ts`.
- `dates.ts`: the date helpers.

## Rules

- The plan and the three queues (research, construction, political power purchases) are saved to localStorage (`hoi4-companion:campaign`). Focuses stay in the IndexedDB cache.
- A saved plan or queue is kept when it is still valid (construction: `isValidConstructionPlan`; purchases: filtered to known options on load) and cleared when the country changes.
- Every view of the country (`stateOn`: the overview's `state`, the construction's `finalState`, the planners) goes through `stateOptions`, which holds the start, leaders, laws, `politics` and the adjustments. None of them can therefore miss one.
- `planEnd` is the end of the whole plan (the latest of the last focus, research and construction level and purchase). The overview's date slider runs to it, and a view sitting at the end follows it.
- `researchTotals` is what the technologies the country has on the viewed date add up to (`techModifierTotals` in `campaign/research.ts`), shown on the overview as Modifiers from technology.
