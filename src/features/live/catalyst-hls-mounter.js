import {
  createHaNativeHlsVideoElement,
  findActiveHaCameraStreamVideo,
} from "../../integrations/home-assistant/playback.js";
import { watchMediaFirstFrame } from "../../shared/media/first-frame.js";
import {
  resolveHaDirectFailedState,
  resolveHaDirectMountUnavailableState,
  resolveHaDirectReadyState,
} from "./startup-policy.js";

const CATALYST_HLS_VISIBLE_STYLE =
  "width:100%;height:100%;display:block;background:var(--c-bg-deep)";
const CATALYST_HLS_PRELOAD_HOST_STYLE =
  "position:absolute;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none";
const CATALYST_HLS_WAIT_MS = 8000;

export function createCatalystHlsMounter({
  getHass,
  getStreamMuted,
  getRotateOverlayActive,
  isCurrentEngine,
  waitForStreamStart,
  assignCommittedEngine,
  onCommittedMediaReady,
  onCommittedStream,
  onPendingStream,
  applyResolvedStreamUiState,
  startLoadingFallbackRefresh,
  stopLoadingFallbackRefresh,
  setLiveNativeControls,
  scheduleResumeLive,
  prepareHlsPlayback = () => true,
  createHlsVideo = createHaNativeHlsVideoElement,
  getPreloadEntities = () => [],
  getActiveEntity = () => "",
  getPreloadHost = () => null,
  shouldPreload = () => false,
  hasRetainedEngine = () => false,
  retainPreloadedEngine = () => false,
  requestFrame = (callback) => globalThis.requestAnimationFrame?.(callback),
  cancelFrame = (frame) => globalThis.cancelAnimationFrame?.(frame),
}) {
  const bindings = new WeakMap();
  const ownedEngines = new Set();
  let layoutTransfer = null;
  let layoutTransferGeneration = 0;
  let preloadGeneration = 0;
  let preloadRunning = false;
  let preloadRescheduleRequested = false;
  let preloadFrame = null;
  let preloadPaintFrame = null;
  let pendingPreload = null;

  const prepare = () => {
    try {
      return prepareHlsPlayback?.() ?? false;
    } catch (_) {
      return false;
    }
  };

  const stopFallbackRefresh = (binding) => {
    binding?.stopLoadingFallbackRefresh?.();
    if (binding) binding.stopLoadingFallbackRefresh = () => {};
  };

  const disposeBinding = (engine) => {
    const binding = bindings.get(engine);
    if (!binding) return false;
    binding.disposed = true;
    binding.abortController.abort();
    stopFallbackRefresh(binding);
    binding.cleanupRecovery?.();
    engine.removeEventListener?.("error", binding.onError);
    engine.removeEventListener?.("ended", binding.onEnded);
    engine.removeEventListener?.("playing", binding.onPlaying);
    bindings.delete(engine);
    return true;
  };

  const release = (engine) => {
    if (!engine?.catalystHls) return;
    ownedEngines.delete(engine);
    disposeBinding(engine);
    engine.destroy?.();
  };

  const createEngine = ({ entity, muted, defaultMuted, styleText } = {}) => {
    const hass = getHass();
    const targetEntity = String(entity || "").trim();
    if (!targetEntity || !hass?.states?.[targetEntity]) return null;
    let engine = null;
    try {
      engine = createHlsVideo({
        hass,
        entity: targetEntity,
        streamFormat: "hls",
        controls: false,
        muted: muted ?? getStreamMuted(),
        defaultMuted,
        fitMode: "contain",
        styleText: styleText || CATALYST_HLS_VISIBLE_STYLE,
      });
    } catch (_) {
      engine = null;
    }
    if (!engine) return null;

    // Mark the effective HA Direct owner without changing saved camera config.
    // This Catalyst-only engine never owns WebRTC state.
    engine.type = "ha_direct";
    engine.streamType = "hls";
    engine.catalystHls = true;
    engine.catalystEntity = targetEntity;
    ownedEngines.add(engine);
    return engine;
  };

  const applyReady = (engine, video = null) => {
    const binding = bindings.get(engine);
    if (!binding || binding.disposed || engine.hlsRecovering || engine.error || engine.ended || !isCurrentEngine(engine)) return;
    binding.failed = false;
    stopFallbackRefresh(binding);
    binding.cleanupRecovery?.();
    binding.cleanupRecovery = () => {};
    if (video) onCommittedMediaReady?.(engine, video);
    onCommittedStream?.("hls");
    applyResolvedStreamUiState?.(
      resolveHaDirectReadyState({
        rotateOverlayActive: getRotateOverlayActive(),
        isCurrentEngine: true,
        waitSucceeded: true,
      }),
    );
    schedulePreloadDeckAfterPaint();
  };

  const watchLateRecovery = (engine, binding) => {
    binding.cleanupRecovery?.();
    binding.cleanupRecovery = watchMediaFirstFrame({
      mediaRoot: engine,
      findVideo: findActiveHaCameraStreamVideo,
      isDestroyed: () => binding.disposed || !isCurrentEngine(engine),
      onReady: () =>
        applyReady(engine, findActiveHaCameraStreamVideo(engine)),
    });
  };

  const applyFailed = (engine) => {
    const binding = bindings.get(engine);
    if (binding?.disposed || !isCurrentEngine(engine)) return;
    if (
      layoutTransfer?.active === true &&
      layoutTransfer.engines.includes(engine)
    ) {
      binding.layoutFailurePending = true;
      return;
    }
    if (!binding.failed) {
      binding.failed = true;
      stopFallbackRefresh(binding);
      stopLoadingFallbackRefresh?.();
      onCommittedStream?.("snapshot");
      applyResolvedStreamUiState?.(resolveHaDirectFailedState());
    }
    if (typeof engine.recoverHls === "function") {
      engine.recoverHls();
      return;
    }
    if (binding.resumeOnFailure) {
      scheduleResumeLive?.("hls-error");
      return;
    }
    watchLateRecovery(engine, binding);
  };

  const bindEngine = (engine, { resumeOnFailure = false } = {}) => {
    const binding = {
      abortController: new AbortController(),
      cleanupRecovery: () => {},
      disposed: false,
      failed: false,
      onError: () => applyFailed(engine),
      onEnded: () => applyFailed(engine),
      onPlaying: () => {
        if (!engine.hlsRecovering && !engine.error) applyReady(engine, engine);
      },
      layoutFailurePending: false,
      resumeOnFailure,
      stopLoadingFallbackRefresh: () => {},
    };
    bindings.set(engine, binding);
    engine.addEventListener?.("error", binding.onError);
    engine.addEventListener?.("ended", binding.onEnded);
    engine.addEventListener?.("playing", binding.onPlaying);
    return binding;
  };

  const isRetainableEngine = (engine) =>
    engine?.type === "ha_direct" &&
    engine?.streamType === "hls" &&
    engine?.catalystHls === true &&
    (engine?.hlsRecovering === true || (
      engine?.ended !== true &&
      !engine?.error &&
      Number(engine?.readyState) >= 2
    ));

  const cancelScheduledPreload = () => {
    if (preloadFrame != null) cancelFrame?.(preloadFrame);
    if (preloadPaintFrame != null) cancelFrame?.(preloadPaintFrame);
    preloadFrame = null;
    preloadPaintFrame = null;
  };

  const cancelPendingPreload = ({ preserveEngine = false } = {}) => {
    const pending = pendingPreload;
    if (!pending) return null;
    pendingPreload = null;
    pending.promoted = preserveEngine;
    pending.abortController.abort();
    if (!preserveEngine) release(pending.engine);
    try {
      pending.slot?.remove?.();
    } catch (_) {}
    return preserveEngine ? pending.engine : null;
  };

  const cancelPreloads = () => {
    preloadGeneration += 1;
    preloadRescheduleRequested = false;
    cancelScheduledPreload();
    cancelPendingPreload();
  };

  const createPreloadSlot = () => {
    const host = getPreloadHost?.();
    if (!host?.appendChild || !globalThis.document?.createElement) return null;
    const slot = document.createElement("div");
    slot.setAttribute?.("aria-hidden", "true");
    slot.style.cssText = CATALYST_HLS_PRELOAD_HOST_STYLE;
    host.appendChild(slot);
    return slot;
  };

  const preloadEntity = async (entity, generation) => {
    const targetEntity = String(entity || "").trim();
    if (
      !targetEntity ||
      generation !== preloadGeneration ||
      shouldPreload?.() !== true ||
      hasRetainedEngine?.(targetEntity) === true
    ) {
      return false;
    }

    const slot = createPreloadSlot();
    if (!slot) return false;
    const engine = createEngine({
      entity: targetEntity,
      muted: true,
      styleText: CATALYST_HLS_VISIBLE_STYLE,
    });
    if (!engine) {
      slot.remove?.();
      return false;
    }
    slot.appendChild(engine);
    const abortController = new AbortController();
    const pending = {
      abortController,
      engine,
      entity: targetEntity,
      promoted: false,
      slot,
    };
    pendingPreload = pending;
    try {
      await engine.play?.();
    } catch (_) {}

    let ready = false;
    try {
      ready = await waitForStreamStart(engine, CATALYST_HLS_WAIT_MS, {
        requireReadyState: 2,
        abortSignal: abortController.signal,
        resolveVideo: () => findActiveHaCameraStreamVideo(engine),
      });
    } catch (_) {
      ready = false;
    }

    if (pendingPreload === pending) pendingPreload = null;
    if (pending.promoted) return true;
    const stillConfigured = (getPreloadEntities?.() || []).includes(
      targetEntity,
    );
    if (
      !ready ||
      generation !== preloadGeneration ||
      shouldPreload?.() !== true ||
      !stillConfigured ||
      !isRetainableEngine(engine) ||
      retainPreloadedEngine?.(targetEntity, engine) !== true
    ) {
      release(engine);
      slot.remove?.();
      return false;
    }
    slot.remove?.();
    return true;
  };

  const runPreloadDeck = async (generation) => {
    if (preloadRunning || generation !== preloadGeneration) return;
    preloadRunning = true;
    try {
      const entities = [...new Set(getPreloadEntities?.() || [])];
      for (const entity of entities) {
        if (
          generation !== preloadGeneration ||
          shouldPreload?.() !== true
        ) {
          break;
        }
        if (
          entity === String(getActiveEntity?.() || "").trim() ||
          hasRetainedEngine?.(entity) === true
        ) {
          continue;
        }
        await preloadEntity(entity, generation);
      }
    } finally {
      preloadRunning = false;
      if (preloadRescheduleRequested) {
        preloadRescheduleRequested = false;
        schedulePreloadDeckAfterPaint();
      }
    }
  };

  function schedulePreloadDeckAfterPaint() {
    if (shouldPreload?.() !== true) return;
    if (preloadRunning) {
      preloadRescheduleRequested = true;
      return;
    }
    if (preloadFrame != null || preloadPaintFrame != null) return;
    const generation = preloadGeneration;
    if (typeof requestFrame !== "function") {
      void runPreloadDeck(generation);
      return;
    }
    preloadFrame = requestFrame(() => {
      preloadFrame = null;
      preloadPaintFrame = requestFrame(() => {
        preloadPaintFrame = null;
        void runPreloadDeck(generation);
      });
    });
  }

  const detachForHandoff = (engine) => {
    if (!isRetainableEngine(engine)) return false;
    const detached = disposeBinding(engine);
    if (detached) ownedEngines.delete(engine);
    return detached;
  };

  const suspendRetainedEngine = (engine) => {
    if (!isRetainableEngine(engine)) return false;
    disposeBinding(engine);
    engine.catalystDormant = true;
    engine.autoplay = true;
    engine.preload = "auto";
    engine.muted = true;
    try {
      void engine.play?.().catch?.(() => {});
    } catch (_) {}
    return true;
  };

  const adoptRetainedEngine = (slot, engine) => {
    if (!slot || !isRetainableEngine(engine)) return false;
    ownedEngines.add(engine);
    engine.hlsRecoverySuspended = false;
    engine.catalystDormant = false;
    engine.autoplay = true;
    engine.preload = "auto";
    engine.controls = false;
    engine.muted = Boolean(getStreamMuted());
    engine.style.cssText = CATALYST_HLS_VISIBLE_STYLE;
    slot.innerHTML = "";
    slot.appendChild(engine);
    assignCommittedEngine?.(engine);
    const binding = bindEngine(engine, { resumeOnFailure: true });
    onPendingStream?.();
    applyResolvedStreamUiState?.({
      loading: true,
      fallbackVisible: true,
      refreshFallbackImage: true,
    });
    binding.stopLoadingFallbackRefresh =
      startLoadingFallbackRefresh?.({ preserveRenderedFrame: true }) ||
      (() => {});
    if (getRotateOverlayActive()) setLiveNativeControls?.(true);
    void (async () => {
      try {
        await engine.play?.();
      } catch (_) {
        applyFailed(engine);
        return;
      }
      if (binding.disposed || binding.failed || engine.hlsRecovering || !isCurrentEngine(engine)) {
        return;
      }
      applyReady(engine, findActiveHaCameraStreamVideo(engine) || engine);
    })();
    return true;
  };

  const beginLayoutTransfer = () => {
    if (layoutTransfer) layoutTransfer.active = false;
    const engines = [...ownedEngines].filter(
      (engine) => engine?.catalystHls === true,
    );
    if (!engines.length) {
      layoutTransfer = null;
      return null;
    }
    const transfer = {
      active: true,
      engines,
      generation: ++layoutTransferGeneration,
    };
    for (const engine of engines) engine.hlsRecoverySuspended = true;
    layoutTransfer = transfer;
    return transfer;
  };

  const resumeAfterLayoutTransfer = (transfer) => {
    if (!transfer || transfer !== layoutTransfer || transfer.active !== true) {
      return false;
    }

    const resume = () => {
      if (
        transfer !== layoutTransfer ||
        transfer.active !== true ||
        transfer.generation !== layoutTransferGeneration
      ) {
        return;
      }

      const activeEngine = transfer.engines.find((engine) =>
        isCurrentEngine(engine),
      );
      let activeResumeScheduled = false;
      for (const engine of transfer.engines) {
        if (!ownedEngines.has(engine)) continue;
        engine.hlsRecoverySuspended = false;
        if (engine === activeEngine) activeResumeScheduled = true;
        engine.autoplay = true;
        engine.preload = "auto";
        engine.controls = false;
        engine.muted =
          engine === activeEngine ? Boolean(getStreamMuted()) : true;
        void Promise.resolve()
          .then(() => engine.play?.())
          .then(() => {
            if (engine.error || engine.ended) engine.recoverHls?.();
            if (engine !== activeEngine || transfer !== layoutTransfer) return;
            transfer.active = false;
            layoutTransfer = null;
            const binding = bindings.get(engine);
            if (binding?.disposed) return;
            binding.layoutFailurePending = false;
            if (!engine.hlsRecovering && isRetainableEngine(engine)) {
              applyReady(engine);
              return;
            }
            applyFailed(engine);
          })
          .catch(() => {
            engine.recoverHls?.();
            if (engine !== activeEngine || transfer !== layoutTransfer) return;
            transfer.active = false;
            layoutTransfer = null;
            applyFailed(engine);
          });
      }

      if (!activeResumeScheduled) {
        transfer.active = false;
        layoutTransfer = null;
      }
    };

    if (typeof requestFrame !== "function") {
      resume();
      return true;
    }
    requestFrame(() => requestFrame(resume));
    return true;
  };

  const tryMount = async (slot, _startup = null, options = {}) => {
    const entity = String(options.entity || "").trim();
    const commit = options.commit !== false;
    const hass = getHass();
    if (!entity) return false;
    if (!hass?.states?.[entity]) {
      if (commit) {
        applyResolvedStreamUiState?.(
          resolveHaDirectMountUnavailableState(),
        );
      }
      return false;
    }
    const playbackPreparation = prepare();
    if (playbackPreparation?.then) await playbackPreparation;

    const pendingForEntity = pendingPreload?.entity === entity;
    preloadGeneration += 1;
    cancelScheduledPreload();
    let engine = null;
    if (pendingForEntity) {
      engine = cancelPendingPreload({ preserveEngine: true });
    } else {
      cancelPendingPreload();
      engine = createEngine({
        entity,
        muted: options.muted ?? getStreamMuted(),
        defaultMuted: options.defaultMuted,
        styleText: options.styleText || CATALYST_HLS_VISIBLE_STYLE,
      });
    }
    if (!engine) {
      if (commit) applyResolvedStreamUiState?.(resolveHaDirectFailedState());
      return false;
    }
    engine.muted = options.muted ?? getStreamMuted();
    engine.style.cssText = options.styleText || CATALYST_HLS_VISIBLE_STYLE;
    slot.innerHTML = "";
    slot.appendChild(engine);
    if (!commit) return { ok: true, type: "hls", engine, slot };

    // The initial player must recover like a promoted preload. Catalyst can
    // emit a media failure when the preserved live shell moves between views.
    const binding = bindEngine(engine, { resumeOnFailure: true });
    assignCommittedEngine?.(engine);
    binding.stopLoadingFallbackRefresh =
      startLoadingFallbackRefresh?.({ preserveRenderedFrame: true }) ||
      (() => {});
    if (getRotateOverlayActive()) setLiveNativeControls?.(true);

    const startupReady = (async () => {
      let readyVideo = null;
      const ready = await waitForStreamStart(engine, CATALYST_HLS_WAIT_MS, {
        requireReadyState: 2,
        abortSignal: binding.abortController.signal,
        resolveVideo: () => findActiveHaCameraStreamVideo(engine),
        onVideoReady: (video) => {
          readyVideo = video;
        },
      });
      if (binding.disposed || !isCurrentEngine(engine)) return false;
      if (!ready) {
        applyFailed(engine);
        return false;
      }
      applyReady(engine, readyVideo);
      return true;
    })();

    return { ok: true, type: "hls", engine, slot, startupReady };
  };

  return {
    adoptRetainedEngine,
    beginLayoutTransfer,
    cancelPreloads,
    detachForHandoff,
    isRetainableEngine,
    prepare,
    release,
    resumeAfterLayoutTransfer,
    suspendRetainedEngine,
    tryMount,
  };
}
