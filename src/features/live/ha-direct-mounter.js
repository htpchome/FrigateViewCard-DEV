import {
  createHaHlsPlayerElement,
  findActiveHaCameraStreamVideo,
} from "../../integrations/home-assistant/playback.js";
import { createHaDirectWebRtcPlayback } from "../../integrations/home-assistant/webrtc-playback.js";
import {
  buildHaDirectMountPlan,
  resolveHaDirectFailedState,
  resolveHaDirectMountUnavailableState,
  resolveHaDirectReadyState,
} from "./startup-policy.js";

const normalizeHaDirectStreamType = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_");
  return normalized === "hls" ? "hls" : "webrtc";
};

const HA_DIRECT_WEBRTC_TRACK_WAIT_MS = 3000;

const waitForFirstVideoTrack = async (engine, timeoutMs, abortSignal) => {
  let timer = null;
  let onAbort = null;
  const guard = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    if (!abortSignal) return;
    onAbort = () => resolve(false);
    if (abortSignal.aborted) {
      resolve(false);
      return;
    }
    abortSignal.addEventListener("abort", onAbort, { once: true });
  });
  const received = await Promise.race([engine.firstVideoTrack, guard]);
  if (timer != null) clearTimeout(timer);
  if (abortSignal && onAbort) {
    abortSignal.removeEventListener("abort", onAbort);
  }
  return received === true;
};

export function createHaDirectMounter({
  getHass,
  getPreferredStreamType,
  getStreamMuted,
  getRotateOverlayActive,
  isCurrentEngine,
  waitForStreamStart,
  assignCommittedEngine,
  onCommittedMediaReady,
  onCommittedStream,
  applyResolvedStreamUiState,
  setLiveNativeControls,
  scheduleResumeLive,
  scopeKey,
}) {
  const mediaBindings = new WeakMap();
  let releaseBarrier = Promise.resolve();

  const rememberRelease = (releaseResult) => {
    if (!releaseResult?.then) return;
    const pendingRelease = Promise.resolve(releaseResult).catch(() => {});
    releaseBarrier = Promise.all([releaseBarrier, pendingRelease]).then(
      () => undefined,
    );
  };

  const release = (engine) => {
    const binding = mediaBindings.get(engine);
    if (!binding) {
      if (engine?.type === "ha_direct" && engine?.streamType === "webrtc") {
        rememberRelease(engine.destroy?.());
      }
      return;
    }
    binding.disposed = true;
    binding.revision += 1;
    binding.abortController.abort();
    engine.removeEventListener?.("load", binding.reconcile, true);
    engine.removeEventListener?.("streams", binding.onStreams, true);
    mediaBindings.delete(engine);
    rememberRelease(engine?.destroy?.());
  };

  const awaitUpdate = async (element) => {
    try {
      await element?.updateComplete;
    } catch (_) {}
  };

  const applyReady = (engine, streamType) => {
    if (!isCurrentEngine(engine)) return;
    engine.markStarted?.();
    onCommittedStream?.(streamType);
    const readyState = resolveHaDirectReadyState({
      rotateOverlayActive: getRotateOverlayActive(),
      isCurrentEngine: true,
      waitSucceeded: true,
    });
    applyResolvedStreamUiState(readyState);
  };

  const applyFailed = (engine) => {
    if (!isCurrentEngine(engine)) return;
    onCommittedStream?.("snapshot");
    applyResolvedStreamUiState(resolveHaDirectFailedState());
  };

  const bindHlsMedia = (engine, onFailed) => {
    const binding = {
      disposed: false,
      revision: 0,
      abortController: new AbortController(),
      reconcile: null,
      onStreams: null,
    };
    binding.reconcile = () => {
      const revision = ++binding.revision;
      void (async () => {
        await awaitUpdate(engine);
        if (
          binding.disposed ||
          revision !== binding.revision ||
          !isCurrentEngine(engine)
        ) {
          return;
        }
        const video = findActiveHaCameraStreamVideo(engine);
        if (video) onCommittedMediaReady?.(engine, video);
      })();
    };
    binding.onStreams = (event) => {
      if (event?.detail?.hasVideo === false) onFailed?.(binding);
      binding.reconcile();
    };
    mediaBindings.set(engine, binding);
    engine.addEventListener?.("load", binding.reconcile, true);
    engine.addEventListener?.("streams", binding.onStreams, true);
    binding.reconcile();
    return binding;
  };

  const createWebRtcBinding = (engine) => {
    const binding = {
      disposed: false,
      revision: 0,
      abortController: new AbortController(),
      reconcile: null,
      onStreams: null,
    };
    mediaBindings.set(engine, binding);
    return binding;
  };

  const tryMount = async (slot, startup = null, options = {}) => {
    const preferredStreamType = getPreferredStreamType();
    const haDirectPlan = buildHaDirectMountPlan({
      startup: startup || {},
      preferredStreamType,
    });
    const initialStreamType = normalizeHaDirectStreamType(
      haDirectPlan.streamType,
    );
    const commit = options.commit !== false;
    const entity = String(options.entity || "").trim();
    const hass = getHass();
    if (!entity) return false;
    if (!hass?.states?.[entity]) {
      if (commit) {
        applyResolvedStreamUiState(resolveHaDirectMountUnavailableState());
      }
      return false;
    }

    const replaceSlotContent = (node) => {
      slot.innerHTML = "";
      slot.appendChild(node);
    };

    const mountHls = () => {
      const engine = createHaHlsPlayerElement({
        hass,
        entity,
        controls: false,
        muted: options?.muted ?? getStreamMuted(),
        defaultMuted: options.defaultMuted,
        fitMode: "contain",
        styleText:
          options.styleText ||
          "width:100%;height:100%;display:block;background:var(--c-bg-deep)",
      });
      if (!engine) return false;
      replaceSlotContent(engine);
      if (!commit) {
        return { ok: true, type: "hls", engine, slot };
      }

      assignCommittedEngine(engine);
      let failureHandled = false;
      const fail = (binding) => {
        if (failureHandled || binding.disposed || !isCurrentEngine(engine)) {
          return;
        }
        failureHandled = true;
        applyFailed(engine);
      };
      const binding = bindHlsMedia(engine, fail);
      if (getRotateOverlayActive()) setLiveNativeControls(true);
      void (async () => {
        const ready = await waitForStreamStart(engine, haDirectPlan.waitMs, {
          ...haDirectPlan.waitOptions,
          abortSignal: binding.abortController.signal,
          resolveVideo: () => findActiveHaCameraStreamVideo(engine),
        });
        if (binding.disposed || !isCurrentEngine(engine)) return;
        if (!ready) {
          fail(binding);
          return;
        }
        applyReady(engine, "hls");
      })();
      return { ok: true, type: "hls", engine, slot };
    };

    if (initialStreamType === "hls") return mountHls();

    const playback = createHaDirectWebRtcPlayback({
      hass,
      entity,
      muted: options?.muted ?? getStreamMuted(),
      controls: false,
      scopeKey,
      onConnectionLost: (reason) => {
        if (isCurrentEngine(playback?.engine)) scheduleResumeLive?.(reason);
      },
    });
    if (!playback) return mountHls();

    const { engine } = playback;
    replaceSlotContent(engine.video);
    if (!commit) {
      void playback.start();
      return { ok: true, type: "webrtc", engine, slot };
    }

    assignCommittedEngine(engine);
    const binding = createWebRtcBinding(engine);
    onCommittedMediaReady?.(engine, engine.video);
    if (getRotateOverlayActive()) setLiveNativeControls(true);
    void (async () => {
      const priorRelease = releaseBarrier;
      await priorRelease;
      if (binding.disposed || !isCurrentEngine(engine)) return;
      const signalingStartedAt = Date.now();
      const signalingStarted = await playback.start();
      if (
        !signalingStarted ||
        binding.disposed ||
        !isCurrentEngine(engine)
      ) {
        if (!binding.disposed && isCurrentEngine(engine)) {
          release(engine);
          mountHls();
        }
        return;
      }
      const trackWaitMs = Math.min(
        HA_DIRECT_WEBRTC_TRACK_WAIT_MS,
        haDirectPlan.waitMs,
      );
      const videoTrackReceived = await waitForFirstVideoTrack(
        engine,
        trackWaitMs,
        binding.abortController.signal,
      );
      if (binding.disposed || !isCurrentEngine(engine)) return;
      if (!videoTrackReceived) {
        release(engine);
        mountHls();
        return;
      }
      const elapsedMs = Date.now() - signalingStartedAt;
      const frameWaitMs = Math.max(500, haDirectPlan.waitMs - elapsedMs);
      const ready = await Promise.race([
        waitForStreamStart(engine, frameWaitMs, {
          ...haDirectPlan.waitOptions,
          strict: true,
          abortSignal: binding.abortController.signal,
          resolveVideo: () => engine.video,
        }),
        engine.failure,
      ]);
      if (binding.disposed || !isCurrentEngine(engine)) return;
      if (!ready) {
        release(engine);
        mountHls();
        return;
      }
      applyReady(engine, "webrtc");
    })();

    return { ok: true, type: "webrtc", engine, slot };
  };

  return {
    release,
    tryMount,
  };
}
