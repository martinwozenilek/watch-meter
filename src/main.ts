import "./style.css";

import {
  POSITIONS,
  positionLabel,
  parseRate,
  formatRate,
  orderReadings,
  axisDomain,
  type AxisOrder,
  type Position,
  type Reading,
  type Session,
} from "./model";
import { loadDraft, saveDraft, loadSessions, saveSessions, isSession } from "./storage";
import { renderHexagon, type ZoneAreas } from "./hexagon";
import { renderBars } from "./bars";

const form = document.getElementById("readings-form") as HTMLFormElement;
const watchName = document.getElementById("watch-name") as HTMLInputElement;
const wristInput = document.getElementById("wrist-drift") as HTMLInputElement;
const wristStatus = document.getElementById("wrist-status") as HTMLSpanElement;
const saveButton = document.getElementById("save-session") as HTMLButtonElement;
const exampleButton = document.getElementById("example") as HTMLButtonElement;
const resetButton = document.getElementById("reset") as HTMLButtonElement;
const chartHost = document.getElementById("chart") as HTMLElement;
const barsHost = document.getElementById("bars") as HTMLElement;
const caption = document.getElementById("chart-caption") as HTMLElement;
const chartModal = document.getElementById("chart-modal") as HTMLElement;
const chartModalChart = document.getElementById("chart-modal-chart") as HTMLElement;
const chartModalCaption = document.getElementById("chart-modal-caption") as HTMLElement;
const chartModalClose = document.getElementById("chart-modal-close") as HTMLButtonElement;
const zoneAreasEl = document.getElementById("zone-areas") as HTMLElement;
const chartModalAreas = document.getElementById("chart-modal-areas") as HTMLElement;

let lastZoomData: {
  readings: Reading[];
  domain: number;
  wrist: number | null;
  areas: ZoneAreas;
} | null = null;

/** Percentage of the enclosed area that sits on one side of the zero ring. */
function share(part: number, total: number): string {
  if (!(total > 0) || !Number.isFinite(part)) return "0.0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

function formatArea(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 0.01) return "<0.01";
  return value.toFixed(2);
}

function zoneAreaChip(kind: "fast" | "slow", label: string, part: number, total: number): HTMLElement {
  const chip = document.createElement("div");
  chip.className = "zone-area";

  const name = document.createElement("span");
  name.className = "zone-area-name";
  const swatch = document.createElement("i");
  swatch.className = `swatch swatch-${kind}`;
  name.append(swatch, document.createTextNode(label));

  const value = document.createElement("strong");
  value.className = `zone-area-value ${kind}`;
  value.textContent = share(part, total);

  const absolute = document.createElement("span");
  absolute.className = "zone-area-abs";
  absolute.textContent = `${formatArea(part)} s/d²`;

  chip.append(name, value, absolute);
  return chip;
}

function renderZoneAreas(host: HTMLElement, areas: ZoneAreas | null): void {
  host.innerHTML = "";
  if (!areas || !(areas.total > 0)) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  host.append(
    zoneAreaChip("fast", "Fast area", areas.fast, areas.total),
    zoneAreaChip("slow", "Slow area", areas.slow, areas.total),
  );
}

function openZoom(): void {
  if (!lastZoomData) return;
  chartModalChart.innerHTML = "";
  renderHexagon(chartModalChart, lastZoomData.readings, lastZoomData.domain, lastZoomData.wrist);
  renderZoneAreas(chartModalAreas, lastZoomData.areas);
  chartModalCaption.innerHTML = caption.innerHTML;
  chartModal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeZoom(): void {
  chartModal.hidden = true;
  document.body.style.overflow = "";
}

chartHost.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest("button, a, input")) return;
  openZoom();
});

chartModalChart.addEventListener("click", closeZoom);
chartModalClose.addEventListener("click", closeZoom);
chartModal.addEventListener("click", (event) => {
  if (event.target === chartModal) closeZoom();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !chartModal.hidden) closeZoom();
});
const orderButtons = document.querySelectorAll<HTMLButtonElement>(".seg button[data-order]");
const viewButtons = document.querySelectorAll<HTMLButtonElement>('.seg button[data-mode]');
const historyList = document.getElementById("history") as HTMLUListElement;
const exportButton = document.getElementById("export") as HTMLButtonElement;
const importButton = document.getElementById("import") as HTMLButtonElement;
const importFile = document.getElementById("import-file") as HTMLInputElement;
const toastEl = document.getElementById("toast") as HTMLElement;
const themeToggle = document.getElementById("theme-toggle") as HTMLButtonElement;
const themeLabel = document.getElementById("theme-label") as HTMLElement;

const THEME_KEY = "watch-meter:theme";
type Theme = "light" | "dark";

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  const isDark = theme === "dark";
  themeLabel.textContent = isDark ? "Light" : "Dark";
  themeToggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
  themeToggle.setAttribute("aria-pressed", isDark ? "true" : "false");
}

themeToggle.addEventListener("click", () => {
  const next: Theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // ignore storage failures
  }
  applyTheme(next);
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
  if (storedTheme()) return;
  applyTheme(event.matches ? "dark" : "light");
});

applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");

let sessions: Session[] = loadSessions();
let axisOrder: AxisOrder = "sorted";
type ViewMode = "measured" | "corrected";
let viewMode: ViewMode = "measured";

const fields = new Map<Position, HTMLInputElement>();

function toast(message: string): void {
  toastEl.textContent = message;
  toastEl.classList.add("visible");
  window.setTimeout(() => toastEl.classList.remove("visible"), 1400);
}

function buildForm(): void {
  form.innerHTML = "";
  for (const position of POSITIONS) {
    const field = document.createElement("label");
    field.className = "rate-field";
    field.innerHTML = `
      <span class="rate-label">${positionLabel(position)}</span>
      <div class="rate-input-wrap">
        <input class="rate-input" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="+0.0" />
        <span class="rate-unit">s/d</span>
      </div>
      <span class="rate-status" aria-live="polite"></span>
    `;
    const input = field.querySelector<HTMLInputElement>(".rate-input")!;
    const status = field.querySelector<HTMLSpanElement>(".rate-status")!;
    fields.set(position, input);

    input.addEventListener("input", () => {
      const parsed = parseRate(input.value);
      if (input.value.trim() === "") {
        status.textContent = "";
        status.classList.remove("error");
        persistDraft();
        updateChart();
        return;
      }
      if (parsed === null) {
        status.textContent = "Use a number like +2.5 or -3";
        status.classList.add("error");
      } else {
        status.textContent = "";
        status.classList.remove("error");
      }
      persistDraft();
      updateChart();
    });

    form.appendChild(field);
  }
}

function currentReadings(): Reading[] | null {
  const readings: Reading[] = [];
  for (const position of POSITIONS) {
    const input = fields.get(position)!;
    const parsed = parseRate(input.value);
    if (parsed === null) return null;
    readings.push({ position, drift: parsed });
  }
  return readings;
}

function currentWristDrift(): number | null {
  const parsed = parseRate(wristInput.value);
  if (wristInput.value.trim() === "") return null;
  return parsed;
}

function updateWristStatus(): void {
  const parsed = parseRate(wristInput.value);
  if (wristInput.value.trim() === "") {
    wristStatus.textContent = "";
    wristStatus.classList.remove("error");
    return;
  }
  if (parsed === null) {
    wristStatus.textContent = "Use a number like +2.5 or -3";
    wristStatus.classList.add("error");
  } else {
    wristStatus.textContent = "";
    wristStatus.classList.remove("error");
  }
}

function updateChart(): void {
  const readings = currentReadings();
  if (!readings) {
    chartHost.innerHTML = '<div class="empty">Enter all six rates to see the signature.</div>';
    barsHost.innerHTML = "";
    caption.textContent = "";
    renderZoneAreas(zoneAreasEl, null);
    return;
  }

  const wristDrift = currentWristDrift();
  updateWristStatus();

  let chartReadings = readings;
  let wristToShow = wristDrift;
  let captionPrefix = "";

  if (viewMode === "corrected") {
    if (wristDrift === null) {
      toast("Enter on-wrist drift to correct to 0");
      viewMode = "measured";
      for (const button of viewButtons) {
        const active = button.dataset.mode === "measured";
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      }
      updateChart();
      return;
    }
    const offset = -wristDrift;
    chartReadings = readings.map((reading) => ({ position: reading.position, drift: reading.drift + offset }));
    wristToShow = 0;
    captionPrefix = `Corrected to 0 on wrist (offset ${formatRate(offset)} s/d) &middot; `;
  }

  const ordered = orderReadings(chartReadings, axisOrder);
  const domainValues = chartReadings.map((reading) => reading.drift);
  if (wristToShow !== null) domainValues.push(wristToShow);
  const domain = axisDomain(domainValues);
  const areas = renderHexagon(chartHost, ordered, domain, wristToShow);
  renderZoneAreas(zoneAreasEl, areas);
  renderBars(barsHost, chartReadings, domain);

  lastZoomData = { readings: ordered, domain, wrist: wristToShow, areas };

  const fast = ordered[0];
  const slow = ordered[ordered.length - 1];
  const wristText =
    wristToShow !== null
      ? ` &middot; ${viewMode === "corrected" ? "on wrist (corrected)" : "on wrist"}: ${formatRate(wristToShow)} s/d`
      : "";
  caption.innerHTML = `${captionPrefix}Axes sorted by drift &middot; most fast: ${positionLabel(
    fast.position,
  )} ${formatRate(fast.drift)} &middot; most slow: ${positionLabel(
    slow.position,
  )} ${formatRate(slow.drift)}${wristText} &middot; domain ±${formatRate(domain)} s/d`;
}

function persistDraft(): void {
  const values = {} as Record<Position, string>;
  for (const position of POSITIONS) {
    values[position] = fields.get(position)!.value;
  }
  saveDraft({ watch: watchName.value, values, wrist: wristInput.value });
}

function restoreDraft(): void {
  const draft = loadDraft();
  if (!draft) return;
  watchName.value = draft.watch;
  if (typeof draft.wrist === "string") {
    wristInput.value = draft.wrist;
  }
  for (const position of POSITIONS) {
    const value = draft.values?.[position];
    if (value !== undefined) fields.get(position)!.value = value;
  }
  for (const position of POSITIONS) {
    const input = fields.get(position)!;
    const parsed = parseRate(input.value);
    const status = input.parentElement!.parentElement!.querySelector<HTMLSpanElement>(".rate-status")!;
    if (input.value.trim() === "") {
      status.textContent = "";
      status.classList.remove("error");
      continue;
    }
    if (parsed === null) {
      status.textContent = "Use a number like +2.5 or -3";
      status.classList.add("error");
    } else {
      status.textContent = "";
      status.classList.remove("error");
    }
  }
  updateWristStatus();
}

function renderHistory(): void {
  historyList.innerHTML = "";
  if (sessions.length === 0) {
    const item = document.createElement("li");
    item.className = "history-empty";
    item.textContent = "No saved sessions yet.";
    historyList.appendChild(item);
    return;
  }

  for (const session of sessions) {
    const ordered = orderReadings(session.readings, "sorted");
    const domain = axisDomain(ordered.map((reading) => reading.drift));
    const item = document.createElement("li");
    item.className = "history-item";

    const head = document.createElement("div");
    head.className = "history-head";
    const when = document.createElement("time");
    when.dateTime = session.measuredAt;
    when.textContent = new Date(session.measuredAt).toLocaleString();
    const name = document.createElement("strong");
    name.textContent = session.watch.trim() || "Unnamed watch";
    head.append(when, name);

    const mini = document.createElement("div");
    mini.className = "history-mini";
    renderHexagon(mini, ordered, domain, session.wristDrift ?? null);
    mini.style.width = "180px";
    mini.style.height = "180px";

    const list = document.createElement("ul");
    list.className = "history-readings";
    for (const reading of ordered) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${positionLabel(reading.position)}</span><span class="${reading.drift >= 0 ? "pos" : "neg"}">${formatRate(
        reading.drift,
      )}</span>`;
      list.appendChild(li);
    }

    const actions = document.createElement("div");
    actions.className = "history-actions";
    const load = document.createElement("button");
    load.className = "ghost";
    load.type = "button";
    load.textContent = "Load";
    load.addEventListener("click", () => {
      for (const reading of session.readings) {
        const input = fields.get(reading.position)!;
        input.value = String(reading.drift);
        const status = input.parentElement!.parentElement!.querySelector<HTMLSpanElement>(".rate-status")!;
        status.textContent = "";
        status.classList.remove("error");
      }
      watchName.value = session.watch;
      if (session.wristDrift !== undefined && session.wristDrift !== null) {
        wristInput.value = String(session.wristDrift);
      } else {
        wristInput.value = "";
      }
      updateWristStatus();
      viewMode = "measured";
      for (const b of viewButtons) {
        if (!b.dataset.mode) continue;
        const active = b.dataset.mode === "measured";
        b.classList.toggle("active", active);
        b.setAttribute("aria-pressed", active ? "true" : "false");
      }
      persistDraft();
      updateChart();
      window.scrollTo({ top: 0, behavior: "smooth" });
      toast("Loaded session");
    });
    const remove = document.createElement("button");
    remove.className = "ghost";
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      sessions = sessions.filter((existing) => existing.id !== session.id);
      saveSessions(sessions);
      renderHistory();
      toast("Deleted");
    });

    actions.append(load, remove);
    item.append(head, mini, list, actions);
    historyList.appendChild(item);
  }
}

saveButton.addEventListener("click", () => {
  const readings = currentReadings();
  if (!readings) {
    toast("Complete all six positions first");
    return;
  }
  const wristDrift = currentWristDrift();
  const session: Session = {
    id: crypto.randomUUID(),
    watch: watchName.value,
    measuredAt: new Date().toISOString(),
    readings,
    ...(wristDrift !== null ? { wristDrift } : {}),
  };
  sessions = [session, ...sessions];
  saveSessions(sessions);
  renderHistory();
  toast("Session saved");
});

exampleButton.addEventListener("click", () => {
  const example: Record<Position, number> = {
    dialDown: -1.2,
    dialUp: +0.8,
    "12up": +3.4,
    "3up": +1.6,
    "6up": -2.7,
    "9up": +2.1,
  };
  for (const position of POSITIONS) {
    const input = fields.get(position)!;
    input.value = String(example[position]);
    const status = input.parentElement!.parentElement!.querySelector<HTMLSpanElement>(".rate-status")!;
    status.textContent = "";
    status.classList.remove("error");
  }
  watchName.value = "Example watch";
  wristInput.value = "+1.8";
  updateWristStatus();
  persistDraft();
  updateChart();
  toast("Example loaded");
});

resetButton.addEventListener("click", () => {
  for (const position of POSITIONS) {
    fields.get(position)!.value = "";
    const input = fields.get(position)!;
    const status = input.parentElement!.parentElement!.querySelector<HTMLSpanElement>(".rate-status")!;
    status.textContent = "";
    status.classList.remove("error");
  }
  watchName.value = "";
  wristInput.value = "";
  wristStatus.textContent = "";
  wristStatus.classList.remove("error");
  persistDraft();
  updateChart();
  toast("Cleared");
});

for (const button of orderButtons) {
  if (!button.dataset.order) continue;
  button.addEventListener("click", () => {
    for (const b of orderButtons) {
      if (!b.dataset.order) continue;
      b.classList.remove("active");
      b.setAttribute("aria-pressed", "false");
    }
    button.classList.add("active");
    button.setAttribute("aria-pressed", "true");
    axisOrder = button.dataset.order as AxisOrder;
    updateChart();
  });
}

for (const button of viewButtons) {
  if (!button.dataset.mode) continue;
  button.addEventListener("click", () => {
    for (const b of viewButtons) {
      if (!b.dataset.mode) continue;
      b.classList.remove("active");
      b.setAttribute("aria-pressed", "false");
    }
    button.classList.add("active");
    button.setAttribute("aria-pressed", "true");
    viewMode = button.dataset.mode as ViewMode;
    updateChart();
  });
}

exportButton.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ sessions }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `watch-meter-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
});

importButton.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed: unknown = JSON.parse(text);
    const incoming = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { sessions?: unknown }).sessions)
        ? (parsed as { sessions: unknown[] }).sessions
        : [];

    let added = 0;
    for (const candidate of incoming) {
      if (isSession(candidate)) {
        // avoid exact id collisions by re-issuing ids only if present? keep id if unique
        const exists = sessions.some((session) => session.id === candidate.id);
        sessions.push(exists ? { ...candidate, id: crypto.randomUUID() } : candidate);
        added += 1;
      }
    }
    sessions.sort((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt));
    saveSessions(sessions);
    renderHistory();
    toast(`Imported ${added} session${added === 1 ? "" : "s"}`);
  } catch {
    toast("Import failed");
  } finally {
    importFile.value = "";
  }
});

buildForm();
restoreDraft();
updateChart();
renderHistory();
watchName.addEventListener("input", persistDraft);
wristInput.addEventListener("input", () => {
  updateWristStatus();
  persistDraft();
  updateChart();
});
