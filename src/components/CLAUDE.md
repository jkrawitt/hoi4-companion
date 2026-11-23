# Routes and components (`src/components/`, `src/views/`)

Routes are in `src/router/index.ts` (hash history, so reloads work on GitHub Pages). Components only render what `src/domain/` computes. Nothing here has been checked in game.

## Rules

- `App.vue` keeps pages alive (`KeepAlive`) so switching keeps scroll and state, so each view needs a single root element.
- Shared helpers: `components/overviewLink.ts` (`useShowOnOverview`, what a row's date links to; a plan row's end date opens the overview on that date via `completionDay`), `components/yearBanners.ts` (the year banner above the first row of each year) and `src/styles.css` (the global `.muted` and `.year-banner`; every other style is scoped).
- `describeAhead` (`research.ts`) is the ahead-of-time text of the research folder graph and the queue.
- Focuses are added and removed only through the graph (`FocusTreeGraph.vue`), not the plan list. Research cards click through `pathToTech` / `removeWithDependents`, and moves are gated by `isValidResearchPlan`.

## Pages

- `/` Overview (`views/OverviewView.vue`, `components/overview/`): date scrubber, `AdjustmentsPanel.vue` (stability and event modifiers seen in game), government, national spirits, a Political power section and one Modifiers section.
  - National spirits only list ideas without a slot; laws, advisors and designers show by slot in the Political power section.
  - `combineModifiers` (`campaign/modifiers.ts`) merges the spirits / leader / laws / staff totals, the technology totals and the rules into one row per stat key (never two keys together, zero totals dropped), under the groups of `statGroups.ts` (`STAT_GROUPS`, `statGroupOf`: ordered key patterns, first match wins, `other` last). Industry is split into economy and trade, construction, and production. A note of each part shows when both sources add to a stat.
- `/focus` (`views/FocusPlanView.vue`, `components/focus/FocusPlanner.vue`): the plan under completion-year banners, with each focus's dates and completion effects.
- `/research` (`views/ResearchPlanView.vue`): `ResearchPlanner.vue` (the queue, with a bonus dropdown from `availableBonuses`) and `ResearchFolderGraph.vue` (folder tabs, cards on the folder grid with SVG connectors).
- `/timeline` (`views/TimelineView.vue`, `components/timeline/CampaignTimeline.vue`): Done and Next lists with a done-in-game checkbox on each Next action, and a Hide checked toggle that also drops days left with nothing to do.
- `/production` (`views/ProductionView.vue`): `TradePanel.vue`, factory and slot tiles, a states table whose From focuses `+` fills the add row, unplaced builds, and `ConstructionQueue.vue` (an add row limited by `levelsLeft` (`state_max`); focus-queued rows are greyed and fixed).
- `/politics` (`views/PoliticsPlanView.vue`, `components/politics/PoliticsPlanner.vue`): left, the four groups of the politics screen with slots, what is held on the overview's date, and the options; click queues a purchase and a held advisor offers dismiss. Right, the queue under year banners.
- `components/GameDataImport.vue` is the folder picker.
