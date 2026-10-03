import {
  createHaNativeHlsVideoElement,
  findActiveHaCameraStreamVideo,
} from "../../integrations/home-assistant/playback.js";
import {
  resolveHaDirectFailedState,
  resolveHaDirectMountUnavailableState,
  resolveHaDirectReadyState,
} from "./startup-policy.js";

const CATALYST_HLS_VISIBLE_STYLE =
  "width:100%;height:100%;display:block;background:var(--c-bg-deep)";
const CATALYST_HLS_WAIT_MS = 8000;
const CATALYST_HLS_RECOVERY_RETRY_MS = 250;
const CATALYST_HLS_READINESS = Object.freeze({
  minCurrentTime: 0.05,
  minDecodedFrames: 2,
  requirePresentedFrame: true,
  requireReadyState: 2,
  strict: true,
});

export function createCatalystHlsMounter({
  getHass,
  getStreamMuted,
  getRotateOverlayActive,
  isCurrentEngine,
  waitForStreamStart,
  assignCommittedEngine,
  onCommittedMediaReady,
  onCommittedStream,
  applyResolvedStreamUiState,
  startLoadingFallbackRefresh,
  stopLoadingFallbackRefresh,
  setLiveNativeControls,
  prepareHlsPlayback = () => true,
  createHlsVideo = createHaNativeHlsVideoElement,
}) {
  const bindings = new WeakMap();

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
    bindings.delete(engine);
    return true;
  };

  const release = (engine) => {
    if (!engine?.catalystHls) return;
    disposeBinding(engine);
    engine.destroy?.();
  };

  const applyReady = (engine, video = null) => {
    const binding = bindings.get(engine);
    if (binding?.disposed || !isCurrentEngine(engine)) return;
    binding.startupPending = false;
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
  };

  const watchLateRecovery = (engine, binding) => {
    binding.cleanupRecovery?.();
    const abortController = new AbortController();
    let disposed = false;
    let retryTimer = null;
    binding.cleanupRecovery = () => {
      if (disposed) return;
      disposed = true;
      abortController.abort();
      if (retryTimer != null) clearTimeout(retryTimer);
      retryTimer = null;
    };

    const probe = async () => {
      if (disposed || binding.disposed || !isCurrentEngine(engine)) return;
      let readyVideo = null;
      let ready = false;
      try {
        ready = await waitForStreamStart(engine, CATALYST_HLS_WAIT_MS, {
          ...CATALYST_HLS_READINESS,
          abortSignal: abortController.signal,
          resolveVideo: () => findActiveHaCameraStreamVideo(engine),
          onVideoReady: (video) => {
            readyVideo = video;
          },
        });
      } catch (_) {
        ready = false;
      }
      if (disposed || binding.disposed || !isCurrentEngine(engine)) return;
      if (ready) {
        applyReady(engine, readyVideo);
        return;
      }
      retryTimer = setTimeout(probe, CATALYST_HLS_RECOVERY_RETRY_MS);
      retryTimer?.unref?.();
    };

    void probe();
  };

  const applyFailed = (engine) => {
    const binding = bindings.get(engine);
    if (binding?.disposed || !isCurrentEngine(engine)) return;
    if (binding.startupPending) return;
    if (!binding.failed) {
      binding.failed = true;
      stopFallbackRefresh(binding);
      stopLoadingFallbackRefresh?.();
      onCommittedStream?.("snapshot");
      applyResolvedStreamUiState?.(resolveHaDirectFailedState());
    }
    watchLateRecovery(engine, binding);
  };

  const bindEngine = (engine) => {
    const binding = {
      abortController: new AbortController(),
      cleanupRecovery: () => {},
      disposed: false,
      failed: false,
      startupPending: true,
      onError: () => applyFailed(engine),
      stopLoadingFallbackRefresh: () => {},
    };
    bindings.set(engine, binding);
    engine.addEventListener?.("error", binding.onError);
    return binding;
  };

  const isRetainableEngine = (engine) =>
    engine?.type === "ha_direct" &&
    engine?.streamType === "hls" &&
    engine?.catalystHls === true &&
    engine?.ended !== true &&
    Number(engine?.readyState) >= 2;

  const detachForHandoff = (engine) => {
    if (!isRetainableEngine(engine)) return false;
    return disposeBinding(engine);
  };

  const adoptRetainedEngine = (slot, engine) => {
    if (!slot || !isRetainableEngine(engine)) return false;
    engine.controls = false;
    engine.muted = Boolean(getStreamMuted());
    engine.style.cssText = CATALYST_HLS_VISIBLE_STYLE;
    slot.innerHTML = "";
    slot.appendChild(engine);
    assignCommittedEngine?.(engine);
    bindEngine(engine);
    if (getRotateOverlayActive()) setLiveNativeControls?.(true);
    applyReady(engine, engine);
    void engine.play?.().catch?.(() => {});
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

    let engine = null;
    try {
      engine = createHlsVideo({
        hass,
        entity,
        streamFormat: "hls",
        controls: false,
        muted: options.muted ?? getStreamMuted(),
        defaultMuted: options.defaultMuted,
        fitMode: "contain",
        styleText: options.styleText || CATALYST_HLS_VISIBLE_STYLE,
      });
    } catch (_) {
      engine = null;
    }
    if (!engine) {
      if (commit) applyResolvedStreamUiState?.(resolveHaDirectFailedState());
      return false;
    }

    // Keep the configured connection mode visible while identifying the
    // Catalyst-only owner for teardown. This engine never owns WebRTC state.
    engine.type = "ha_direct";
    engine.streamType = "hls";
    engine.catalystHls = true;
    slot.innerHTML = "";
    slot.appendChild(engine);
    if (!commit) return { ok: true, type: "hls", engine, slot };

    const binding = bindEngine(engine);
    assignCommittedEngine?.(engine);
    binding.stopLoadingFallbackRefresh =
      startLoadingFallbackRefresh?.({ preserveRenderedFrame: true }) ||
      (() => {});
    if (getRotateOverlayActive()) setLiveNativeControls?.(true);

    const startupReady = (async () => {
      let readyVideo = null;
      let ready = false;
      try {
        ready = await waitForStreamStart(engine, CATALYST_HLS_WAIT_MS, {
          ...CATALYST_HLS_READINESS,
          abortSignal: binding.abortController.signal,
          resolveVideo: () => findActiveHaCameraStreamVideo(engine),
          onVideoReady: (video) => {
            readyVideo = video;
          },
        });
      } catch (_) {
        ready = false;
      }
      if (binding.disposed || !isCurrentEngine(engine)) return false;
      binding.startupPending = false;
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
    detachForHandoff,
    isRetainableEngine,
    prepare,
    release,
    tryMount,
  };
}
