import {
  findActiveHaCameraStreamVideo,
} from "../../integrations/home-assistant/playback.js";
import {
  createHaLowLatencyHlsVideoElement,
  ensureHaLowLatencyHlsPlayback,
} from "../../integrations/home-assistant/low-latency-hls.js";
import { watchMediaFirstFrame } from "../../shared/media/first-frame.js";
import {
  resolveHaDirectFailedState,
  resolveHaDirectMountUnavailableState,
  resolveHaDirectReadyState,
} from "./startup-policy.js";

const CATALYST_HLS_VISIBLE_STYLE =
  "width:100%;height:100%;display:block;background:var(--c-bg-deep)";
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
  applyResolvedStreamUiState,
  startLoadingFallbackRefresh,
  stopLoadingFallbackRefresh,
  setLiveNativeControls,
  prepareHlsPlayback = ensureHaLowLatencyHlsPlayback,
  createHlsVideo = createHaLowLatencyHlsVideoElement,
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

  const release = (engine) => {
    if (!engine?.catalystHls) return;
    const binding = bindings.get(engine);
    if (binding) {
      binding.disposed = true;
      binding.abortController.abort();
      stopFallbackRefresh(binding);
      binding.cleanupRecovery?.();
      engine.removeEventListener?.("error", binding.onError);
      bindings.delete(engine);
    }
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
    watchLateRecovery(engine, binding);
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

    const binding = {
      abortController: new AbortController(),
      cleanupRecovery: () => {},
      disposed: false,
      failed: false,
      onError: () => applyFailed(engine),
      stopLoadingFallbackRefresh: () => {},
    };
    bindings.set(engine, binding);
    engine.addEventListener?.("error", binding.onError);
    assignCommittedEngine?.(engine);
    binding.stopLoadingFallbackRefresh =
      startLoadingFallbackRefresh?.() || (() => {});
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

  return { prepare, release, tryMount };
}
