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

  it("pins the straddling split, including edges that cross the ring twice", () => {
    const points = [
      { x: CENTER + 80, y: CENTER },
      { x: CENTER, y: CENTER + 20 },
      { x: CENTER - 80, y: CENTER },
      { x: CENTER, y: CENTER - 20 },
    ];

    // Golden values from the sampler. They depend on the AREA_SAMPLES density;
    // a denser or sparser pass legitimately shifts them.
    const areas = enclosedAreas(points, 40);
    expect(areas.slow).toBeCloseTo(2783.22057, 4);
    expect(areas.fast).toBeCloseTo(1427.70174, 4);
    expect(areas.total).toBeCloseTo(4210.92231, 4);

    // Ring 20 grazes the curve near the radius-20 points, so some sample
    // edges cross the ring twice. Each edge's stop list must come out in
    // ascending order: a mis-ordered list counts whole chords as inside and
    // pushes the slow zone past the disk itself (docs/optimization-findings.md,
    // finding 2).
    const grazing = enclosedAreas(points, 20);
    expect(grazing.slow).toBeLessThan(Math.PI * 20 * 20);
    expect(grazing.slow).toBeGreaterThan(Math.PI * 20 * 20 - 0.001);
    expect(grazing.slow).toBeCloseTo(1256.63706, 4);
    expect(grazing.fast).toBeCloseTo(2954.28526, 4);
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

  it("pins the refined marker positions", () => {
    // Same alternating shape as the crossing test. The goldens lock where the
    // 20-step bisection lands, in scan order; they depend on the
    // PROJECTION_SAMPLES density, so a different count legitimately shifts them.
    const points = Array.from({ length: 6 }, (_, index) => {
      const angle = (-90 + index * 60) * (Math.PI / 180);
      const radius = index % 2 === 0 ? 100 : 40;
      return { x: CENTER + Math.cos(angle) * radius, y: CENTER + Math.sin(angle) * radius };
    });
    const hits = projectToCurve(points, 70 / 142);

    expect(hits).toHaveLength(6);
    const goldens: Array<[number, number]> = [
      [256.36963, 171.94094],
      [307.12569, 259.85301],
      [290.75606, 288.20604],
      [189.24394, 288.20604],
      [172.87431, 259.85301],
      [223.63037, 171.94094],
    ];
    hits.forEach((hit, index) => {
      expect(hit.x).toBeCloseTo(goldens[index][0], 4);
      expect(hit.y).toBeCloseTo(goldens[index][1], 4);
    });
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
