import { describe, expect, it } from "vitest";

import { enclosedAreas, projectToCurve } from "./hexagon";

const CENTER = 240;

function onCircle(radius: number, count = 6): { x: number; y: number }[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (-90 + (index * 360) / count) * (Math.PI / 180);
    return { x: CENTER + Math.cos(angle) * radius, y: CENTER + Math.sin(angle) * radius };
  });
}

describe("enclosedAreas", () => {
  it("puts the whole zero disk in the slow zone when every sample is outside it", () => {
    const zeroRadius = 30;
    const areas = enclosedAreas(onCircle(60), zeroRadius);

    expect(areas.slow).toBeCloseTo(Math.PI * zeroRadius * zeroRadius, 3);
    expect(areas.fast).toBeCloseTo(areas.total - areas.slow, 6);
    // A spline through a hexagon of radius 60 sits between the hexagon and the circle.
    expect(areas.total).toBeGreaterThan(2.598 * 60 * 60);
    expect(areas.total).toBeLessThan(Math.PI * 60 * 60);
  });

  it("has no fast zone when the whole shape is inside the zero ring", () => {
    const areas = enclosedAreas(onCircle(20), 30);

    expect(areas.fast).toBeCloseTo(0, 6);
    expect(areas.slow).toBeCloseTo(areas.total, 6);
    expect(areas.total).toBeGreaterThan(0);
  });

  it("splits symmetrically when the shape straddles the ring", () => {
    const points = [
      { x: CENTER + 80, y: CENTER },
      { x: CENTER, y: CENTER + 20 },
      { x: CENTER - 80, y: CENTER },
      { x: CENTER, y: CENTER - 20 },
    ];
    const areas = enclosedAreas(points, 40);

    expect(areas.total).toBeGreaterThan(0);
    expect(areas.fast + areas.slow).toBeCloseTo(areas.total, 6);
    expect(areas.slow).toBeGreaterThan(0);
    expect(areas.fast).toBeGreaterThan(0);
  });

  it("returns zero areas for degenerate input", () => {
    expect(enclosedAreas([], 10)).toEqual({ fast: 0, slow: 0, total: 0 });
  });
});

describe("projectToCurve", () => {
  const radiusOf = (point: { x: number; y: number }): number =>
    Math.hypot(point.x - CENTER, point.y - CENTER);

  it("marks every place the curve crosses the target radius", () => {
    // Alternating 40/100 radii: the curve crosses 70 twice per lobe, six times in all.
    const points = Array.from({ length: 6 }, (_, index) => {
      const angle = (-90 + index * 60) * (Math.PI / 180);
      const radius = index % 2 === 0 ? 100 : 40;
      return { x: CENTER + Math.cos(angle) * radius, y: CENTER + Math.sin(angle) * radius };
    });
    const hits = projectToCurve(points, 70 / 142);

    expect(hits).toHaveLength(6);
    for (const hit of hits) expect(radiusOf(hit)).toBeCloseTo(70, 3);
  });

  it("falls back to the nearest point when the curve never reaches the target", () => {
    const hits = projectToCurve(onCircle(60), 1);

    expect(hits).toHaveLength(1);
    expect(radiusOf(hits[0])).toBeGreaterThan(60);
  });

  it("returns nothing for degenerate input", () => {
    expect(projectToCurve([], 0.5)).toEqual([]);
  });
});
