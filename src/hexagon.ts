import {
  driftSign,
  formatRate,
  positionLabel,
  radialFraction,
  type Domain,
  type Reading,
} from "./model";

const SIZE = 480;
const CENTER = SIZE / 2;
const OUTER_RADIUS = 142;
const LABEL_RADIUS = 176;

/** Spline tension shared by the drawn path and every sampler; one value everywhere. */
const CURVE_TENSION = 0.85;

interface Point {
  x: number;
  y: number;
}

const round = (value: number): string => String(Math.round(value * 100) / 100);

function polar(index: number, radius: number): Point {
  const angle = ((-90 + index * 60) * Math.PI) / 180;
  return {
    x: CENTER + Math.cos(angle) * radius,
    y: CENTER + Math.sin(angle) * radius,
  };
}

/** One cubic Bézier segment of the closed spline. */
interface CurveSegment {
  /** Segment start: the current reading. */
  x0: number;
  y0: number;
  /** First control point. */
  x1: number;
  y1: number;
  /** Second control point. */
  x2: number;
  y2: number;
  /** Segment end: the next reading. */
  x3: number;
  y3: number;
}

/**
 * Closed Catmull-Rom spline converted to cubic Béziers. `tension` below 1
 * tightens the curve so it stays close to the measured points. Derived once
 * and shared by `smoothClosedPath` (the drawn SVG path) and `pointOnSmoothPath`
 * (the samplers), so the drawn curve, the on-wrist markers and the area
 * readout cannot drift apart.
 */
function curveSegments(points: Point[], tension: number): CurveSegment[] | null {
  const count = points.length;
  if (count < 3) return null;

  const segments: CurveSegment[] = [];
  for (let i = 0; i < count; i += 1) {
    const previous = points[(i - 1 + count) % count];
    const current = points[i];
    const next = points[(i + 1) % count];
    const afterNext = points[(i + 2) % count];

    segments.push({
      x0: current.x,
      y0: current.y,
      x1: current.x + ((next.x - previous.x) * tension) / 6,
      y1: current.y + ((next.y - previous.y) * tension) / 6,
      x2: next.x - ((afterNext.x - current.x) * tension) / 6,
      y2: next.y - ((afterNext.y - current.y) * tension) / 6,
      x3: next.x,
      y3: next.y,
    });
  }
  return segments;
}

/** SVG path (`M`/`C`/`Z`) of the smoothed closed spline. */
export function smoothClosedPath(points: Point[], tension: number = CURVE_TENSION): string {
  const segments = curveSegments(points, tension);
  if (!segments) return "";

  let path = `M ${round(segments[0].x0)} ${round(segments[0].y0)}`;
  for (const segment of segments) {
    path += ` C ${round(segment.x1)} ${round(segment.y1)}, ${round(segment.x2)} ${round(segment.y2)}, ${round(segment.x3)} ${round(segment.y3)}`;
  }
  return `${path} Z`;
}

/**
 * Get a point on the smoothed closed curve at parameter t in [0,1), writing
 * it into `out` so hot loops can reuse one object per pass instead of
 * allocating per sample.
 */
function pointAt(segments: CurveSegment[], t: number, out: Point): Point {
  const count = segments.length;

  const u = ((t % 1) + 1) % 1;
  const segment = u * count;
  let i = Math.floor(segment);
  const s = segment - i;
  if (i === count) {
    i = 0;
  }

  const seg = segments[i];

  // Cubic Bézier: P = (1-s)^3*P0 + 3*(1-s)^2*s*P1 + 3*(1-s)*s^2*P2 + s^3*P3
  const s2 = s * s;
  const s3 = s2 * s;
  const mt = 1 - s;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;

  out.x = mt3 * seg.x0 + 3 * mt2 * s * seg.x1 + 3 * mt * s2 * seg.x2 + s3 * seg.x3;
  out.y = mt3 * seg.y0 + 3 * mt2 * s * seg.y1 + 3 * mt * s2 * seg.y2 + s3 * seg.y3;
  return out;
}

/**
 * The drawn region split by the zero ring. Both halves are areas in (s/d)²:
 * `fast` sits outside the ring (positive drift), `slow` inside it (negative).
 */
export interface ZoneAreas {
  fast: number;
  slow: number;
  total: number;
}

/**
 * Area samples per lap. Dense enough that the chord error is invisible.
 * Twice PROJECTION_SAMPLES, so one pass at this density can feed both the
 * area split and the on-wrist search.
 */
const AREA_SAMPLES = 1440;

/** Cross product of two vectors: twice the signed fan-triangle area. */
function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/** Signed angle between two vectors, in (-π, π]. */
function signedAngle(ax: number, ay: number, bx: number, by: number): number {
  return Math.atan2(cross(ax, ay, bx, by), ax * bx + ay * by);
}

/**
 * Signed area of the part of triangle (origin, a, b) that falls inside a
 * circle of `radius` centred on the origin. The triangle is split where the
 * edge crosses the circle: inner pieces stay triangles, outer pieces become
 * circular sectors.
 */
function triangleDiskArea(ax: number, ay: number, bx: number, by: number, radius: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const quadA = dx * dx + dy * dy;
  if (quadA < 1e-12) return 0;

  const quadB = 2 * (ax * dx + ay * dy);
  const quadC = ax * ax + ay * ay - radius * radius;
  const discriminant = quadB * quadB - 4 * quadA * quadC;

  // Stops where the edge splits: both ends plus any ring crossing strictly
  // inside the edge, in ascending order. quadA > 0 puts the smaller root
  // first, and each root is kept only when strictly inside, so the pushes
  // stay sorted without a sort.
  const stops = [0];
  if (discriminant > 0) {
    const root = Math.sqrt(discriminant);
    const low = (-quadB - root) / (2 * quadA);
    const high = (-quadB + root) / (2 * quadA);
    if (low > 0 && low < 1) stops.push(low);
    if (high > 0 && high < 1) stops.push(high);
  }
  stops.push(1);

  let area = 0;
  for (let i = 0; i < stops.length - 1; i += 1) {
    const t0 = stops[i];
    const t1 = stops[i + 1];
    if (t1 - t0 < 1e-12) continue;
    const x0 = ax + dx * t0;
    const y0 = ay + dy * t0;
    const x1 = ax + dx * t1;
    const y1 = ay + dy * t1;
    const midX = (x0 + x1) / 2;
    const midY = (y0 + y1) / 2;
    area +=
      Math.sqrt(midX * midX + midY * midY) <= radius
        ? cross(x0, y0, x1, y1) / 2
        : (radius * radius * signedAngle(x0, y0, x1, y1)) / 2;
  }
  return area;
}

/** One lap of curve samples plus the segments they came from. */
interface CurveSamples {
  segments: CurveSegment[];
  /** Sample positions relative to the chart centre. */
  xs: Float64Array;
  ys: Float64Array;
}

/**
 * Sample the smoothed closed curve into flat coordinate arrays. The samples
 * and the segments stay together: consumers that need arbitrary parameters
 * (the marker bisection) evaluate through `pointAt`.
 */
function sampleCurve(points: Point[], tension: number, count: number): CurveSamples | null {
  const segments = curveSegments(points, tension);
  if (!segments) return null;

  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const scratch = { x: 0, y: 0 };
  for (let i = 0; i < count; i += 1) {
    pointAt(segments, i / count, scratch);
    xs[i] = scratch.x - CENTER;
    ys[i] = scratch.y - CENTER;
  }
  return { segments, xs, ys };
}

function areasFromSamples(samples: CurveSamples, zeroRadius: number): ZoneAreas {
  const { xs, ys } = samples;
  const count = xs.length;

  let total = 0;
  let inside = 0;
  for (let i = 0; i < count; i += 1) {
    const j = (i + 1) % count;
    total += cross(xs[i], ys[i], xs[j], ys[j]) / 2;
    inside += triangleDiskArea(xs[i], ys[i], xs[j], ys[j], zeroRadius);
  }

  const area = Math.abs(total);
  const slow = Math.min(area, Math.abs(inside));
  return { fast: area - slow, slow, total: area };
}

/**
 * Area of the smoothed closed curve inside and outside the zero ring, in
 * square SVG units. The curve is sampled into a polygon; the signed fan
 * decomposition makes the ring split exact for that polygon.
 */
export function enclosedAreas(points: Point[], zeroRadius: number, tension: number = CURVE_TENSION): ZoneAreas {
  const samples = sampleCurve(points, tension, AREA_SAMPLES);
  return samples ? areasFromSamples(samples, zeroRadius) : { fast: 0, slow: 0, total: 0 };
}

/** Curve samples per lap for the on-wrist search; a multiple of six so every axis point is sampled. */
const PROJECTION_SAMPLES = 720;
/** Crossings closer than this (SVG units) are one marker. */
const MIN_MARKER_GAP = 8;

/**
 * Every point where the smoothed curve sits at `targetFraction` (0-1) of the
 * outer radius. Sign changes between samples are refined by bisection; if the
 * curve never reaches the target, the single nearest point is returned.
 */
export function projectToCurve(points: Point[], targetFraction: number, tension: number = CURVE_TENSION): Point[] {
  const samples = sampleCurve(points, tension, PROJECTION_SAMPLES);
  return samples ? projectionFromSamples(samples, targetFraction) : [];
}

/** The on-wrist search over a shared sampling pass. */
function projectionFromSamples(samples: CurveSamples, targetFraction: number): Point[] {
  const { segments, xs, ys } = samples;
  const scratch = { x: 0, y: 0 };

  // The pass may be denser than the search needs. Reading sample i at index
  // i * stride hits the same curve parameter i / PROJECTION_SAMPLES, so an
  // area-density pass (stride 2) serves the search without resampling —
  // but the pass count must be a whole multiple of PROJECTION_SAMPLES.
  const stride = xs.length / PROJECTION_SAMPLES;

  const offsets = new Float64Array(PROJECTION_SAMPLES);
  for (let i = 0; i < PROJECTION_SAMPLES; i += 1) {
    const j = i * stride;
    offsets[i] = Math.sqrt(xs[j] * xs[j] + ys[j] * ys[j]) / OUTER_RADIUS - targetFraction;
  }

  const hits: Point[] = [];
  for (let i = 0; i < PROJECTION_SAMPLES; i += 1) {
    const current = offsets[i];
    const next = offsets[(i + 1) % PROJECTION_SAMPLES];
    if (Math.abs(current) < 1e-9) {
      const j = i * stride;
      hits.push({ x: xs[j] + CENTER, y: ys[j] + CENTER });
    } else if (Math.abs(next) >= 1e-9 && current * next < 0) {
      let low = i / PROJECTION_SAMPLES;
      let high = (i + 1) / PROJECTION_SAMPLES;
      let lowOffset = current;
      for (let step = 0; step < 20; step += 1) {
        const mid = (low + high) / 2;
        pointAt(segments, mid, scratch);
        const relX = scratch.x - CENTER;
        const relY = scratch.y - CENTER;
        const offset = Math.sqrt(relX * relX + relY * relY) / OUTER_RADIUS - targetFraction;
        if (offset * lowOffset > 0) {
          low = mid;
          lowOffset = offset;
        } else {
          high = mid;
        }
      }
      pointAt(segments, (low + high) / 2, scratch);
      hits.push({ x: scratch.x, y: scratch.y });
    }
  }

  const markers: Point[] = [];
  for (const hit of hits) {
    if (markers.every((marker) => Math.hypot(marker.x - hit.x, marker.y - hit.y) >= MIN_MARKER_GAP)) {
      markers.push(hit);
    }
  }
  if (markers.length > 0) return markers;

  let best = 0;
  for (let i = 1; i < PROJECTION_SAMPLES; i += 1) {
    if (Math.abs(offsets[i]) < Math.abs(offsets[best])) best = i;
  }
  const bestJ = best * stride;
  return [{ x: xs[bestJ] + CENTER, y: ys[bestJ] + CENTER }];
}

// The main chart, the zoom modal and every history thumbnail render on the
// same page, so each SVG needs its own clip-path id.
let clipIdCounter = 0;

export interface RenderHexagonOptions {
  /** Compute the fast/slow area split. Thumbnails skip it; it is the costly part. */
  areas?: boolean;
}

export function renderHexagon(
  host: HTMLElement,
  readings: Reading[],
  domain: Domain,
  wristDrift?: number | null,
  options: RenderHexagonOptions = {},
): ZoneAreas | null {
  const radiusOf = (drift: number): number =>
    Math.min(OUTER_RADIUS, Math.max(0, radialFraction(drift, domain) * OUTER_RADIUS));

  const zeroRadius = radiusOf(0);
  const points = readings.map((reading, index) => polar(index, radiusOf(reading.drift)));
  const path = smoothClosedPath(points);

  const wristValue = wristDrift ?? null;
  const wantsAreas = options.areas !== false;

  // One sampling pass feeds both the on-wrist markers and the area split.
  // At area density (twice the projection density) the on-wrist search
  // reads every other sample, so a wrist value costs no second pass;
  // thumbnails skip the split, so their pass runs at projection density.
  const samples =
    wristValue !== null || wantsAreas
      ? sampleCurve(points, CURVE_TENSION, wantsAreas ? AREA_SAMPLES : PROJECTION_SAMPLES)
      : null;

  const summary = readings
    .map((reading) => `${positionLabel(reading.position)} ${formatRate(reading.drift)}`)
    .join(", ");

  clipIdCounter += 1;
  const clipId = `wm-hex-clip-${clipIdCounter}`;

  const parts: string[] = [];
  const wristLabel = wristValue !== null ? `, on wrist ${formatRate(wristValue)} s/d` : "";
  parts.push(
    `<svg viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="Position signature. ${summary}${wristLabel}, in seconds per day.">`,
  );
  parts.push(
    `<defs><clipPath id="${clipId}"><path d="${path}" /></clipPath></defs>`,
  );

  // Data shape: fast tint outside the zero ring, slow tint inside it.
  parts.push(`<path d="${path}" class="hex-fast" />`);
  parts.push(
    `<g clip-path="url(#${clipId})">` +
      `<circle cx="${CENTER}" cy="${CENTER}" r="${round(zeroRadius)}" class="hex-panel" />` +
      `<circle cx="${CENTER}" cy="${CENTER}" r="${round(zeroRadius)}" class="hex-slow" />` +
      `</g>`,
  );

  // Rings at each end of the range, halfway to zero on each side, and zero itself.
  // A side with no values has min or max at 0, so its rings coincide with zero.
  const distinct = (values: number[]): number[] => [...new Set(values)];
  for (const value of distinct([domain.min, domain.min / 2, 0, domain.max / 2, domain.max])) {
    const radius = radiusOf(value);
    if (radius < 0.5) continue;
    const className = value === 0 ? "hex-ring hex-zero" : "hex-ring";
    parts.push(
      `<circle cx="${CENTER}" cy="${CENTER}" r="${round(radius)}" class="${className}" />`,
    );
  }

  // Axes.
  for (let index = 0; index < readings.length; index += 1) {
    const edge = polar(index, OUTER_RADIUS);
    parts.push(
      `<line x1="${CENTER}" y1="${CENTER}" x2="${round(edge.x)}" y2="${round(
        edge.y,
      )}" class="hex-axis" />`,
    );
  }

  // Radial scale, labelled along the 12 o'clock spoke.
  // The centre is left unlabelled unless it is zero.
  for (const value of distinct([domain.min / 2, 0, domain.max / 2, domain.max])) {
    const radius = radiusOf(value);
    parts.push(
      `<text x="${CENTER + 7}" y="${round(CENTER - radius)}" class="hex-tick" ` +
        `dominant-baseline="middle">${formatRate(value)}</text>`,
    );
  }

  // Smoothed trace and measurement dots.
  parts.push(`<path d="${path}" class="hex-line" />`);
  for (const point of points) {
    parts.push(
      `<circle cx="${round(point.x)}" cy="${round(point.y)}" r="3.4" class="hex-dot" />`,
    );
  }

  // On-wrist measurement, marked everywhere the smoothed curve reaches it.
  if (wristValue !== null && samples) {
    const targetFraction = radialFraction(wristValue, domain);
    for (const wristPoint of projectionFromSamples(samples, targetFraction)) {
      parts.push(
        `<circle cx="${round(wristPoint.x)}" cy="${round(wristPoint.y)}" r="7" class="hex-wrist" />`,
      );
    }
  }

  // Axis labels: position name plus measured drift.
  for (let index = 0; index < readings.length; index += 1) {
    const reading = readings[index];
    const anchorPoint = polar(index, LABEL_RADIUS);
    const anchor =
      Math.abs(anchorPoint.x - CENTER) < 12
        ? "middle"
        : anchorPoint.x > CENTER
          ? "start"
          : "end";

    parts.push(
      `<text x="${round(anchorPoint.x)}" y="${round(anchorPoint.y)}" class="hex-label" ` +
        `text-anchor="${anchor}" dominant-baseline="middle">` +
        `<tspan x="${round(anchorPoint.x)}" dy="-0.15em">${positionLabel(reading.position)}</tspan>` +
        `<tspan x="${round(anchorPoint.x)}" dy="1.18em" class="hex-value ${driftSign(
          reading.drift,
        )}">${formatRate(reading.drift)}</tspan>` +
        `</text>`,
    );
  }

  parts.push("</svg>");
  host.innerHTML = parts.join("");
  if (!wantsAreas) return null;

  // Convert square SVG units to (s/d)²: one outer radius spans the whole range.
  const ratePerPixel = (domain.max - domain.min) / OUTER_RADIUS;
  const scale = ratePerPixel * ratePerPixel;
  const px = samples ? areasFromSamples(samples, zeroRadius) : { fast: 0, slow: 0, total: 0 };
  return { fast: px.fast * scale, slow: px.slow * scale, total: px.total * scale };
}
