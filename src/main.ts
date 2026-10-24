import "./style.css";

import {
  POSITIONS,
  positionLabel,
  parseRate,
  formatRate,
  orderReadings,
  chartDomain,
  averageDrift,
  driftExtremes,
  driftSign,
  type AxisOrder,
  type Position,
  type Domain,
  type Reading,
  type Session,
} from "./model";
import { loadDraft, saveDraft, loadSessions, saveSessions, importSessions, type Draft } from "./storage";
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

/** Snapshot the zoom modal re-renders from: refreshed by `updateChart`, cleared when the chart is empty. */
let lastZoomData: {
  readings: Reading[];
  domain: Domain;
  wrist: number | null;
  areas: ZoneAreas | null;
} | null = null;

/** Element to refocus when the zoom modal closes. */
let zoomOpener: HTMLElement | null = null;

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
  // The areas were computed for the main chart; reuse them instead of re-sampling.
  renderHexagon(chartModalChart, lastZoomData.readings, lastZoomData.domain, lastZoomData.wrist, {
    areas: false,
  });
  renderZoneAreas(chartModalAreas, lastZoomData.areas);
  chartModalCaption.innerHTML = caption.innerHTML;
  zoomOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  chartModal.hidden = false;
  document.body.style.overflow = "hidden";
  chartModalClose.focus();
}

function closeZoom(): void {
  if (chartModal.hidden) return;
  chartModal.hidden = true;
  document.body.style.overflow = "";
  zoomOpener?.focus();
  zoomOpener = null;
}

chartHost.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest("button, a, input")) return;
  openZoom();
});
chartHost.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  openZoom();
});

chartModalChart.addEventListener("click", closeZoom);
chartModalClose.addEventListener("click", closeZoom);
chartModal.addEventListener("click", (event) => {
  if (event.target === chartModal) closeZoom();
});
window.addEventListener("keydown", (event) => {
  if (chartModal.hidden) return;
  if (event.key === "Escape") closeZoom();
  // The close button is the only control in the modal; keep focus on it.
  if (event.key === "Tab") {
    event.preventDefault();
    chartModalClose.focus();
  }
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

/** Saved sessions, newest first. */
let sessions: Session[] = loadSessions();
/** Axis order of the chart view; saved sessions always keep canonical POSITIONS order. */
let axisOrder: AxisOrder = "sorted";
type ViewMode = "measured" | "corrected";
/** View-only transform: "corrected" shifts every reading so the on-wrist value reads 0. */
let viewMode: ViewMode = "measured";

const fields = new Map<Position, HTMLInputElement>();
const fieldStatuses = new Map<Position, HTMLSpanElement>();

const RATE_HINT = "Use a number like +2.5 or -3";

let toastTimer: number | undefined;

function toast(message: string): void {
  toastEl.textContent = message;
  toastEl.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove("visible"), 1400);
}

/** Shows the format hint under a rate input when its text does not parse, and tints the field. */
function showRateStatus(status: HTMLElement, input: HTMLInputElement): void {
  const parsed = parseRate(input.value);
  const invalid = input.value.trim() !== "" && parsed === null;
  status.textContent = invalid ? RATE_HINT : "";
  status.classList.toggle("error", invalid);

  const wrap = input.closest(".rate-input-wrap");
  wrap?.classList.toggle("valid", parsed !== null);
  wrap?.classList.toggle("invalid", parsed === null);
}

function setViewMode(mode: ViewMode): void {
  viewMode = mode;
  for (const button of viewButtons) {
    if (!button.dataset.mode) continue;
    const active = button.dataset.mode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

/** Writes a complete form state into the inputs and refreshes their status lines. */
function fillForm(draft: Draft): void {
  watchName.value = draft.watch;
  wristInput.value = draft.wrist ?? "";
  for (const position of POSITIONS) {
    fields.get(position)!.value = draft.values[position] ?? "";
  }
  refreshStatuses();
}

function refreshStatuses(): void {
  for (const position of POSITIONS) {
    showRateStatus(fieldStatuses.get(position)!, fields.get(position)!);
  }
  showRateStatus(wristStatus, wristInput);
}

function buildForm(): void {
  form.innerHTML = "";
  for (const position of POSITIONS) {
    const field = document.createElement("label");
    field.className = "rate-field";
    field.innerHTML = `
      <span class="rate-label">${positionLabel(position)}</span>
      <span class="rate-input-wrap">
        <input class="rate-input" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="+0.0" />
        <span class="rate-unit">s/d</span>
      </span>
      <span class="rate-status" aria-live="polite"></span>
    `;
    const input = field.querySelector<HTMLInputElement>(".rate-input")!;
    const status = field.querySelector<HTMLSpanElement>(".rate-status")!;
    fields.set(position, input);
    fieldStatuses.set(position, status);

    input.addEventListener("input", () => {
      showRateStatus(status, input);
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

/** Null when the field is empty or does not parse. */
function currentWristDrift(): number | null {
  return parseRate(wristInput.value);
}

function setChartInteractive(label: string | null): void {
  if (label === null) {
    chartHost.removeAttribute("role");
    chartHost.removeAttribute("tabindex");
    chartHost.removeAttribute("aria-label");
    return;
  }
  chartHost.setAttribute("role", "button");
  chartHost.tabIndex = 0;
  chartHost.setAttribute("aria-label", `${label} Activate to enlarge.`);
}

/**
 * Renders the hexagon, bars and caption from the form, then snapshots the
 * result into `lastZoomData` for the zoom modal. "Corrected" mode is a view
 * transform: the rendered readings are shifted by the on-wrist drift, but
 * the form inputs are never overwritten.
 */
function updateChart(): void {
  const readings = currentReadings();
  if (!readings) {
    chartHost.innerHTML = '<div class="empty">Enter all six rates to see the signature.</div>';
    barsHost.innerHTML = "";
    caption.textContent = "";
    renderZoneAreas(zoneAreasEl, null);
    setChartInteractive(null);
    lastZoomData = null;
    return;
  }

  const wristDrift = currentWristDrift();

  let chartReadings = readings;
  let wristToShow = wristDrift;
  let captionPrefix = "";
  const corrected = viewMode === "corrected" && wristDrift !== null;

  if (viewMode === "corrected") {
    if (wristDrift === null) {
      // Stay in corrected mode while the wrist value is being edited; show the measured shape meanwhile.
      captionPrefix = "Enter an on-wrist drift to correct to 0 &middot; ";
    } else {
      const offset = -wristDrift;
      chartReadings = readings.map((reading) => ({ position: reading.position, drift: reading.drift + offset }));
      wristToShow = 0;
      captionPrefix = `Corrected to 0 on wrist (offset ${formatRate(offset)} s/d) &middot; `;
    }
  }

  const ordered = orderReadings(chartReadings, axisOrder);
  const domain = chartDomain(chartReadings, wristToShow);
  const areas = renderHexagon(chartHost, ordered, domain, wristToShow);
  renderZoneAreas(zoneAreasEl, areas);
  renderBars(barsHost, chartReadings, domain);
  setChartInteractive(chartHost.querySelector("svg")?.getAttribute("aria-label") ?? "Position signature.");

  lastZoomData = { readings: ordered, domain, wrist: wristToShow, areas };

  const { fast, slow } = driftExtremes(chartReadings)!;
  const average = averageDrift(chartReadings)!;
  const orderText = axisOrder === "sorted" ? "Axes sorted by drift" : "Axes in position order";
  const wristText =
    wristToShow !== null
      ? ` &middot; ${corrected ? "on wrist (corrected)" : "on wrist"}: ${formatRate(wristToShow)} s/d`
      : "";
  caption.innerHTML = `${captionPrefix}${orderText}<br />average ${formatRate(
    average,
  )} s/d &middot; most fast: ${positionLabel(fast.position)} ${formatRate(
    fast.drift,
  )} &middot; most slow: ${positionLabel(
    slow.position,
  )} ${formatRate(slow.drift)}${wristText}<br />range ${formatRate(domain.min)} to ${formatRate(domain.max)} s/d`;
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
  if (draft) fillForm(draft);
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
    const wristDrift = session.wristDrift ?? null;
    // Same domain rule as the main chart, so a loaded session looks identical there.
    const domain = chartDomain(session.readings, wristDrift);
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
    renderHexagon(mini, ordered, domain, wristDrift, { areas: false });
    mini.style.width = "180px";
    mini.style.height = "180px";

    const list = document.createElement("ul");
    list.className = "history-readings";
    for (const reading of ordered) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${positionLabel(reading.position)}</span><span class="${driftSign(
        reading.drift,
      )}">${formatRate(reading.drift)}</span>`;
      list.appendChild(li);
    }

    const actions = document.createElement("div");
    actions.className = "history-actions";
    const load = document.createElement("button");
    load.className = "ghost";
    load.type = "button";
    load.textContent = "Load";
    load.addEventListener("click", () => {
      const values = {} as Record<Position, string>;
      for (const reading of session.readings) values[reading.position] = String(reading.drift);
      fillForm({ watch: session.watch, values, wrist: wristDrift === null ? "" : String(wristDrift) });
      setViewMode("measured");
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
  if (wristDrift === null && wristInput.value.trim() !== "") {
    toast("Fix the on-wrist value or clear it first");
    return;
  }
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
  fillForm({
    watch: "Example watch",
    values: {
      dialDown: "-1.2",
      dialUp: "+0.8",
      "12up": "+3.4",
      "3up": "+1.6",
      "6up": "-2.7",
      "9up": "+2.1",
    },
    wrist: "+1.8",
  });
  persistDraft();
  updateChart();
  toast("Example loaded");
});

resetButton.addEventListener("click", () => {
  fillForm({ watch: "", values: {} as Record<Position, string>, wrist: "" });
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
    const mode = button.dataset.mode as ViewMode;
    setViewMode(mode);
    if (mode === "corrected" && currentWristDrift() === null) {
      toast("Enter on-wrist drift to correct to 0");
    }
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
  // Revoking synchronously can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
});

importButton.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  if (!file) return;
  try {
    const parsed: unknown = JSON.parse(await file.text());
    const result = importSessions(sessions, parsed);
    sessions = result.sessions;
    saveSessions(sessions);
    renderHistory();

    const notes: string[] = [];
    if (result.duplicates > 0) notes.push(`${result.duplicates} already saved`);
    if (result.invalid > 0) notes.push(`${result.invalid} invalid`);
    const suffix = notes.length > 0 ? ` · skipped ${notes.join(", ")}` : "";
    toast(`Imported ${result.added} session${result.added === 1 ? "" : "s"}${suffix}`);
  } catch {
    toast("Import failed");
  } finally {
    importFile.value = "";
  }
});

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

buildForm();
restoreDraft();
refreshStatuses();
updateChart();
renderHistory();
watchName.addEventListener("input", persistDraft);
wristInput.addEventListener("input", () => {
  showRateStatus(wristStatus, wristInput);
  persistDraft();
  updateChart();
});
