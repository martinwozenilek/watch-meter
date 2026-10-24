import { driftSign, formatRate, positionLabel, type Domain, type Reading } from "./model";

const WIDTH = 520;
const ROW_HEIGHT = 30;
const TOP = 14;
const BOTTOM = 30;
const LABEL_WIDTH = 96;
const VALUE_WIDTH = 72;
const BAR_LEFT = LABEL_WIDTH + 14;
const BAR_RIGHT = WIDTH - VALUE_WIDTH;

const round = (value: number): string => String(Math.round(value * 100) / 100);

export function renderBars(host: HTMLElement, readings: Reading[], domain: Domain): void {
  const height = TOP + readings.length * ROW_HEIGHT + BOTTOM;
  const span = domain.max - domain.min;
  const xFor = (drift: number): number =>
    BAR_LEFT + ((Math.max(domain.min, Math.min(domain.max, drift)) - domain.min) / span) * (BAR_RIGHT - BAR_LEFT);
  const zeroX = xFor(0);

  const summary = readings
    .map((reading) => `${positionLabel(reading.position)} ${formatRate(reading.drift)}`)
    .join(", ");

  const parts: string[] = [];
  parts.push(
    `<svg viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="Drift by position. ${summary}, in seconds per day.">`,
  );

  // Zero line.
  parts.push(
    `<line x1="${round(zeroX)}" y1="${TOP - 4}" x2="${round(zeroX)}" y2="${round(
      TOP + readings.length * ROW_HEIGHT + 4,
    )}" class="bar-zero" />`,
  );

  readings.forEach((reading, index) => {
    const centerY = TOP + index * ROW_HEIGHT + ROW_HEIGHT / 2;
    const barTop = centerY - 7;
    const tip = xFor(reading.drift);
    const length = Math.abs(tip - zeroX);
    // Bars too short to see get a 2px stub centred on zero, whatever their sign.
    const width = Math.max(2, length);
    const barLeft = length < 2 ? zeroX - 1 : Math.min(zeroX, tip);

    parts.push(
      `<text x="${LABEL_WIDTH}" y="${round(centerY)}" class="bar-label" text-anchor="end" ` +
        `dominant-baseline="middle">${positionLabel(reading.position)}</text>`,
    );
    parts.push(
      `<rect x="${round(barLeft)}" y="${round(barTop)}" width="${round(width)}" height="14" ` +
        `rx="3" class="bar-fill ${driftSign(reading.drift)}" />`,
    );
    parts.push(
      `<text x="${WIDTH - 10}" y="${round(centerY)}" class="bar-value ${driftSign(
        reading.drift,
      )}" text-anchor="end" dominant-baseline="middle">${formatRate(reading.drift)}</text>`,
    );
  });

  // Scale.
  const scaleY = height - 9;
  for (const value of [...new Set([domain.min, 0, domain.max])]) {
    parts.push(
      `<text x="${round(xFor(value))}" y="${scaleY}" class="bar-scale" text-anchor="middle">${formatRate(
        value,
      )}</text>`,
    );
  }

  parts.push("</svg>");
  host.innerHTML = parts.join("");
}
