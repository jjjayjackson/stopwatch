const STORAGE_KEY = "stopwatch-pwa";
const LIVE_ROW_ID = "default";
const TAP_SLOP_PX = 14;
const SWIPE_MIN_PX = 96;
const SWIPE_DOMINANCE = 1.35;

function blank() {
  return {
    running: false,
    startedAt: null,
    accumulatedElapsed: 0,
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

function hydrate(raw) {
  if (!raw || typeof raw !== "object") return createStopwatch();
  const running = Boolean(raw.running);
  const startedAt = running ? Number(raw.startedAt) || Date.now() : null;
  return {
    running,
    startedAt,
    accumulatedElapsed: Math.max(0, Number(raw.accumulatedElapsed) || 0),
  };
}

function emptyState() {
  return {
    stopwatch: createStopwatch(),
  };
}

function normalize(parsed) {
  return {
    stopwatch: hydrate(parsed.stopwatch),
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
    }),
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
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      stopwatch: state.stopwatch,
    })
  );
}

const supabase =
  window.supabase && window.STOPWATCH_SUPABASE
    ? window.supabase.createClient(
        window.STOPWATCH_SUPABASE.url,
        window.STOPWATCH_SUPABASE.anonKey,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storage: {
              getItem: () => null,
              setItem: () => {},
              removeItem: () => {},
            },
          },
        }
      )
    : null;

function liveSnapshot(value) {
  return JSON.stringify({
    running: Boolean(value.running),
    startedAt: value.startedAt == null ? null : Number(value.startedAt),
    accumulatedElapsed: Math.max(0, Number(value.accumulatedElapsed) || 0),
  });
}

function fromLiveRow(row) {
  return hydrate({
    running: Boolean(row.running),
    startedAt: row.started_at,
    accumulatedElapsed: row.elapsed_ms,
  });
}

function toLiveRow(value) {
  const running = Boolean(value.running);
  return {
    id: LIVE_ROW_ID,
    elapsed_ms: Math.max(0, Math.floor(Number(value.accumulatedElapsed) || 0)),
    running,
    started_at: running && value.startedAt != null ? Number(value.startedAt) : null,
    updated_at: new Date().toISOString(),
  };
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
const desktopToggleEl = document.getElementById("desktop-toggle");
const desktopResetEl = document.getElementById("desktop-reset");
const desktopMq = window.matchMedia(DESKTOP_QUERY);

let stopwatch = createStopwatch();
let frame = 0;
let livePersistChain = Promise.resolve();
let lastLiveSnapshot = liveSnapshot(stopwatch);
let liveWriteId = 0;

function persist({ cloud = false } = {}) {
  saveState({ stopwatch });
  if (cloud) queueLiveSave();
}

function applyLiveStopwatch(next) {
  const snapshot = liveSnapshot(next);
  if (snapshot === lastLiveSnapshot || snapshot === liveSnapshot(stopwatch)) return;
  stopwatch = next;
  lastLiveSnapshot = snapshot;
  persist();
  renderTime();
  startTicking();
}

async function fetchLiveStopwatch() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("stopwatch")
    .select("elapsed_ms, running, started_at")
    .eq("id", LIVE_ROW_ID)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function saveLiveStopwatch(value) {
  if (!supabase) return;
  const { error } = await supabase.from("stopwatch").upsert(toLiveRow(value));
  if (error) throw error;
}

function queueLiveSave() {
  liveWriteId += 1;
  const snapshot = hydrate(stopwatch);
  lastLiveSnapshot = liveSnapshot(snapshot);
  livePersistChain = livePersistChain
    .then(() => saveLiveStopwatch(snapshot))
    .catch((err) => {
      console.warn("Stopwatch cloud save failed — using local cache.", err);
    });
}

async function pullLiveStopwatch() {
  const writeId = liveWriteId;
  try {
    const row = await fetchLiveStopwatch();
    if (!row || writeId !== liveWriteId) return;
    applyLiveStopwatch(fromLiveRow(row));
  } catch (err) {
    console.warn("Stopwatch cloud load failed — using local cache.", err);
  }
}

function subscribeLiveStopwatch() {
  if (!supabase) return;
  supabase
    .channel("stopwatch-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "stopwatch", filter: `id=eq.${LIVE_ROW_ID}` },
      (payload) => {
        const row = payload.new;
        if (!row) return;
        applyLiveStopwatch(fromLiveRow(row));
      }
    )
    .subscribe();
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

function resetStopwatch() {
  stopTicking();
  stopwatch = reset();
  persist({ cloud: true });
  renderTime();
}

function applyLoaded() {
  const loaded = loadState();
  stopwatch = loaded.stopwatch;
  lastLiveSnapshot = liveSnapshot(stopwatch);
  persist();
  renderTime();
  startTicking();
}

bindGestures(displayEl, {
  onTap() {
    if (isDesktop()) return;
    stopwatch = toggle(stopwatch);
    persist({ cloud: true });
    renderTime();
    startTicking();
  },
  onSwipeDown() {
    if (isDesktop()) return;
    resetStopwatch();
  },
});

document.addEventListener(
  "touchmove",
  (event) => {
    if (isDesktop()) return;
    event.preventDefault();
  },
  { passive: false }
);
document.addEventListener("gesturestart", (event) => event.preventDefault());

document.addEventListener("visibilitychange", () => {
  persist();
  renderTime();
  if (document.visibilityState === "visible") {
    pullLiveStopwatch();
    startTicking();
  } else {
    stopTicking();
  }
});

window.addEventListener("pagehide", persist);

displayEl.addEventListener("keydown", (event) => {
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    if (isDesktop()) return;
    stopwatch = toggle(stopwatch);
    persist({ cloud: true });
    renderTime();
    startTicking();
  }
});

desktopToggleEl.addEventListener("click", () => {
  stopwatch = toggle(stopwatch);
  persist({ cloud: true });
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
pullLiveStopwatch().then(subscribeLiveStopwatch);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
