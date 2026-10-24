# Code review: optimization findings

- **Date:** 2026-10-24 — revised the same day after `docs/optimization-findings-review.md` and independent verification (CLAUDE.md, commit `16784fd`, and a timing re-run of the exact `hexagon.ts` math). The review's corrections and two fixes to the review itself are folded in.
- **Scope:** full source review (`index.html`, `src/main.ts`, `src/model.ts`, `src/hexagon.ts`, `src/bars.ts`, `src/storage.ts`) plus tests
- **Status:** findings #1–#3 implemented on branch `perf/hexagon-hot-path` (see "Implementation log" at the end); #4, #5 and the nice-to-haves remain report-only

## Overall verdict

No algorithmic problems — everything is O(small-n) where it matters, and several expensive paths are already handled well (the modal reuses computed areas, thumbnails skip area sampling, import dedupes with a `Set`). The one genuinely heavy path is the **per-keystroke chart recompute**, and the measured cost sits in the curve math itself — recomputed control points, allocation churn, and double sampling — not in render batching or the draft write (both demoted to nice-to-haves in this revision).

## Measured baseline

Timed under Node on the Example-like shape with an on-wrist target (the review used Vitest; independently verified with a standalone transcription of the exact functions):

| Function | Per call |
| --- | --- |
| `enclosedAreas` (1440 samples) | ~220–460 µs (JIT warm-up dependent; the review measured ~390 µs) |
| `projectToCurve` (720 samples + bisection) | ~80–110 µs (the review measured ~155 µs) |

That is roughly **0.3–0.6 ms of math per keystroke** when an on-wrist value is set, plus two SVG `innerHTML` parses and layout. Machine- and warm-up-dependent; the first draft's unmeasured "1–3 ms on desktop" estimate is superseded by these numbers.

## The hot path: what happens on every keystroke

`src/main.ts:268-272` (and `571-575` for the wrist field) wires `input` → `showRateStatus` + `persistDraft` + `updateChart`. Typing `+2.5` into one field triggers, per keystroke:

- **~2,160 Bézier curve evaluations** — `enclosedAreas` samples 1440 points (`hexagon.ts:108`) and `projectToCurve` samples 720 (`hexagon.ts:187`), both re-deriving the same curve. (Only when an on-wrist value is set; without one, `projectToCurve` does not run for the main chart.)
- **~7–15k small object allocations** — `pointOnSmoothPath` allocates 3 objects per call (`hexagon.ts:81-94`); `triangleDiskArea` allocates a `stops` array and calls `.sort()` per edge (`hexagon.ts:134-141`), plus `p0/p1/mid` per sub-segment, and another array literal on every edge whose line crosses the ring (`hexagon.ts:137`).
- **2 full SVG `innerHTML` parses** (hexagon + bars) and the caption rebuild.
- **1 `localStorage.setItem`** of the ~200-byte draft — µs-scale on modern browsers (in-memory, asynchronous persistence). Harmless; see nice-to-haves.

Also 8 `parseRate` calls per keystroke, one of them a duplicate (details under finding #5).

## Findings, ranked

### 1. Precompute segment control points in the samplers (was #2)

**Highest impact; exact same output if the same arithmetic is kept.**

`pointOnSmoothPath` recomputes the Catmull-Rom→Bézier control points on every call (`hexagon.ts:70-78`) — but each of the 6 segments has constant control points. With 1440+720 samples, each segment's controls are recomputed ~240 times identically. Precomputing 6 `(c1, c2)` pairs once per render and evaluating only the cubic per sample removes roughly two-thirds of the sampler arithmetic.

Second benefit: CLAUDE.md warns this math is written **twice** — `smoothClosedPath` (the drawn SVG path) and `pointOnSmoothPath` (used by `projectToCurve` and `enclosedAreas`) — and that they must be changed together or the drawn curve, the on-wrist marker, and the area readout disagree. One shared "segment controls" helper serves both and removes that drift risk.

### 2. Allocation churn in `enclosedAreas` / `projectToCurve` (was #3)

Beyond #1:

- reusable scratch objects or scalar `(x, y)` returns would eliminate most of the per-sample object churn;
- the `stops` array + `.sort()` per edge in `triangleDiskArea` (`hexagon.ts:134-141`) can be replaced by branch logic that builds the ≤4 stops in sorted order (there are at most 2 roots). **Hazard — do not remove the sort naively:** `stops` starts as `[0, 1]`, and any root in (0, 1) is pushed *after* the 1, so the array is **not** sorted until `.sort()` runs (e.g. `[0, 1, 0.2, 0.8]`). The two roots *are* mutually ordered (`quadA > 0`, `root > 0`, so the first candidate is always the smaller), but they must be inserted before the trailing 1. Deleting only the sort lets the `t1 - t0 < 1e-12` guard skip the backwards pair and silently drop a piece of the area — a wrong readout with no error thrown, and the existing tests (loose inequalities plus an identity that holds by construction) would not reliably catch it;
- `Math.hypot` in the inner loops (`hexagon.ts:152`, `:201`) is typically 2–4× slower than `Math.sqrt(x*x+y*y)` at these magnitudes.

### 3. Share one sampling pass (was #4)

`enclosedAreas` (1440) and `projectToCurve` (720) sample the identical curve with identical tension. A shared pass saves **a third** of the evaluations (2160 → 1440) — not half, as the first draft claimed — and only when an on-wrist value is set. Sharing is easier than it sounds: the projection points (`i/720`) are exactly every other area point (`2i/1440`), so one 1440-sample pass serves both with no resampling.

Bisection steps (corrected): one sample interval spans up to ≈ 2π·142/720 ≈ **1.24 SVG units**, and `hexagon.test.ts:68` asserts `toBeCloseTo(70, 3)` (±0.0005), so ~12 steps is the safe floor (11 is borderline: ~0.0006). The saving — about 8 evaluations per crossing — is too small to justify touching the test. Keep the current 20 unless the code is being rewritten anyway.

### 4. Cache history thumbnails, if session counts grow (was #5)

`renderHistory` (`main.ts:375-449`) rebuilds every `<li>`, thumbnail SVG, and listener on every save/delete/import. Sessions are immutable once saved, so the thumbnail SVG string can be cached per session `id` — delete/import then only touches the delta. This needs `renderHexagon` (or a sibling) to return the markup instead of only writing it into `host`.

Clip-path safety (verified): the id counter only increases, so a cached string keeps an id no later render will reuse. One caveat: `loadSessions` does not dedupe ids, so a hand-edited store containing duplicate session ids would render the same cached string twice → duplicate clip-path ids in the DOM. Guard against that if implemented.

Each thumbnail with a wrist value still runs the 720-sample `projectToCurve` (via `hexagon.ts:334-341`); N sessions = N×720 samples per history render — the second-heaviest path in the app with many saved sessions.

### 5. Micro-deduplications (tidiness, not speed) (was #6)

- **`parseRate`:** 8 parses per keystroke, **one duplicate** — `showRateStatus` parses only the changed field (`main.ts:213`), then `currentReadings`/`currentWristDrift` re-parse all six plus the wrist (`main.ts:278-292`). (The first draft's "~14" figure is the `fillForm`/`refreshStatuses` path — Load, Example, Clear, startup — not typing.)
- **`formatRate`:** ~27 calls in bars (summary, `driftSign` twice per row at `bars.ts:52` and `:55`, value, scale) and ~22–23 in the hexagon per `updateChart`, where far fewer distinct values would suffice. `driftSign` calls `formatRate` and discards the string (`model.ts:142-146`). Redundant, but none of this matters for speed.
- **Double `refreshStatuses()` at startup:** happens only when a draft exists (`fillForm` → `main.ts:240`, then `main.ts:567`). The 567 call is still needed when there is no draft, because it tints the empty fields invalid — so the fix is to skip it only when `restoreDraft` actually filled the form.
- **`orderReadings`'s "fixed" comparator uses `indexOf`** (`model.ts:77-79`) — a rank `Map` would be the textbook fix, though with n=6 it is irrelevant in practice.
- **Caption markup:** the caption uses `<br />` for its three-line layout (`main.ts:353-359`, commit `16784fd`), and `captionPrefix` contains entities, so a `textContent` switch would need `\n` separators plus `white-space: pre-line` on `#chart-caption` and `#chart-modal-caption` — not just a literal `·` as the first draft implied. There is no safety reason to change it either: the caption contains only formatted numbers and fixed position labels, never user-entered text. Optional at best.

## Nice-to-haves (demoted from the first draft's #1)

- **rAF-coalescing `updateChart`:** does **not** reduce per-keystroke work. Typing (~10–15 cps) produces at most one `input` event per 60 fps frame, so nothing gets merged and every keystroke still does a full render; it only merges burst events such as held-key auto-repeat (~30 cps). Harmless if added, but it is not an optimization.
- **Debouncing the draft write:** `setItem` of a ~200-byte JSON string is µs-scale on modern browsers. Debouncing (~200 ms, flush on `pagehide`/`beforeunload`) is harmless hygiene, not impact.

## Possible, but with caveats

- **Lowering `AREA_SAMPLES` (1440 → 360/720).** Safer test-wise than the first draft stated: the πr² assertion (`hexagon.test.ts:19`) is exact at any sample count — all samples sit outside the zero disk, the chords never cross it, and the sector areas telescope to exactly the disk — and `fast + slow ≈ total` holds by construction at any count. Only straddling shapes shift, and those tests use loose tolerances. Still worth a quick test run before committing.
- **Debouncing the draft save** means a crash could lose the last ~200 ms of typing unless flushed on unload — easy to add, just needs doing.

## Already optimal (checked, no action needed)

- Zoom modal reuses `lastZoomData.areas` instead of re-sampling (`main.ts:100-104`).
- Thumbnails and the modal pass `{ areas: false }` — the costly sampling is correctly skipped.
- SVG is built as strings + one `innerHTML` per host — faster than node-by-node DOM API.
- `importSessions` dedupes with a `Set`, O(n) (`storage.ts:68`).
- Theming is pure CSS variables with a pre-paint inline script — no re-render on toggle.
- Session-bounded state, no listeners leaking, `toastTimer` cleared properly.

## Suggested action order

1. **#1 → #2 → #3** — behavior-preserving, and where the measured cost actually is.
2. **#4** if session counts grow.
3. #5 and the nice-to-haves as convenient.

## Implementation log

#1–#3 were implemented on branch `perf/hexagon-hot-path`, one commit per finding, plus a test commit pinning the hazardous paths first:

- **Test pins (first commit):** golden values from the old sampler for the straddling diamond, including the ring-20 case where sample edges cross the ring twice (the stop-ordering hazard of #2), and the six bisection-refined marker positions. These pass unchanged after every refactor commit.
- **#1 control points:** `curveSegments()` derives the Bézier segments once; `smoothClosedPath`, `pointAt` (the samplers' evaluator), `enclosedAreas` and `projectToCurve` all consume it. CLAUDE.md's duplicated-math warning is gone — the derivation exists once.
- **#2 allocation churn:** `pointAt()` writes into a caller scratch object; `sampleCurve()` stores a lap in two `Float64Array`s instead of ~1440 `Point` objects; `triangleDiskArea()` works on scalars and builds each edge's stop list in ascending order by branch logic (no `.sort()`, no comparator, no roots array); `Math.hypot` → `Math.sqrt(x*x + y*y)` in the two hot distance checks.
- **#3 shared pass:** `renderHexagon` runs one `sampleCurve()` pass — at `AREA_SAMPLES` density when the area split is wanted (the on-wrist search reads every other sample, stride 2), at `PROJECTION_SAMPLES` density for thumbnails. The stride math is exact: `(i·2)/(720·2)` is the same double as `i/720`, so markers are bit-identical to a dedicated 720-sample search.

Measured result (Node, median of 7 runs, example shape with an on-wrist value):

| Path | Before | After |
| --- | --- | --- |
| `enclosedAreas` | ~213 µs | ~80 µs |
| `projectToCurve` | ~79 µs | ~21 µs |
| Both (per keystroke, wrist set) | ~313 µs | ~86 µs |

Outputs are bit-identical to the old implementation on every tested shape (areas, markers, and the shared-pass markers vs a dedicated search); the `Math.hypot` → `Math.sqrt` swap changed nothing on any tested input. Per-keystroke math drops ~3.7×; the two `innerHTML` parses and layout are now the dominant remaining cost. #4, #5 and the nice-to-haves are still open.
