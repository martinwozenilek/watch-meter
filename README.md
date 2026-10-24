# Watch Meter

A single-page visualizer for six-position mechanical watch rate measurements. Enter how many seconds per day a watch gains or loses in each position and see the shape of its rate signature: a smoothed hexagon where the zero ring sits halfway out, so fast positions bulge outward and slow positions dip inward.

Everything runs in the browser. There is no backend, no account, and no chart library — the hexagon and the bar chart are hand-rolled SVG. Your data lives in `localStorage` and in JSON files you export yourself.

## Features

- **Six positions** — dial down, dial up, 12 up, 3 up, 6 up, 9 up, in signed seconds per day (positive = running fast).
- **Rate signature hexagon** — one axis per position, connected by a closed Catmull-Rom curve, with a zero ring at mid-radius.
- **Two axis orders** — "By drift" sorts the most positive position to the top; "Positions" uses the physical layout (12, 3, 6, 9, dial down, dial up). Sorting is view-only and never changes saved data.
- **Correct to 0 on wrist** — a view transform that subtracts your on-wrist drift from all six positions, so you can see the signature as it would look if the watch averaged exactly zero on the wrist. Inputs are not modified.
- **On-wrist marker** — the daily-wear value is projected onto the smoothed curve, not onto an axis, so it lands where it actually belongs on the drawn shape.
- **Fast/slow area split** — the enclosed area is split at the zero ring and shown as a share of the total plus an absolute value in (s/d)².
- **Bar chart** — a plain signed bar fallback under the hexagon.
- **Saved sessions** — save, reload, and delete measurements; history thumbnails reuse the same chart renderer.
- **JSON export/import** — one file per export, merge-safe on import.
- **Dark mode** — follows the system preference until you toggle it; the choice is remembered and applied before first paint.
- **Zoom modal** — click the chart for a large view; close with the button, a click on the chart, or `Escape`.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Type-check (`tsc --noEmit`) then build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the Vitest suite |

The build is a static bundle, so `dist/` can be hosted anywhere.

## How the chart is calculated

**Scale.** The radial axis is symmetric around zero: the centre is `−domain` and the outer edge is `+domain`, which puts the zero ring at exactly 50% of the radius. `domain` is the smallest "nice" number (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10 × a power of ten) at or above the largest absolute drift, so the chart rescales as you type. `radialFraction()` in `src/model.ts` is the only place this mapping is defined.

**Curve.** Axis values are joined by a closed Catmull-Rom spline converted to cubic Béziers with a tension of 0.85, which keeps the curve close to the measured points instead of overshooting them. The same sampling function drives the on-wrist projection and the area calculation, so all three always agree.

**Areas.** The curve is sampled into a 1440-point polygon. Its total area comes from the shoelace formula; the part inside the zero ring comes from a signed fan decomposition, where each edge's triangle with the centre is split at the ring and the outer pieces are counted as circular sectors. Fast area is the remainder. Values are converted from square SVG units to (s/d)² using the current domain.

## Data format

Export produces a JSON file with this shape; import accepts it, or a bare array of sessions:

```json
{
  "sessions": [
    {
      "id": "6f1c2a4e-…",
      "watch": "Seiko SPB143",
      "measuredAt": "2026-10-24T13:41:00.000Z",
      "readings": [
        { "position": "dialDown", "drift": -1.2 },
        { "position": "dialUp", "drift": 0.8 },
        { "position": "12up", "drift": 3.4 },
        { "position": "3up", "drift": 1.6 },
        { "position": "6up", "drift": -2.7 },
        { "position": "9up", "drift": 2.1 }
      ],
      "wristDrift": 1.8
    }
  ]
}
```

Rates are seconds per day. `wristDrift` is optional. Every imported session is validated first — required fields, six readings, known position names, finite numbers — and anything that fails is skipped rather than trusted.

Stored locally under two keys:

- `watch-meter:draft:v1` — the form as you last left it
- `watch-meter:sessions:v1` — saved sessions

The theme lives in `watch-meter:theme`. Clearing site data removes all three.

## Project layout

| File | Responsibility |
| --- | --- |
| `index.html` | Static shell; inline script applies the theme before paint |
| `src/main.ts` | DOM wiring, state, draft/session persistence, import/export, zoom modal |
| `src/model.ts` | Pure domain layer: parsing, formatting, axis order, domain, `radialFraction` |
| `src/hexagon.ts` | Radar SVG, Catmull-Rom smoothing, on-wrist projection, area split |
| `src/bars.ts` | Signed bar chart |
| `src/storage.ts` | `localStorage` access and session validation |
| `src/style.css` | Theme variables and layout |
| `src/hexagon.test.ts` | Tests for the area math |

Conventions and the domain rules that are easy to break are documented in [`AGENTS.md`](AGENTS.md).

## Notes and limitations

- Measurements are entered by hand; nothing talks to a timegrapher or a watch directly.
- Sessions are per browser profile. Use export/import to move them, or to back them up before clearing site data.
- The area readout hides when the inputs are incomplete or when the shape collapses to a point (all six positions at `−domain`), since there is no area to report.
- Requires a browser with ES2022 support and `crypto.randomUUID()`.
