# hoi4-companion
tooling for planning your hoi4 campaigns, starting with a national focus tree planner (may extend to production, army, navy and air at some point)

## Development

```
npm install   # only needed when dependencies change
npm run dev
```

Vite prints a local URL. Because of the `base` setting in `vite.config.ts`, the app is served at <http://localhost:5173/hoi4-companion/> (the bare `localhost:5173/` won't show the app).

Other useful commands:

- `npm run test` runs the unit tests.
- `npm run build` followed by `npm run preview` serves the production build locally, which is closest to what GitHub Pages deploys.
