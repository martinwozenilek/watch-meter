import { describe, expect, it } from "vitest";

import { importSessions, isSession } from "./storage";
import type { Session } from "./model";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "a",
    watch: "Test",
    measuredAt: "2026-10-24T13:41:00.000Z",
    readings: [
      { position: "dialDown", drift: -1.2 },
      { position: "dialUp", drift: 0.8 },
      { position: "12up", drift: 3.4 },
      { position: "3up", drift: 1.6 },
      { position: "6up", drift: -2.7 },
      { position: "9up", drift: 2.1 },
    ],
    ...overrides,
  };
}

describe("isSession", () => {
  it("accepts a complete session with or without wristDrift", () => {
    expect(isSession(session())).toBe(true);
    expect(isSession(session({ wristDrift: 1.8 }))).toBe(true);
    expect(isSession(session({ wristDrift: null }))).toBe(true);
  });

  it("rejects missing fields and non-finite numbers", () => {
    expect(isSession(null)).toBe(false);
    expect(isSession({ ...session(), id: 1 })).toBe(false);
    expect(isSession(session({ wristDrift: Number.NaN }))).toBe(false);
    const readings = session().readings.map((reading, index) =>
      index === 0 ? { ...reading, drift: Number.POSITIVE_INFINITY } : reading,
    );
    expect(isSession(session({ readings }))).toBe(false);
  });

  it("rejects an unparseable date", () => {
    expect(isSession(session({ measuredAt: "yesterday-ish" }))).toBe(false);
  });

  it("rejects the wrong number of readings", () => {
    expect(isSession(session({ readings: session().readings.slice(0, 5) }))).toBe(false);
  });

  it("rejects a repeated position", () => {
    const readings = session().readings.map((reading) => ({ ...reading, position: "12up" as const }));
    expect(isSession(session({ readings }))).toBe(false);
  });
});

describe("importSessions", () => {
  it("accepts an export object or a bare array", () => {
    expect(importSessions([], { sessions: [session()] }).added).toBe(1);
    expect(importSessions([], [session()]).added).toBe(1);
    expect(importSessions([], { nothing: true }).added).toBe(0);
  });

  it("skips ids that are already saved, so re-importing changes nothing", () => {
    const existing = [session()];
    const result = importSessions(existing, { sessions: [session()] });

    expect(result.added).toBe(0);
    expect(result.duplicates).toBe(1);
    expect(result.sessions).toHaveLength(1);
  });

  it("skips a repeated id within the same file", () => {
    const result = importSessions([], [session(), session({ watch: "Copy" })]);

    expect(result.added).toBe(1);
    expect(result.duplicates).toBe(1);
  });

  it("counts invalid entries and sorts newest first", () => {
    const older = session({ id: "old", measuredAt: "2025-01-01T00:00:00.000Z" });
    const newer = session({ id: "new", measuredAt: "2026-01-01T00:00:00.000Z" });
    const result = importSessions([older], [newer, { id: "broken" }]);

    expect(result.invalid).toBe(1);
    expect(result.sessions.map((entry) => entry.id)).toEqual(["new", "old"]);
  });

  it("does not modify the existing array", () => {
    const existing = [session()];
    importSessions(existing, [session({ id: "b" })]);
    expect(existing).toHaveLength(1);
  });
});
