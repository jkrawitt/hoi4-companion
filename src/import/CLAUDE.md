# Browser import and cache (`src/import/`)

- `src/import/` holds the browser-only pieces: `gameFolder.ts` implements `GameFiles` using `showDirectoryPicker` (Chromium, reads lazily) or `<input webkitdirectory>` (other browsers, which list every file in the install), and `cache.ts` is the IndexedDB cache.
- The IndexedDB cache is versioned (`CACHE_VERSION` in `cache.ts`). Bump it when the `Focus`, `ResearchData` or `ProductionData` shape changes, which makes users re-import.
