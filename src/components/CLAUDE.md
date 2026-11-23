# Routes and components (`src/components/`, `src/views/`)

Routes are in `src/router/index.ts` (hash history, so reloads work on GitHub Pages). Components only render what `src/domain/` computes. Nothing here has been recorded as checked in game.

## App shell

- `App.vue` has the header, country selector and nav.
- It keeps pages alive (`KeepAlive`) so switching keeps scroll and state. Each view therefore needs a single root element.
- `components/GameDataImport.vue` is the folder picker.

## Shared between components

- `components/overviewLink.ts`: `useShowOnOverview`, what a row's date links to. A plan row's end date opens the overview on that date (`completionDay`).
- `components/yearBanners.ts`: the year banner above the first row of each year.
- `src/styles.css`: the global `.muted` and `.year-banner`. Every other style is scoped.
- `describeAhead` in `research.ts` is the ahead-of-time text of the folder graph and the queue.

## Overview (`/`, `views/OverviewView.vue`, `components/overview/`)

- The date scrubber.
- `AdjustmentsPanel.vue`: stability and event modifiers seen in game.
- Government, and national spirits. National spirits only list ideas without a slot; laws, advisors and designers show by slot in the Political power section.
- The Political power section: balance, daily gain, next purchase, and laws / advisors / designers by slot.
- One Modifiers section. `combineModifiers` in `campaign/modifiers.ts` merges the spirits / leader / laws / staff totals, the technology totals and the rules into one row per stat key (never two keys together, zero totals dropped).
  - Rows sit under the groups of `statGroups.ts` (`STAT_GROUPS`, `statGroupOf`): ordered key patterns, first match wins, `other` last.
  - Industry is split into economy and trade (consumer goods, resources to market), construction (speeds, slots, conversion) and production (output, efficiency).
  - A note of each part shows when both sources add to a stat.

## Focus (`/focus`, `views/FocusPlanView.vue`, `components/focus/FocusPlanner.vue`)

- The plan: a list grouped under completion-year banners, showing each focus's dates and completion effects.
- Focuses are added and removed only through the graph (`FocusTreeGraph.vue`).

## Research (`/research`, `views/ResearchPlanView.vue`)

- `components/research/ResearchPlanner.vue`, the queue: a list in queue order under completion-year banners, with each row's dates, slot, days, issues, a bonus dropdown from `availableBonuses`, and move up/down gated by `isValidResearchPlan`.
- `ResearchFolderGraph.vue`: folder tabs, and cards on the folder grid with SVG connectors. A click toggles through `pathToTech` / `removeWithDependents`. The tooltip lists the stats.

## Timeline (`/timeline`, `views/TimelineView.vue`, `components/timeline/CampaignTimeline.vue`)

- Days under year banners with Done and Next lists.
- A done-in-game checkbox on each Next action, and a Hide checked toggle that also drops days left with nothing to do.
- Kind filters, and date links to the overview.

## Production (`/production`, `views/ProductionView.vue`)

- The date scrubber shared with the overview.
- `components/production/TradePanel.vue`: imports and civs received from trade.
- Tiles for civ / mil / dock factories, consumer goods, available civs and slots.
- A states table with a From focuses column whose rows have a `+` that fills the add row.
- A list of unplaced builds.
- `components/production/ConstructionQueue.vue`: an add row limited by `levelsLeft` (`state_max`), and rows in queue order with dates, civs, days and issues, move up/down and remove. Focus-queued rows are greyed and fixed.

## Politics (`/politics`, `views/PoliticsPlanView.vue`, `components/politics/PoliticsPlanner.vue`)

- Left: the four groups of the politics screen with their slots, what is held on the overview's date, and the options with their cost now and a tooltip of availability, research bonus and modifiers. A click queues a purchase, and a held advisor offers dismiss.
- Right: the queue under year banners with date, cost, balance after, issues, a not-before date and move/remove.

## Verified in game

- None recorded for this area.

## Assumptions and open questions

- None recorded for this area.
