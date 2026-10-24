import { isPosition, type Position, type Session } from "./model";

const SESSIONS_KEY = "watch-meter:sessions:v1";
const DRAFT_KEY = "watch-meter:draft:v1";

export interface Draft {
  watch: string;
  values: Record<Position, string>;
  wrist?: string;
}

export function isSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<Session>;
  if (typeof session.id !== "string") return false;
  if (typeof session.watch !== "string") return false;
  if (typeof session.measuredAt !== "string") return false;
  if (!Array.isArray(session.readings) || session.readings.length !== 6) return false;

  const readingsOk = session.readings.every(
    (reading) =>
      !!reading &&
      typeof reading === "object" &&
      isPosition((reading as { position?: unknown }).position) &&
      typeof (reading as { drift?: unknown }).drift === "number" &&
      Number.isFinite((reading as { drift: number }).drift),
  );
  if (!readingsOk) return false;

  if (session.wristDrift !== undefined && session.wristDrift !== null) {
    if (typeof session.wristDrift !== "number" || !Number.isFinite(session.wristDrift)) {
      return false;
    }
  }

  return true;
}

function newestFirst(a: Session, b: Session): number {
  return Date.parse(b.measuredAt) - Date.parse(a.measuredAt);
}

export function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSession).sort(newestFirst);
  } catch {
    return [];
  }
}

export function saveSessions(sessions: Session[]): void {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // Storage may be unavailable (private mode, quota); the app still works in memory.
  }
}

export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const draft = parsed as Partial<Draft>;
    if (typeof draft.watch !== "string" || !draft.values || typeof draft.values !== "object") {
      return null;
    }

    const values = {} as Record<Position, string>;
    for (const [position, value] of Object.entries(draft.values)) {
      if (isPosition(position) && typeof value === "string") values[position] = value;
    }
    const result: Draft = { watch: draft.watch, values };
    if (typeof draft.wrist === "string") result.wrist = draft.wrist;
    return result;
  } catch {
    return null;
  }
}

export function saveDraft(draft: Draft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // ignore
  }
}
