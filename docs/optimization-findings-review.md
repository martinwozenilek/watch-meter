# Review of `optimization-findings.md`

- **Date:** 2026-10-24
- **Scope:** checks each claim in `optimization-findings.md` against the current source (`src/main.ts`, `src/model.ts`, `src/hexagon.ts`, `src/bars.ts`, `src/storage.ts`, `src/hexagon.test.ts`)
- **Status:** report only. No code was changed.

## Verdict

The report is mostly sound and every line reference is accurate. A few claims are wrong or overstated, though, and the item ranked #1 is the weakest one. The real per-keystroke cost is in the curve math (#2–#4), not in render batching or the draft write.

## Measured baseline

I timed the current code with Vitest under Node (desktop machine; Example-like shape, wrist target with 2 crossings):

| Function | Per call |
| --- | --- |
| `enclosedAreas` (1440 samples) | ~390 µs |
| `projectToCurve` (720 samples + bisection) | ~155 µs |

That is about 0.55 ms of math per keystroke when an on-wrist value is set. Adding the two SVG `innerHTML` parses and layout, the report's "1–3 ms on desktop" estimate is plausible.

## Claims that hold up

- **#2 Control points.** Correct. Each of the 6 segments has fixed control points, yet `pointOnSmoothPath` (`hexagon.ts:70-78`) recomputes them on every call. Precomputing 6 `(c1, c2)` pairs gives exactly the same output if the same arithmetic is used. The report misses a second benefit: CLAUDE.md warns that this math is written twice (`smoothClosedPath` and `pointOnSmoothPath`). One shared "segment controls" helper could serve both and remove that drift risk.
- **#3 Allocation churn.** Correct. The `.sort()` in `triangleDiskArea` (`hexagon.ts:141`) is not needed at all, rather than just replaceable with a branch: `quadA > 0` and `root > 0`, so `(-quadB - root) / (2 * quadA)` is always less than `(-quadB + root) / (2 * quadA)`, and pushing the roots in that order already keeps `stops` sorted. The inner `[t1, t2]` array literal at line 137 is another allocation per edge the report does not list.
- **#5 History rebuild.** Accurate, including the N×720 projection cost per thumbnail with a wrist value. Caching the SVG string per session id does not break clip-path uniqueness: the counter only increases, so a cached string keeps an id no later render will reuse. This needs `renderHexagon` (or a sibling) to return the markup instead of only writing it into `host`.
- **#6 Double `refreshStatuses()` at startup.** Correct when a draft exists (`fillForm` → `main.ts:240`, then `main.ts:567`). The call at 567 is still needed when there is no draft, because it tints the empty fields invalid. So the fix is to skip the second call only when `restoreDraft` filled the form.
- **"Already optimal" section.** All points check out.

## Claims that are wrong or overstated

### 1. `requestAnimationFrame` batching does not reduce per-keystroke cost (#1)

rAF batching only merges `input` events that land in the same frame. Normal typing, and even key auto-repeat, produces at most one event per frame, so every keystroke still does a full render. The claim "This alone removes most of the per-keystroke cost" is false. Cutting the work would take a real debounce, which delays the chart visibly and contradicts "zero visual change".

The draft write is also overstated. `localStorage.setItem` of a ~200-byte JSON string costs microseconds, and browsers keep localStorage in memory and write it to disk asynchronously. Calling it "main-thread I/O on every keypress" overstates the cost. Debouncing it is harmless, but it is not the highest-impact item.

**Suggestion:** demote #1 to a low-impact nice-to-have. Promote #2 to first place.

### 2. One shared sampling pass saves a third, not half (#4)

Today the code does 1440 + 720 = 2160 evaluations. Sharing one pass saves 720 of them, which is a third. Sharing is also easier than the report implies: the projection points (`i / 720`) are exactly every other one of the area points (`i / 1440`), so they can be reused as-is with no resampling.

The saving only applies when an on-wrist value is set. Without one, `projectToCurve` does not run for the main chart.

### 3. Eight bisection steps would fail an existing test (#4, micro-point)

One sample interval (`1/720` of a lap) spans up to about 2π·142 / 720 ≈ 1.24 SVG units on a full-size curve. After 8 halvings the error is about 1.24 / 2⁸ ≈ 0.005 units, not the "sub-0.001" the report claims. That is fine visually, since output is rounded to 0.01. But `hexagon.test.ts:68` asserts `toBeCloseTo(70, 3)`, which allows only ±0.0005. That needs about 11–12 steps. The saving (about 8 evaluations per crossing, out of 2160 per keystroke) is too small to justify loosening the test.

### 4. Parse and format counts are off (#6)

- **`parseRate`.** On a rate keystroke, `showRateStatus` parses only the field that changed. Then `currentReadings` parses all six and `currentWristDrift` parses the wrist value, for 8 parses in total, of which one is a duplicate. The "~14 duplicate parses" figure only applies to `fillForm`/`refreshStatuses` (Load, Example, Clear, startup), not to typing.
- **`formatRate`.** The count is too low, not too high. `bars.ts` calls `driftSign` twice per row (`bars.ts:52` and `:55`) as well as `formatRate` for the summary, the value and the scale. That is about 27 calls for bars and about 22 for the hexagon. The redundancy point stands, but none of this matters for speed.

### 5. The caption cannot simply switch to `textContent` (#6)

The caption at `main.ts:353-359` uses `<br />` for its three-line layout (commit 16784fd), not just `&middot;`. `captionPrefix` contains entities too. Switching to `textContent` would also need `\n` separators and `white-space: pre-line` on `#chart-caption` and `#chart-modal-caption`. There is no safety reason to change it either: the caption contains only formatted numbers and fixed position labels, never user-entered text.

### 6. Lowering `AREA_SAMPLES` affects fewer tests than stated (caveats)

The `πr²` assertion at `hexagon.test.ts:19` measures the zero disk, which `triangleDiskArea` computes exactly with circular sectors. It does not depend on the sample count. Only the tests for shapes that cross the zero ring would show sampling differences. The other assertions compare `fast + slow` with `total`, which holds at any sample count.

## Suggested revisions to `optimization-findings.md`

1. Reorder the findings as **#2 → #3 → #4**, all behavior-preserving and where the measured cost actually is. Then #5 if session counts grow. Move #1 to the nice-to-haves.
2. Add to #2 that precomputing control points also removes the duplicated Catmull-Rom math noted in CLAUDE.md.
3. Fix the figures: "halve" → "a third" (#4), "~8 steps, sub-0.001" → "~11–12 steps to keep `hexagon.test.ts:68` passing" (#4), "~14 parses" → "one duplicate parse per keystroke" (#6).
4. Correct the caption item: it needs `<br />` handling, not just entity replacement.
5. Replace the unmeasured "1–3 ms" with the measured numbers above, or label it as an estimate.
