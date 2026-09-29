export const HA_DIRECT_DIAGNOSTICS_STORAGE_KEY =
  "frigate-view-card:ha-direct-diagnostics";

const HA_DIRECT_DIAGNOSTICS_GLOBAL_KEY = "__fvcHaDirectDiagnostics";
const HA_DIRECT_DIAGNOSTICS_LIMIT = 20;
const HA_HLS_VIDEO_EVENTS = Object.freeze([
  "loadstart",
  "loadedmetadata",
  "loadeddata",
  "canplay",
  "playing",
  "waiting",
  "stalled",
  "error",
]);
const NOOP_DIAGNOSTIC = Object.freeze({
  enabled: false,
  mark: () => {},
  finish: () => {},
});

const safeStorageEnabled = (storage) => {
  try {
    return storage?.getItem?.(HA_DIRECT_DIAGNOSTICS_STORAGE_KEY) === "1";
  } catch (_) {
    return false;
  }
};

export const isHaDirectDiagnosticsEnabled = ({
  storage = globalThis.localStorage,
  target = globalThis,
} = {}) =>
  target?.__FVC_HA_DIRECT_DIAGNOSTICS__ === true ||
  safeStorageEnabled(storage);

const diagnosticDetail = (detail = {}) =>
  Object.fromEntries(
    Object.entries(detail).filter(([, value]) =>
      ["string", "number", "boolean"].includes(typeof value),
    ),
  );

const ensureDiagnosticStore = (target) => {
  const existing = target?.[HA_DIRECT_DIAGNOSTICS_GLOBAL_KEY];
  if (existing?.attempts && typeof existing.export === "function") {
    return existing;
  }
  const attempts = [];
  const store = {
    attempts,
    clear: () => {
      attempts.length = 0;
    },
    export: () => JSON.stringify(attempts, null, 2),
  };
  try {
    target[HA_DIRECT_DIAGNOSTICS_GLOBAL_KEY] = store;
  } catch (_) {}
  return store;
};

const roundedMetric = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 10) / 10 : 0;
};

const resolveHlsResourceType = (name) => {
  const value = String(name || "").toLowerCase();
  if (!value.includes("/api/hls/") && !value.includes(".m3u8")) return "";
  if (value.includes("master_playlist") || value.includes("master.m3u8")) {
    return "master-playlist";
  }
  if (value.includes(".m3u8")) return "media-playlist";
  if (value.includes("init") && value.includes(".mp4")) {
    return "init-segment";
  }
  if (/\.(?:m4s|mp4|ts)(?:\?|$)/.test(value)) return "media-segment";
  return "hls-resource";
};

const hlsVideoState = (video) => ({
  readyState: Number(video?.readyState) || 0,
  networkState: Number(video?.networkState) || 0,
  currentTime: roundedMetric(video?.currentTime),
  videoWidth: Number(video?.videoWidth) || 0,
  videoHeight: Number(video?.videoHeight) || 0,
  paused: video?.paused === true,
  errorCode: Number(video?.error?.code) || 0,
});

const readResourceEntries = (performanceApi) => {
  try {
    return performanceApi?.getEntriesByType?.("resource") || [];
  } catch (_) {
    return [];
  }
};

const resourceKey = (entry) =>
  `${entry?.name || ""}:${entry?.startTime || 0}`;

export const watchHaHlsStartupDiagnostic = ({
  player,
  diagnostic,
  resolveVideo,
  performanceApi = globalThis.performance,
  setIntervalFn = globalThis.setInterval,
  clearIntervalFn = globalThis.clearInterval,
  pollMs = 50,
} = {}) => {
  if (!player || diagnostic?.enabled !== true) return () => {};

  let disposed = false;
  let video = null;
  let intervalId = null;
  const markedVideoEvents = new Set();
  const markedResourceTypes = new Set();
  // Resource Timing is page-wide. Ignore completed requests from prior camera
  // attempts so each diagnostic only reports work initiated after its player.
  const seenResources = new Set(
    readResourceEntries(performanceApi).map(resourceKey),
  );
  const playerListeners = [];
  const videoListeners = [];

  const mark = (stage, detail = {}) => diagnostic.mark?.(stage, detail);
  const addListener = (target, type, handler, collection) => {
    target?.addEventListener?.(type, handler, true);
    collection.push([target, type, handler]);
  };
  const removeListeners = (collection) => {
    for (const [target, type, handler] of collection.splice(0)) {
      target?.removeEventListener?.(type, handler, true);
    }
  };
  const bindVideo = (nextVideo) => {
    if (!nextVideo || nextVideo === video) return;
    removeListeners(videoListeners);
    video = nextVideo;
    mark("hls-video-discovered", hlsVideoState(video));
    for (const type of HA_HLS_VIDEO_EVENTS) {
      addListener(
        video,
        type,
        () => {
          if (disposed || markedVideoEvents.has(type)) return;
          markedVideoEvents.add(type);
          mark(`hls-video-${type}`, hlsVideoState(video));
        },
        videoListeners,
      );
    }
  };
  const inspectResources = () => {
    for (const entry of readResourceEntries(performanceApi)) {
      const key = resourceKey(entry);
      if (seenResources.has(key)) continue;
      seenResources.add(key);
      const resourceType = resolveHlsResourceType(entry?.name);
      if (!resourceType || markedResourceTypes.has(resourceType)) continue;
      markedResourceTypes.add(resourceType);
      mark("hls-resource-finished", {
        resourceType,
        durationMs: roundedMetric(entry?.duration),
        transferSize: Number(entry?.transferSize) || 0,
      });
    }
  };
  const reconcile = () => {
    if (disposed) return;
    bindVideo(resolveVideo?.(player));
    inspectResources();
  };
  const onLoad = () => {
    mark("hls-player-load-event");
    reconcile();
  };
  const onStreams = (event) => {
    mark("hls-player-streams-event", {
      hasAudio: event?.detail?.hasAudio === true,
      hasVideo: event?.detail?.hasVideo === true,
    });
    reconcile();
  };
  const onError = () => {
    mark("hls-player-error-event");
    reconcile();
  };

  addListener(player, "load", onLoad, playerListeners);
  addListener(player, "streams", onStreams, playerListeners);
  addListener(player, "error", onError, playerListeners);
  const updateComplete = player.updateComplete;
  if (typeof updateComplete?.then === "function") {
    void updateComplete.then(() => {
      if (disposed) return;
      mark("hls-player-update-complete");
      reconcile();
    });
  }
  reconcile();
  if (typeof setIntervalFn === "function") {
    intervalId = setIntervalFn(reconcile, pollMs);
  }

  return () => {
    if (disposed) return;
    reconcile();
    disposed = true;
    if (intervalId != null) clearIntervalFn?.(intervalId);
    removeListeners(playerListeners);
    removeListeners(videoListeners);
  };
};

export const createHaDirectPlaybackDiagnostic = (
  {
    entity = "",
    requestedStreamType = "",
  } = {},
  {
    target = globalThis,
    storage = globalThis.localStorage,
    performanceApi = globalThis.performance,
    now = () => performanceApi?.now?.() ?? Date.now(),
    wallClock = () => new Date().toISOString(),
    logger = globalThis.console,
  } = {},
) => {
  if (!isHaDirectDiagnosticsEnabled({ storage, target })) {
    return NOOP_DIAGNOSTIC;
  }

  const store = ensureDiagnosticStore(target);
  const previousAttemptId = Number(store.attempts.at(-1)?.id);
  const attemptId = Number.isFinite(previousAttemptId)
    ? previousAttemptId + 1
    : 1;
  const startedAt = now();
  const attempt = {
    id: attemptId,
    entity: String(entity || ""),
    requestedStreamType: String(requestedStreamType || ""),
    startedAt: wallClock(),
    status: "running",
    marks: [],
  };
  store.attempts.push(attempt);
  if (store.attempts.length > HA_DIRECT_DIAGNOSTICS_LIMIT) {
    store.attempts.splice(
      0,
      store.attempts.length - HA_DIRECT_DIAGNOSTICS_LIMIT,
    );
  }

  let finished = false;
  const mark = (stage, detail = {}) => {
    const atMs = Math.round((now() - startedAt) * 10) / 10;
    const safeDetail = diagnosticDetail(detail);
    const entry = {
      atMs,
      stage: String(stage || "unknown"),
      ...safeDetail,
    };
    attempt.marks.push(entry);
    try {
      performanceApi?.mark?.(
        `frigate-view-card:ha-direct:${attemptId}:${entry.stage}`,
      );
    } catch (_) {}
    logger?.info?.(
      `[FrigateView HA Direct #${attemptId} +${atMs}ms] ${entry.stage}`,
      safeDetail,
    );
  };
  const finish = (status = "complete", detail = {}) => {
    if (finished) return;
    finished = true;
    attempt.status = String(status || "complete");
    mark("attempt-finished", { status: attempt.status, ...detail });
  };

  mark("attempt-start");
  return {
    enabled: true,
    attemptId,
    mark,
    finish,
  };
};
