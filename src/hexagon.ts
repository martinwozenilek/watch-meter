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

/**
 * Closed Catmull-Rom spline converted to cubic Béziers. `tension` below 1
 * tightens the curve so it stays close to the measured points.
 */
export function smoothClosedPath(points: Point[], tension = 0.85): string {
  const count = points.length;
  if (count < 3) return "";

  let path = `M ${round(points[0].x)} ${round(points[0].y)}`;
  for (let i = 0; i < count; i += 1) {
    const previous = points[(i - 1 + count) % count];
    const current = points[i];
    const next = points[(i + 1) % count];
    const afterNext = points[(i + 2) % count];

    const control1x = current.x + ((next.x - previous.x) * tension) / 6;
    const control1y = current.y + ((next.y - previous.y) * tension) / 6;
    const control2x = next.x - ((afterNext.x - current.x) * tension) / 6;
    const control2y = next.y - ((afterNext.y - current.y) * tension) / 6;

    path += ` C ${round(control1x)} ${round(control1y)}, ${round(control2x)} ${round(
      control2y,
    )}, ${round(next.x)} ${round(next.y)}`;
  }
  return `${path} Z`;
}

/** Get a point on the smoothed closed curve at parameter t in [0,1). */
function pointOnSmoothPath(points: Point[], t: number, tension = 0.85): Point | null {
  const count = points.length;
  if (count < 3) return null;

  const u = ((t % 1) + 1) % 1;
  const segment = u * count;
  let i = Math.floor(segment);
  const s = segment - i;
  if (i === count) {
    i = 0;
  }

  const previous = points[(i - 1 + count) % count];
  const current = points[i];
  const next = points[(i + 1) % count];
  const afterNext = points[(i + 2) % count];

  const c1x = current.x + ((next.x - previous.x) * tension) / 6;
  const c1y = current.y + ((next.y - previous.y) * tension) / 6;
  const c2x = next.x - ((afterNext.x - current.x) * tension) / 6;
  const c2y = next.y - ((afterNext.y - current.y) * tension) / 6;

  // Cubic Bézier: P = (1-s)^3*P0 + 3*(1-s)^2*s*P1 + 3*(1-s)*s^2*P2 + s^3*P3
  const p0 = current;
  const p1 = { x: c1x, y: c1y };
  const p2 = { x: c2x, y: c2y };
  const p3 = next;
  const s2 = s * s;
  const s3 = s2 * s;
  const mt = 1 - s;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;

  return {
    x: mt3 * p0.x + 3 * mt2 * s * p1.x + 3 * mt * s2 * p2.x + s3 * p3.x,
    y: mt3 * p0.y + 3 * mt2 * s * p1.y + 3 * mt * s2 * p2.y + s3 * p3.y,
  };
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

/** Area samples per lap. Dense enough that the chord error is invisible. */
const AREA_SAMPLES = 1440;

function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

function signedAngle(a: Point, b: Point): number {
  return Math.atan2(cross(a, b), a.x * b.x + a.y * b.y);
}

/**
 * Signed area of the part of triangle (origin, a, b) that falls inside a
 * circle of `radius` centred on the origin. The triangle is split where the
 * edge crosses the circle: inner pieces stay triangles, outer pieces become
 * circular sectors.
 */
function triangleDiskArea(a: Point, b: Point, radius: number): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const quadA = dx * dx + dy * dy;
  if (quadA < 1e-12) return 0;

  const quadB = 2 * (a.x * dx + a.y * dy);
  const quadC = a.x * a.x + a.y * a.y - radius * radius;
  const discriminant = quadB * quadB - 4 * quadA * quadC;

  const stops = [0, 1];
  if (discriminant > 0) {
    const root = Math.sqrt(discriminant);
    for (const t of [(-quadB - root) / (2 * quadA), (-quadB + root) / (2 * quadA)]) {
      if (t > 0 && t < 1) stops.push(t);
    }
  }
  stops.sort((left, right) => left - right);

  let area = 0;
  for (let i = 0; i < stops.length - 1; i += 1) {
    const t0 = stops[i];
    const t1 = stops[i + 1];
    if (t1 - t0 < 1e-12) continue;
    const p0 = { x: a.x + dx * t0, y: a.y + dy * t0 };
    const p1 = { x: a.x + dx * t1, y: a.y + dy * t1 };
    const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    area +=
      Math.hypot(mid.x, mid.y) <= radius
        ? cross(p0, p1) / 2
        : (radius * radius * signedAngle(p0, p1)) / 2;
  }
  return area;
}

/**
 * Area of the smoothed closed curve inside and outside the zero ring, in
 * square SVG units. The curve is sampled into a polygon; the signed fan
 * decomposition makes the ring split exact for that polygon.
 */
export function enclosedAreas(points: Point[], zeroRadius: number, tension = 0.85): ZoneAreas {
  const samples: Point[] = [];
  for (let i = 0; i < AREA_SAMPLES; i += 1) {
    const point = pointOnSmoothPath(points, i / AREA_SAMPLES, tension);
    if (point) samples.push({ x: point.x - CENTER, y: point.y - CENTER });
  }
  if (samples.length < 3) return { fast: 0, slow: 0, total: 0 };

  let total = 0;
  let inside = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const a = samples[i];
    const b = samples[(i + 1) % samples.length];
    total += cross(a, b) / 2;
    inside += triangleDiskArea(a, b, zeroRadius);
  }

  const area = Math.abs(total);
  const slow = Math.min(area, Math.abs(inside));
  return { fast: area - slow, slow, total: area };
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
export function projectToCurve(points: Point[], targetFraction: number, tension = 0.85): Point[] {
  if (points.length < 3) return [];

  const sampleAt = (t: number): { point: Point; offset: number } => {
    const point = pointOnSmoothPath(points, t, tension)!;
    const fraction = Math.hypot(point.x - CENTER, point.y - CENTER) / OUTER_RADIUS;
    return { point, offset: fraction - targetFraction };
  };

  const samples = Array.from({ length: PROJECTION_SAMPLES }, (_, i) => sampleAt(i / PROJECTION_SAMPLES));
  const hits: Point[] = [];
  for (let i = 0; i < samples.length; i += 1) {
    const current = samples[i];
    const next = samples[(i + 1) % samples.length];
    if (Math.abs(current.offset) < 1e-9) {
      hits.push(current.point);
    } else if (Math.abs(next.offset) >= 1e-9 && current.offset * next.offset < 0) {
      let low = i / PROJECTION_SAMPLES;
      let high = (i + 1) / PROJECTION_SAMPLES;
      let lowOffset = current.offset;
      for (let step = 0; step < 20; step += 1) {
        const mid = (low + high) / 2;
        const sample = sampleAt(mid);
        if (sample.offset * lowOffset > 0) {
          low = mid;
          lowOffset = sample.offset;
        } else {
          high = mid;
        }
      }
      hits.push(sampleAt((low + high) / 2).point);
    }
  }

  const markers: Point[] = [];
  for (const hit of hits) {
    if (markers.every((marker) => Math.hypot(marker.x - hit.x, marker.y - hit.y) >= MIN_MARKER_GAP)) {
      markers.push(hit);
    }
  }
  if (markers.length > 0) return markers;

  let best = samples[0];
  for (const sample of samples) {
    if (Math.abs(sample.offset) < Math.abs(best.offset)) best = sample;
  }
  return [best.point];
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

  const summary = readings
    .map((reading) => `${positionLabel(reading.position)} ${formatRate(reading.drift)}`)
    .join(", ");

  clipIdCounter += 1;
  const clipId = `wm-hex-clip-${clipIdCounter}`;

  const parts: string[] = [];
  const wristLabel = wristDrift !== undefined && wristDrift !== null ? `, on wrist ${formatRate(wristDrift)} s/d` : "";
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
  if (wristDrift !== undefined && wristDrift !== null) {
    const targetFraction = radialFraction(wristDrift, domain);
    for (const wristPoint of projectToCurve(points, targetFraction)) {
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
  if (options.areas === false) return null;

  // Convert square SVG units to (s/d)²: one outer radius spans the whole range.
  const ratePerPixel = (domain.max - domain.min) / OUTER_RADIUS;
  const scale = ratePerPixel * ratePerPixel;
  const px = enclosedAreas(points, zeroRadius);
  return { fast: px.fast * scale, slow: px.slow * scale, total: px.total * scale };
}
