const TEMPORARY_HISTORY_TTL_MS = 10 * 60 * 1000;
const STORAGE_KEY = "stopwatch-pwa";
const MIN_SAVE_DURATION_MS = 10;
const TAP_SLOP_PX = 14;
const SWIPE_MIN_PX = 96;
const SWIPE_DOMINANCE = 1.35;

function blank() {
  return {
    running: false,
    startedAt: null,
    accumulatedElapsed: 0,
    createdAt: null,
  };
}

function createStopwatch() {
  return blank();
}

function elapsedMs(stopwatch, now = Date.now()) {
  let ms = Math.max(0, Number(stopwatch.accumulatedElapsed) || 0);
  if (stopwatch.running && stopwatch.startedAt != null) {
    ms += Math.max(0, now - stopwatch.startedAt);
  }
  return ms;
}

function start(stopwatch, now = Date.now()) {
  if (stopwatch.running) return stopwatch;
  return {
    ...stopwatch,
    running: true,
    startedAt: now,
    createdAt: stopwatch.createdAt ?? now,
  };
}

function stop(stopwatch, now = Date.now()) {
  if (!stopwatch.running) return stopwatch;
  return {
    ...stopwatch,
    running: false,
    startedAt: null,
    accumulatedElapsed: elapsedMs(stopwatch, now),
  };
}

function toggle(stopwatch, now = Date.now()) {
  return stopwatch.running ? stop(stopwatch, now) : start(stopwatch, now);
}

function reset() {
  return blank();
}

function timeParts(ms) {
  const total = Math.max(0, Math.floor(ms));
  return {
    hours: Math.floor(total / 3600000),
    minutes: Math.floor((total % 3600000) / 60000),
    seconds: Math.floor((total % 60000) / 1000),
    hundredths: Math.floor((total % 1000) / 10),
  };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatHorizontal(ms) {
  const p = timeParts(ms);
  return `${pad2(p.hours)}:${pad2(p.minutes)}:${pad2(p.seconds)}.${pad2(p.hundredths)}`;
}

function hydrate(raw) {
  if (!raw || typeof raw !== "object") return createStopwatch();
  const running = Boolean(raw.running);
  const startedAt = running ? Number(raw.startedAt) || Date.now() : null;
  return {
    running,
    startedAt,
    accumulatedElapsed: Math.max(0, Number(raw.accumulatedElapsed) || 0),
    createdAt: raw.createdAt == null ? null : Number(raw.createdAt) || null,
  };
}

function createRecord({
  duration,
  title = "",
  permanent,
  startedAt,
  now = Date.now(),
  ttlMs = TEMPORARY_HISTORY_TTL_MS,
}) {
  return {
    id: crypto.randomUUID(),
    duration: Math.max(0, Math.floor(duration)),
    title: typeof title === "string" ? title.trim() : "",
    createdAt: startedAt || now,
    permanent: Boolean(permanent),
    expiresAt: permanent ? null : now + ttlMs,
  };
}

function isExpired(record, now = Date.now()) {
  if (!record || record.permanent) return false;
  return record.expiresAt != null && now >= record.expiresAt;
}

function purgeExpired(records, now = Date.now()) {
  return Array.isArray(records) ? records.filter((record) => !isExpired(record, now)) : [];
}

function withTitle(record, title) {
  return {
    ...record,
    title: typeof title === "string" ? title.trim() : "",
  };
}

function emptyState() {
  return {
    stopwatch: createStopwatch(),
    history: [],
  };
}

function normalize(parsed) {
  const history = purgeExpired(Array.isArray(parsed.history) ? parsed.history : []);
  return {
    stopwatch: hydrate(parsed.stopwatch),
    history,
  };
}

function migrateLegacy(parsed) {
  if (parsed.stopwatch) return normalize(parsed);
  const running = Boolean(parsed.running);
  const wall = parsed.wallStartedAt == null ? null : Number(parsed.wallStartedAt);
  return {
    stopwatch: hydrate({
      running,
      startedAt: running ? wall || Date.now() : null,
      accumulatedElapsed: Math.max(0, Number(parsed.elapsedMs) || 0),
      createdAt: running ? wall : null,
    }),
    history: [],
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const legacy = localStorage.getItem("stopwatch");
      if (!legacy) return emptyState();
      return migrateLegacy(JSON.parse(legacy));
    }
    return migrateLegacy(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

function saveState(state) {
  const history = purgeExpired(state.history);
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      stopwatch: state.stopwatch,
      history,
    })
  );
  return history;
}

function bindGestures(element, handlers) {
  let origin = null;

  function clear() {
    origin = null;
  }

  function finish(event) {
    if (!origin || event.pointerId !== origin.id) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    clear();

    if (absY >= SWIPE_MIN_PX && absY >= absX * SWIPE_DOMINANCE) {
      if (dy > 0) handlers.onSwipeDown?.(event);
      else handlers.onSwipeUp?.(event);
      return;
    }

    if (absX <= TAP_SLOP_PX && absY <= TAP_SLOP_PX) {
      handlers.onTap?.(event);
    }
  }

  element.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    origin = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      /* capture is best-effort */
    }
  });

  element.addEventListener("pointerup", finish);
  element.addEventListener("pointercancel", clear);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", clear);

  element.addEventListener(
    "contextmenu",
    (event) => {
      event.preventDefault();
    },
    { capture: true }
  );
}

const DESKTOP_QUERY = "(min-width: 900px)";

const layoutMobileEl = document.getElementById("layout-mobile");
const layoutDesktopEl = document.getElementById("layout-desktop");
const displayEl = document.getElementById("display");
const historyEl = document.getElementById("history");
const historyListEl = document.getElementById("history-list");
const historyHitEl = document.getElementById("history-hit");
const historyExitEl = document.getElementById("history-exit");
const titleOverlayEl = document.getElementById("title-overlay");
const titleInputEl = document.getElementById("title-input");
const titleDoneEl = document.getElementById("title-done");
const desktopToggleEl = document.getElementById("desktop-toggle");
const desktopResetEl = document.getElementById("desktop-reset");
const desktopMq = window.matchMedia(DESKTOP_QUERY);

let stopwatch = createStopwatch();
let history = [];
let frame = 0;
let pendingTitleId = null;
let historyOpen = false;

function persist() {
  history = saveState({ stopwatch, history });
}

function isDesktop() {
  return desktopMq.matches;
}

function applyLayout() {
  const desktop = isDesktop();
  layoutMobileEl.inert = desktop;
  layoutDesktopEl.inert = !desktop;
  layoutMobileEl.setAttribute("aria-hidden", desktop ? "true" : "false");
  layoutDesktopEl.setAttribute("aria-hidden", desktop ? "false" : "true");
  if (desktop && historyOpen) setHistoryOpen(false);
}

function renderTime(now = Date.now()) {
  const parts = timeParts(elapsedMs(stopwatch, now));
  for (const el of document.querySelectorAll("[data-part]")) {
    const key = el.dataset.part;
    if (key in parts) el.textContent = pad2(parts[key]);
  }
  displayEl.setAttribute(
    "aria-label",
    stopwatch.running ? "Stopwatch running, tap to stop" : "Stopwatch stopped, tap to start"
  );
  desktopToggleEl.classList.toggle("is-running", stopwatch.running);
  desktopToggleEl.setAttribute("aria-label", stopwatch.running ? "Pause" : "Play");
}

function stopTicking() {
  cancelAnimationFrame(frame);
  frame = 0;
}

function tick() {
  renderTime();
  if (stopwatch.running) {
    frame = requestAnimationFrame(tick);
  } else {
    frame = 0;
  }
}

function startTicking() {
  stopTicking();
  if (stopwatch.running) {
    frame = requestAnimationFrame(tick);
  }
}

function formatStartedAt(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderHistory() {
  persist();
  historyListEl.replaceChildren();

  for (const record of history) {
    const item = document.createElement("li");
    item.className = "history-item";
    item.dataset.id = record.id;

    const started = document.createElement("p");
    started.className = "history-started";
    started.textContent = formatStartedAt(record.createdAt);

    const title = document.createElement("p");
    title.className = "history-title";
    title.textContent = record.title;

    const row = document.createElement("div");
    row.className = "history-row";

    const duration = document.createElement("p");
    duration.className = "history-duration";
    duration.textContent = formatHorizontal(record.duration);

    row.append(duration);

    if (!record.permanent) {
      const trash = document.createElement("button");
      trash.type = "button";
      trash.className = "trash";
      trash.setAttribute("aria-label", "Delete temporary record");
      trash.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12v12H6V9zm3 2v8h1.8V11H9zm4.2 0v8H15V11h-1.8z"/></svg>';
      trash.addEventListener("click", (event) => {
        event.stopPropagation();
        history = history.filter((entry) => entry.id !== record.id);
        renderHistory();
      });
      row.append(trash);
    }

    item.append(started);
    if (record.title) item.append(title);
    item.append(row);
    historyListEl.append(item);
  }
}

function setHistoryOpen(open) {
  historyOpen = open;
  historyEl.classList.toggle("is-open", open);
  historyHitEl.classList.toggle("is-open", open);
  historyEl.setAttribute("aria-hidden", open ? "false" : "true");
  if (open) renderHistory();
}

function captureDuration() {
  const now = Date.now();
  const duration = elapsedMs(stopwatch, now);
  const startedAt = stopwatch.createdAt || now - duration;
  return { now, duration, startedAt };
}

function resetStopwatch() {
  stopTicking();
  stopwatch = reset();
  persist();
  renderTime();
}

function saveAndReset({ permanent }) {
  if (titleOverlayEl.classList.contains("is-open")) return;
  const { now, duration, startedAt } = captureDuration();
  if (duration < MIN_SAVE_DURATION_MS) return;

  const record = createRecord({
    duration,
    permanent,
    startedAt,
    now,
  });
  history = [...history, record];
  resetStopwatch();

  if (permanent) {
    pendingTitleId = record.id;
    titleInputEl.value = "";
    titleOverlayEl.classList.add("is-open");
    titleOverlayEl.setAttribute("aria-hidden", "false");
    titleInputEl.focus();
  }
}

function finishTitle() {
  const title = titleInputEl.value;
  if (pendingTitleId) {
    history = history.map((record) =>
      record.id === pendingTitleId ? withTitle(record, title) : record
    );
    persist();
  }
  pendingTitleId = null;
  titleOverlayEl.classList.remove("is-open");
  titleOverlayEl.setAttribute("aria-hidden", "true");
  titleInputEl.blur();
}

function applyLoaded() {
  const loaded = loadState();
  stopwatch = loaded.stopwatch;
  history = loaded.history;
  persist();
  renderTime();
  startTicking();
}

bindGestures(displayEl, {
  onTap() {
    if (isDesktop() || historyOpen) return;
    stopwatch = toggle(stopwatch);
    persist();
    renderTime();
    startTicking();
  },
  onSwipeDown() {
    if (isDesktop() || historyOpen) return;
    saveAndReset({ permanent: false });
  },
  onSwipeUp() {
    if (isDesktop() || historyOpen) return;
    saveAndReset({ permanent: true });
  },
});

bindGestures(historyHitEl, {
  onTap() {
    if (isDesktop()) return;
    setHistoryOpen(!historyOpen);
  },
  onSwipeDown() {
    if (isDesktop()) return;
    setHistoryOpen(true);
  },
  onSwipeUp() {
    if (isDesktop()) return;
    setHistoryOpen(false);
  },
});

historyExitEl.addEventListener("click", () => {
  if (isDesktop()) return;
  setHistoryOpen(false);
});

titleDoneEl.addEventListener("click", finishTitle);
titleOverlayEl.addEventListener("click", (event) => {
  if (event.target === titleOverlayEl) finishTitle();
});
titleOverlayEl.querySelector("form").addEventListener("submit", (event) => {
  event.preventDefault();
  finishTitle();
});
document.addEventListener(
  "touchmove",
  (event) => {
    if (isDesktop()) return;
    if (!event.target.closest(".history-list, .title-card")) {
      event.preventDefault();
    }
  },
  { passive: false }
);
document.addEventListener("gesturestart", (event) => event.preventDefault());

function syncKeyboardInset() {
  const viewport = window.visualViewport;
  const inset = viewport
    ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
    : 0;
  document.documentElement.style.setProperty("--keyboard-inset", `${inset}px`);
}
window.visualViewport?.addEventListener("resize", syncKeyboardInset);
window.visualViewport?.addEventListener("scroll", syncKeyboardInset);
window.addEventListener("resize", syncKeyboardInset);
syncKeyboardInset();

document.addEventListener("visibilitychange", () => {
  persist();
  renderTime();
  if (document.visibilityState === "visible") {
    if (historyOpen) renderHistory();
    startTicking();
  } else {
    stopTicking();
  }
});

window.addEventListener("pagehide", persist);

displayEl.addEventListener("keydown", (event) => {
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    if (isDesktop() || historyOpen) return;
    stopwatch = toggle(stopwatch);
    persist();
    renderTime();
    startTicking();
  }
});

desktopToggleEl.addEventListener("click", () => {
  stopwatch = toggle(stopwatch);
  persist();
  renderTime();
  startTicking();
});

desktopResetEl.addEventListener("click", () => {
  resetStopwatch();
});

if (typeof desktopMq.addEventListener === "function") {
  desktopMq.addEventListener("change", applyLayout);
} else {
  desktopMq.addListener(applyLayout);
}

applyLoaded();
applyLayout();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
