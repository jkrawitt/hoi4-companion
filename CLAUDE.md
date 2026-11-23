# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A Hearts of Iron IV companion web app for planning campaigns, starting with a national focus tree planner (research is there too; production, divisions, navy, etc. may come later). It is a client-side Vue 3 + TypeScript + Vite single-page app with no backend.

## Commands

- `npm run dev`: start the Vite dev server (the app is served under `/hoi4-companion/`)
- `npm run build`: run `vue-tsc` type-check and `vite build` in parallel, writing to `dist/`
- `npm run test`: run Vitest once (`npx vitest run src/domain/__tests__/focusPlan.test.ts -t "name"` for a single file or test)
- `npm run type-check`: type-check only (`vue-tsc --build`)
- `npm run lint`: ESLint with `--fix` (flat config in `eslint.config.ts`)
- `npm run format`: Prettier on `src/` (no semicolons, single quotes, print width 100)

Tests live in `__tests__/` folders, which `tsconfig.app.json` excludes from type-checking.

## Deployment

Every push triggers `.github/workflows/main.yml`, which runs `npm install` and `npm run build`. Pushes to `main` also deploy `dist/` to GitHub Pages. That is why `vite.config.ts` sets `base: '/hoi4-companion/'`. Keep that base path when changing routing or asset URLs.

## Architecture

**No game data is committed or hosted.** The app reads focus trees from the user's own Hearts of Iron IV install, in their browser, and caches the parsed result in IndexedDB. Never add extracted game files or data to the repo. `HOI4_DIR="/path/to/Hearts of Iron IV" npm run test` also runs a test against a real install (skipped otherwise).

- Game logic is plain TypeScript with no Vue or DOM imports, so it is testable in Node. Keep it in `src/domain/`. Components only render it. Its subfolders are the architecture: `plan/` holds the planners (the focus planner depends on nothing but `focus.ts`, the research planner on nothing but `research.ts`, the construction planner on nothing but `production.ts`; none of them knows anything about game files), `campaign/` is the whole picture built from the plans (`industryAt` in `campaign/industry.ts`: factories, building slots and consumer goods on a date; `planCampaign` in `campaign/plan.ts` settles the research and political power plans together; `countryStateAt` in `campaign/countryState.ts`: the active ideas, stat totals, popularity, ruling party, leader and research environment of the country at a date; future planners add their inputs here), `parsers/` reads game script, `effects/` turns a focus's reward into display lines, and the files left at the top (`focus.ts` (the focus and effect types, `Check` and `Step`, a reward and when it is finished), `checks.ts` (whether a `Check` holds and whether it can change by itself), `research.ts` (the shared research types), `production.ts` (the shared production types), `politics.ts` (the shared political power types), `politicsImport.ts` (reads what political power buys), `numbers.ts` (`round` and `isNumeric`), `stats.ts`, `gameFiles.ts`, `gameImport.ts`, `definitions.ts`, `names.ts`, `focusEffects.ts`) are the shared types and the importer that drives the rest. Tests for all of it stay in `src/domain/__tests__/`, one file per area (`paradoxScript`, `focusTree`, `localisation`, `focusEffects`, `ideas`, `stats`, ...). `START_ID` (in `focus.ts`) is the `focusId` of what the starting state added.
- The IndexedDB cache is versioned (`CACHE_VERSION` in `src/import/cache.ts`). Bump it when the `Focus`, `ResearchData` or `ProductionData` shape changes, which makes users re-import.
- `src/data/countries.ts` is the country selector list (only Romania so far). Each entry names its focus tree file.
- **Dates use the game calendar** (`domain/calendar.ts`): HoI4 has no leap years, so every count of days and every date so many days on goes through `addDays` / `daysBetween` / `gameDay` (365-day years, no 29 February), never millisecond arithmetic. `parseDay` / `formatDay` there read and write the `YYYY-MM-DD` of date inputs and the saved plan (the store re-exports them as `parseDate` / `formatDate`). `plan/focusPlan.ts` re-exports `addDays`.
- The `@` alias points to `src/`.

## Where the details live

Detailed notes (including what was checked in game and what is only assumed) sit in nested `CLAUDE.md` files that load when working in that folder:

- `src/domain/parsers/CLAUDE.md`: the import pipeline and each kind of game file read (research, politics, balance of power, decisions, production, laws, start state, names)
- `src/domain/effects/CLAUDE.md`: the effect pipeline, effect display, stats, conditions and DLC branches
- `src/domain/plan/CLAUDE.md`: the focus, research, politics and construction planners
- `src/domain/campaign/CLAUDE.md`: `countryStateAt`, drift, conditions, leaders, adjustments, industry and the timeline
- `src/import/CLAUDE.md`: the folder picker and IndexedDB cache
- `src/stores/CLAUDE.md`: the shared campaign store
- `src/components/CLAUDE.md`: routes, pages and components
