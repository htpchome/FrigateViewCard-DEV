export const HA_DIRECT_DIAGNOSTICS_STORAGE_KEY =
  "frigate-view-card:ha-direct-diagnostics";

const HA_DIRECT_DIAGNOSTICS_GLOBAL_KEY = "__fvcHaDirectDiagnostics";
const HA_DIRECT_DIAGNOSTICS_LIMIT = 20;
const NOOP_DIAGNOSTIC = Object.freeze({
  enabled: false,
  mark: () => {},
  finish: () => {},
});

let nextAttemptId = 0;

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
  const attemptId = ++nextAttemptId;
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
