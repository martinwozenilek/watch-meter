import { POSITIONS, isPosition, type Position, type Session } from "./model";

const SESSIONS_KEY = "watch-meter:sessions:v1";
const DRAFT_KEY = "watch-meter:draft:v1";

export interface Draft {
  watch: string;
  values: Record<Position, string>;
  wrist?: string;
}

/**
 * The only validation for stored and imported sessions. It checks the fields
 * it knows and passes the object through unchanged, so a new session field
 * is accepted with any value until a type check is added here.
 */
export function isSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<Session>;
  if (typeof session.id !== "string") return false;
  if (typeof session.watch !== "string") return false;
  if (typeof session.measuredAt !== "string") return false;
  if (!Number.isFinite(Date.parse(session.measuredAt))) return false;
  if (!Array.isArray(session.readings) || session.readings.length !== POSITIONS.length) return false;

  const readingsOk = session.readings.every(
    (reading) =>
      !!reading &&
      typeof reading === "object" &&
      isPosition((reading as { position?: unknown }).position) &&
      typeof (reading as { drift?: unknown }).drift === "number" &&
      Number.isFinite((reading as { drift: number }).drift),
  );
  if (!readingsOk) return false;

  // Each position exactly once; otherwise loading leaves some inputs stale.
  const positions = new Set(session.readings.map((reading) => reading.position));
  if (positions.size !== POSITIONS.length) return false;

  if (session.wristDrift !== undefined && session.wristDrift !== null) {
    if (typeof session.wristDrift !== "number" || !Number.isFinite(session.wristDrift)) {
      return false;
    }
  }

  return true;
}

export function newestFirst(a: Session, b: Session): number {
  return Date.parse(b.measuredAt) - Date.parse(a.measuredAt);
}

export interface ImportResult {
  sessions: Session[];
  added: number;
  /** Already present (same id) or listed twice in the file. */
  duplicates: number;
  /** Failed `isSession`. */
  invalid: number;
}

/**
 * Accepts an export (`{ sessions: [...] }`) or a bare array. Sessions whose
 * id is already known are skipped, so re-importing a backup changes nothing.
 */
export function importSessions(existing: Session[], parsed: unknown): ImportResult {
  const incoming: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { sessions?: unknown }).sessions)
      ? (parsed as { sessions: unknown[] }).sessions
      : [];

  const known = new Set(existing.map((session) => session.id));
  const sessions = [...existing];
  let added = 0;
  let duplicates = 0;
  let invalid = 0;
  for (const candidate of incoming) {
    if (!isSession(candidate)) {
      invalid += 1;
    } else if (known.has(candidate.id)) {
      duplicates += 1;
    } else {
      known.add(candidate.id);
      sessions.push(candidate);
      added += 1;
    }
  }
  sessions.sort(newestFirst);
  return { sessions, added, duplicates, invalid };
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

/**
 * Restores a saved draft. Known fields are copied one by one, so a new form
 * field must be added to `Draft` and here, or it is not restored on reload.
 */
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
