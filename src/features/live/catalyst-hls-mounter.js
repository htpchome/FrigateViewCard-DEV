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
const CATALYST_HLS_WAIT_MS = 8000;
const CATALYST_HLS_RESUME_WAIT_MS = 3500;

const readDecodedFrames = (video) => {
  try {
    return (
      Number(video?.webkitDecodedFrameCount) ||
      Number(video?.getVideoPlaybackQuality?.()?.totalVideoFrames) ||
      0
    );
  } catch (_) {
    return 0;
  }
};

const buildRetainedResumeReadiness = (video) => {
  const currentTime = Number(video?.currentTime);
  const decodedFrames = readDecodedFrames(video);
  return {
    minCurrentTime:
      (Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0) + 0.05,
    minDecodedFrames: Math.max(0, decodedFrames) + 1,
    requireReadyState: 2,
    strict: true,
  };
};

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
    engine.removeEventListener?.("ended", binding.onEnded);
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
    if (!binding.failed) {
      binding.failed = true;
      stopFallbackRefresh(binding);
      stopLoadingFallbackRefresh?.();
      onCommittedStream?.("snapshot");
      applyResolvedStreamUiState?.(resolveHaDirectFailedState());
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
      resumeOnFailure,
      stopLoadingFallbackRefresh: () => {},
    };
    bindings.set(engine, binding);
    engine.addEventListener?.("error", binding.onError);
    engine.addEventListener?.("ended", binding.onEnded);
    return binding;
  };

  const isRetainableEngine = (engine) =>
    engine?.type === "ha_direct" &&
    engine?.streamType === "hls" &&
    engine?.catalystHls === true &&
    engine?.ended !== true &&
    !engine?.error &&
    Number(engine?.readyState) >= 2;

  const detachForHandoff = (engine) => {
    if (!isRetainableEngine(engine)) return false;
    return disposeBinding(engine);
  };

  const suspendRetainedEngine = (engine) => {
    if (!isRetainableEngine(engine)) return false;
    disposeBinding(engine);
    engine.catalystDormant = true;
    engine.autoplay = false;
    engine.preload = "metadata";
    try {
      engine.pause?.();
    } catch (_) {}
    return true;
  };

  const adoptRetainedEngine = (slot, engine) => {
    if (!slot || !isRetainableEngine(engine)) return false;
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
      if (binding.disposed || binding.failed || !isCurrentEngine(engine)) {
        return;
      }

      let readyVideo = null;
      let resumed = false;
      try {
        resumed = await waitForStreamStart(
          engine,
          CATALYST_HLS_RESUME_WAIT_MS,
          {
            ...buildRetainedResumeReadiness(engine),
            abortSignal: binding.abortController.signal,
            resolveVideo: () => findActiveHaCameraStreamVideo(engine),
            onVideoReady: (video) => {
              readyVideo = video;
            },
          },
        );
      } catch (_) {
        resumed = false;
      }
      if (binding.disposed || binding.failed || !isCurrentEngine(engine)) {
        return;
      }
      if (!resumed) {
        applyFailed(engine);
        return;
      }
      applyReady(engine, readyVideo || engine);
    })();
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
    detachForHandoff,
    isRetainableEngine,
    prepare,
    release,
    suspendRetainedEngine,
    tryMount,
  };
}
