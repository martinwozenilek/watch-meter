# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The project conventions, layout, domain rules and gotchas live in `AGENTS.md` and are shared with other agents. Keep them there rather than duplicating them here:

@AGENTS.md

## Additional notes for Claude Code

### Commands

- Single test file: `npx vitest run src/hexagon.test.ts`; single test by name: `npx vitest run -t "splits symmetrically"`.
- `npm run preview` serves the built `dist/`.
- `vite.config.ts` only sets `base: "./"` (relative asset URLs, needed for GitHub Pages sub-path hosting); there is no `vitest.config`, so Vitest runs on defaults. `tsconfig.json` is strict with `noUnusedLocals`/`noUnusedParameters`, so `npm run build` fails on unused code.
- Tests: `hexagon.test.ts` (area math), `model.test.ts` (parse/format/domain/order), `storage.test.ts` (`isSession`, `importSessions`). Vitest runs in Node, so DOM code in `main.ts` is untested; put testable logic in `model.ts`, `storage.ts` or `hexagon.ts`.

### How the pieces connect

- `updateChart()` in `main.ts` is the single render pass: read inputs, apply the on-wrist correction if that view is active, compute `chartDomain` (shown values plus the wrist value; history thumbnails use the same rule), sort with `orderReadings`, then call `renderHexagon` (sorted) and `renderBars` (canonical order) with the same domain and store the result in `lastZoomData`. Put new view options in this function so the main chart, bars and zoom modal stay consistent.
- The Catmull-Rom control-point math is derived once in `hexagon.ts`, in `curveSegments` (tension defaults to `CURVE_TENSION`). `smoothClosedPath` (the drawn SVG path) and `pointAt` (the samplers' evaluator, used via `sampleCurve` by the area split and the on-wrist search) both consume it, so the drawn curve, the on-wrist marker and the area readout cannot drift apart.
- `main.ts` helpers: `fillForm()` sets every input and refreshes the status lines (used by draft restore, Load, Example, Clear); `setViewMode()` keeps the Measured/Corrected buttons in sync; `showRateStatus()` is the one place the format hint is decided.
- Storage keys are versioned (`:v1`), so a breaking change to the stored shape needs a new key.
