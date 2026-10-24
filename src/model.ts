export const POSITIONS = ["dialDown", "dialUp", "12up", "3up", "6up", "9up"] as const;

export type Position = (typeof POSITIONS)[number];
export type AxisOrder = "sorted" | "fixed";

export const POSITION_LABELS: Record<Position, string> = {
  dialDown: "Dial down",
  dialUp: "Dial up",
  "12up": "12 up",
  "3up": "3 up",
  "6up": "6 up",
  "9up": "9 up",
};

/** Canonical order for the "positions" view: clockwise from 12 o'clock. */
export const FIXED_AXIS_ORDER: readonly Position[] = [
  "12up",
  "3up",
  "6up",
  "9up",
  "dialDown",
  "dialUp",
];

export interface Reading {
  position: Position;
  drift: number;
}

export interface Session {
  id: string;
  watch: string;
  measuredAt: string;
  readings: Reading[];
  wristDrift?: number | null;
}

export function positionLabel(position: Position): string {
  return POSITION_LABELS[position];
}

export function isPosition(value: unknown): value is Position {
  return typeof value === "string" && (POSITIONS as readonly string[]).includes(value);
}

/**
 * Accepts "2.5", "+2.5", "-3", "2,5", "2.5 s/d", "2.5 sec/day".
 * Returns null for anything that is not a plain signed decimal.
 */
export function parseRate(raw: string): number | null {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/s(?:ec)?\s*\/\s*d(?:ay)?/g, "")
    .replace(/,/g, ".")
    .replace(/\s+/g, "");

  if (cleaned === "") return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(cleaned)) return null;

  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Formats with a sign, at most two decimals, no trailing zeros. */
export function formatRate(value: number): string {
  // Round the magnitude so -2.345 and +2.345 round the same way.
  const rounded = Math.sign(value) * (Math.round(Math.abs(value) * 100) / 100);
  if (!Number.isFinite(rounded) || Math.abs(rounded) < 0.005) return "0";

  const magnitude = Math.abs(rounded).toFixed(2).replace(/\.?0+$/, "");
  return `${rounded > 0 ? "+" : "-"}${magnitude}`;
}

export function orderReadings(readings: Reading[], order: AxisOrder): Reading[] {
  if (order === "fixed") {
    return [...readings].sort(
      (a, b) => FIXED_AXIS_ORDER.indexOf(a.position) - FIXED_AXIS_ORDER.indexOf(b.position),
    );
  }
  // Descending drift; Array.prototype.sort is stable, so ties keep the input order.
  return [...readings].sort((a, b) => b.drift - a.drift);
}

const NICE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** The smallest "nice" number at or above the largest absolute value; 1 when all are zero. */
export function axisDomain(values: number[]): number {
  const maxAbs = values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  if (maxAbs === 0 || !Number.isFinite(maxAbs)) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(maxAbs));
  const normalized = maxAbs / magnitude;
  const step = NICE_STEPS.find((candidate) => normalized <= candidate + 1e-9) ?? 10;
  return step * magnitude;
}

/**
 * Radial range of a chart: the centre is `min`, the outer edge is `max`, and
 * `min <= 0 <= max`. Each side is rounded up to a nice number on its own; a
 * side with no values collapses to 0, so zero sits on the centre or the edge.
 */
export interface Domain {
  min: number;
  max: number;
}

/** Domain for a chart: covers every reading and the on-wrist value, if any. */
export function chartDomain(readings: Reading[], wristDrift?: number | null): Domain {
  const values = readings.map((reading) => reading.drift);
  if (wristDrift !== undefined && wristDrift !== null) values.push(wristDrift);
  const fastest = values.reduce((max, value) => Math.max(max, value), 0);
  const slowest = values.reduce((min, value) => Math.min(min, value), 0);
  if (fastest === 0 && slowest === 0) return { min: -1, max: 1 };
  return {
    min: slowest < 0 ? -axisDomain([slowest]) : 0,
    max: fastest > 0 ? axisDomain([fastest]) : 0,
  };
}

/** Fastest and slowest reading, independent of axis order. Ties keep the input order. */
export function driftExtremes(readings: Reading[]): { fast: Reading; slow: Reading } | null {
  if (readings.length === 0) return null;
  let fast = readings[0];
  let slow = readings[0];
  for (const reading of readings) {
    if (reading.drift > fast.drift) fast = reading;
    if (reading.drift < slow.drift) slow = reading;
  }
  return { fast, slow };
}

/** Mean drift across the readings; null when there are none. */
export function averageDrift(readings: Reading[]): number | null {
  if (readings.length === 0) return null;
  return readings.reduce((sum, reading) => sum + reading.drift, 0) / readings.length;
}

export type DriftSign = "fast" | "slow" | "flat";

/** Follows `formatRate`, so a value displayed as "0" is always flat. */
export function driftSign(drift: number): DriftSign {
  const formatted = formatRate(drift);
  if (formatted === "0") return "flat";
  return formatted.startsWith("-") ? "slow" : "fast";
}

/** 0 at the centre (`domain.min`), 1 at the outer edge (`domain.max`). */
export function radialFraction(drift: number, domain: Domain): number {
  const span = domain.max - domain.min;
  if (!(span > 0)) return 0.5;
  return Math.min(1, Math.max(0, (drift - domain.min) / span));
}
