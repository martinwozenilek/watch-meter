import { describe, expect, it } from "vitest";

import {
  axisDomain,
  chartDomain,
  driftExtremes,
  driftSign,
  formatRate,
  orderReadings,
  parseRate,
  radialFraction,
  type Reading,
} from "./model";

const readings: Reading[] = [
  { position: "dialDown", drift: -1.2 },
  { position: "dialUp", drift: 0.8 },
  { position: "12up", drift: 3.4 },
  { position: "3up", drift: 1.6 },
  { position: "6up", drift: -2.7 },
  { position: "9up", drift: 2.1 },
];

describe("parseRate", () => {
  it("accepts signs, decimal commas and units", () => {
    expect(parseRate("2.5")).toBe(2.5);
    expect(parseRate("+2.5")).toBe(2.5);
    expect(parseRate("-3")).toBe(-3);
    expect(parseRate("2,5")).toBe(2.5);
    expect(parseRate(" 2.5 s/d ")).toBe(2.5);
    expect(parseRate("2.5 sec/day")).toBe(2.5);
    expect(parseRate(".5")).toBe(0.5);
  });

  it("rejects anything that is not a plain signed decimal", () => {
    for (const raw of ["", "  ", "+", "-", "abc", "1e3", "1.2.3", "--1", "Infinity"]) {
      expect(parseRate(raw)).toBeNull();
    }
  });
});

describe("formatRate", () => {
  it("adds a sign and trims trailing zeros", () => {
    expect(formatRate(2.5)).toBe("+2.5");
    expect(formatRate(-3)).toBe("-3");
    expect(formatRate(1.234)).toBe("+1.23");
  });

  it("shows tiny values and non-finite values as 0", () => {
    expect(formatRate(0)).toBe("0");
    expect(formatRate(-0.004)).toBe("0");
    expect(formatRate(Number.NaN)).toBe("0");
  });

  it("rounds positive and negative values symmetrically", () => {
    expect(formatRate(-0.125)).toBe("-0.13");
    expect(formatRate(0.125)).toBe("+0.13");
  });
});

describe("driftSign", () => {
  it("agrees with formatRate", () => {
    expect(driftSign(1)).toBe("fast");
    expect(driftSign(-1)).toBe("slow");
    expect(driftSign(-0.001)).toBe("flat");
    expect(driftSign(0.004)).toBe("flat");
  });
});

describe("axisDomain", () => {
  it("picks the smallest nice step at or above the largest magnitude", () => {
    expect(axisDomain([3.4, -2.7])).toBe(4);
    expect(axisDomain([-12])).toBe(12);
    expect(axisDomain([-13])).toBe(15);
    expect(axisDomain([5])).toBe(5);
    expect(axisDomain([0.07])).toBeCloseTo(0.08, 10);
  });

  it("falls back to 1 when every value is zero", () => {
    expect(axisDomain([])).toBe(1);
    expect(axisDomain([0, 0])).toBe(1);
  });
});

describe("chartDomain", () => {
  it("includes the on-wrist value", () => {
    expect(chartDomain(readings)).toBe(4);
    expect(chartDomain(readings, 9)).toBe(10);
    expect(chartDomain(readings, null)).toBe(4);
  });
});

describe("driftExtremes", () => {
  it("finds the fastest and slowest reading regardless of order", () => {
    const fixed = orderReadings(readings, "fixed");
    const extremes = driftExtremes(fixed);

    expect(extremes?.fast.position).toBe("12up");
    expect(extremes?.slow.position).toBe("6up");
    expect(driftExtremes([])).toBeNull();
  });
});

describe("orderReadings", () => {
  it("sorts by drift or by physical position without mutating the input", () => {
    const copy = [...readings];
    expect(orderReadings(readings, "sorted").map((reading) => reading.position)).toEqual([
      "12up",
      "9up",
      "3up",
      "dialUp",
      "dialDown",
      "6up",
    ]);
    expect(orderReadings(readings, "fixed").map((reading) => reading.position)).toEqual([
      "12up",
      "3up",
      "6up",
      "9up",
      "dialDown",
      "dialUp",
    ]);
    expect(readings).toEqual(copy);
  });
});

describe("radialFraction", () => {
  it("maps -domain, 0 and +domain to the centre, the zero ring and the edge", () => {
    expect(radialFraction(-4, 4)).toBe(0);
    expect(radialFraction(0, 4)).toBe(0.5);
    expect(radialFraction(4, 4)).toBe(1);
  });

  it("clamps out-of-range values and guards a bad domain", () => {
    expect(radialFraction(10, 4)).toBe(1);
    expect(radialFraction(-10, 4)).toBe(0);
    expect(radialFraction(1, 0)).toBe(0.5);
  });
});
