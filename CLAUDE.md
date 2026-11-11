# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A Hearts of Iron IV companion web app for planning campaigns, starting with a national focus tree planner (production, divisions, navy, etc. may come later). It is a client-side Vue 3 + TypeScript + Vite single-page app with no backend.

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

- Game logic is plain TypeScript with no Vue or DOM imports, so it is testable in Node. Keep it in `src/domain/`. Components only render it.
- Import pipeline:
  - `paradoxScript.ts` is a generic parser for Paradox script. It keeps duplicate keys and order.
  - `focusTree.ts` extracts `Focus` objects from a `common/national_focus` file. Cost is in weeks, converted to days. Each `prerequisite = { ... }` block is an OR group, and multiple blocks are ANDed.
  - `localisation.ts` reads `.yml` names.
  - `gameImport.ts` ties these together behind a `GameFiles` interface (`readText`, `listFiles`).
- `src/import/` holds the browser-only pieces: `gameFolder.ts` implements `GameFiles` using `showDirectoryPicker` (Chromium, reads lazily) or `<input webkitdirectory>` (other browsers, which list every file in the install), and `cache.ts` is the IndexedDB cache.
- `src/domain/focusPlan.ts` has `schedulePlan`, which schedules an ordered list of focus ids back to back, at `days / (1 + speedBonus)` each. It reports prerequisite, exclusivity and duplicate problems per focus, and still schedules invalid focuses.
- `src/domain/focusSelection.ts` drives selection: `pathTo` returns the focuses to append so a clicked focus becomes valid (missing prerequisites first, cheapest option for OR groups, null if blocked by exclusivity). `removeWithDependents` drops a focus plus anything that loses its prerequisites. `isValidPlan` gates reordering. The UI therefore keeps the plan valid at all times, while `schedulePlan` still reports rule violations as a safety net.
- `src/domain/focusLayout.ts` resolves each focus's `x`/`y` (relative to `relative_position_id` when set) into absolute grid positions. `FocusTreeGraph.vue` draws the tree from them: absolutely positioned cards over an SVG of connector lines (px-per-grid-unit constants are at its top). Clicking a card toggles it in the plan; blocked cards are disabled. Game icons are deliberately not shown (copyrighted DDS art).
- The IndexedDB cache is versioned (`CACHE_VERSION` in `cache.ts`). Bump it when the `Focus` shape changes, which makes users re-import.
- `src/data/countries.ts` is the country selector list (only Romania so far). Each entry names its focus tree file.
- `src/components/focus/FocusPlanner.vue` holds the country, plan, start date and speed bonus, and wires up import and cache.
- The `@` alias points to `src/`. `src/router/index.ts` is set up but has no routes yet.
