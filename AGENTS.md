# AGENTS.md

Client-only single-page app: six-position watch rate visualizer. No backend, no framework, no chart library — the hexagon and bars are hand-rolled SVG.

## Commands

- `npm run dev` — Vite dev server on http://localhost:5173
- `npm run build` — `tsc --noEmit` then production build into `dist/`
- `npm test` — Vitest. Tests live beside the source as `src/*.test.ts`.
- No lint or formatter config. Match existing style: 2 spaces, double quotes, semicolons, trailing commas.

## Layout

- `index.html` — static shell only; no router, everything is one page.
- `src/main.ts` — all DOM wiring, module-level state, draft/session persistence, export/import, zoom modal.
- `src/model.ts` — pure domain layer: parse/format rates, axis ordering, symmetric domain, `radialFraction`. Keep math here; it is the only easily testable layer.
- `src/hexagon.ts` — SVG radar chart, Catmull-Rom smoothing, on-wrist point projection.
- `src/bars.ts` — SVG signed bar fallback.
- `src/storage.ts` — localStorage (`watch-meter:sessions:v1`, `watch-meter:draft:v1`), `isSession` validation, and `importSessions` (merge for JSON import).

## Domain rules that are easy to break

- Rates are signed seconds/day; positive means fast.
- The radial scale is symmetric `[-domain, +domain]`: center is `-domain`, the outer edge is `+domain`, so the zero ring is always at 50% radius. Use `radialFraction()`; do not invent another mapping.
- "By drift" sorts axes descending; "Positions" uses `FIXED_AXIS_ORDER` (12, 3, 6, 9, dial down, dial up). Sorting is view-only — saved sessions keep canonical `POSITIONS` order.
- "Correct to 0 on wrist" is a view transform (`drift - wristDrift` for all six positions); it must not overwrite the inputs.
- The on-wrist value is projected onto the smoothed curve by nearest radial fraction (`projectToCurve`), not onto an axis. If you change the curve, change `pointOnSmoothPath`/`projectToCurve` with it.
- The fast/slow area readout under the chart comes from `enclosedAreas()` in `hexagon.ts`: it samples the same smoothed curve and splits the enclosed region at the zero ring. `renderHexagon()` returns the split in (s/d)², or `null` when called with `{ areas: false }` (thumbnails and the zoom modal, which reuses the main chart's result); the UI shows each half as a share of the total. Change the curve and the areas follow — do not re-derive them elsewhere.

## Gotchas

- `isSession()` is the only validation for stored and imported sessions. It passes the object through unchanged, so a new session field it does not check is accepted with any value. Add a type check for every new field. It also requires a parseable `measuredAt` and each of the six positions exactly once.
- `loadDraft()` copies known fields one by one: a new form field must be added to `Draft` and to `loadDraft`, or it is not restored on reload.
- Import skips sessions whose `id` is already saved (`importSessions`), so re-importing a backup is a no-op. Do not reissue ids on collision.
- `renderHexagon()` is used by the main chart, the zoom modal, and every history thumbnail on the same page. Its clip-path id is generated per render; keep it unique or thumbnails pick up the main chart's clip.
- The zoom modal re-renders from `lastZoomData`. Update that when chart data changes or the modal shows stale content.
- Theming is driven by `data-theme="light|dark"` on `<html>`. The inline script in `index.html` applies the stored/system theme before paint (key `watch-meter:theme`); `main.ts` handles the toggle. New colors belong in the `:root` / `[data-theme="dark"]` variable blocks, not as literals.
- Insert user-entered text (watch names) with `textContent`, not `innerHTML`.
- Inputs: `.rate-input` lives inside `.rate-input-wrap`; generic input styles are scoped as `.field > input` to avoid double-boxing the on-wrist field.
