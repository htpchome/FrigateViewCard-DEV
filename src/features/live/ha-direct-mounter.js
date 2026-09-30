import {
  createHaHlsPlayerElement,
  createHaNativeHlsVideoElement,
  ensureHaCameraPlaybackElements,
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

const HA_DIRECT_PENDING_WEBRTC_STYLE =
  "position:absolute;inset:0;z-index:0;width:100%;height:100%;display:block;pointer-events:none;background:var(--c-bg-deep)";
const HA_DIRECT_VISIBLE_HLS_ATTEMPT_STYLE =
  "position:relative;z-index:1;width:100%;height:100%;display:block;background:var(--c-bg-deep)";
const HA_DIRECT_VISIBLE_STYLE =
  "width:100%;height:100%;display:block;background:var(--c-bg-deep)";
const HA_DIRECT_TIME_RECOVERY_MIN_ADVANCES = 2;
const HA_DIRECT_TIME_RECOVERY_MIN_PROGRESS_SECONDS = 0.05;

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
  startLoadingFallbackRefresh,
  stopLoadingFallbackRefresh,
  setLiveNativeControls,
  scheduleResumeLive,
  scopeKey,
  shouldUseNativeHls = () => false,
  preparePlaybackElements = ensureHaCameraPlaybackElements,
  createNativeHlsVideo = createHaNativeHlsVideoElement,
}) {
  const mediaBindings = new WeakMap();
  let releaseBarrier = Promise.resolve();

  const prepare = () => {
    try {
      return preparePlaybackElements?.() ?? false;
    } catch (_) {
      return false;
    }
  };

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
    binding.stopLoadingFallbackRefresh?.();
    binding.cleanupRecovery?.();
    binding.abortController.abort();
    const takeoverEngine = binding.takeoverEngine || null;
    binding.takeoverEngine = null;
    if (engine) engine.cancelPendingTakeover = null;
    engine.removeEventListener?.("load", binding.reconcile, true);
    engine.removeEventListener?.("streams", binding.onStreams, true);
    mediaBindings.delete(engine);
    if (takeoverEngine && takeoverEngine !== engine) {
      release(takeoverEngine);
    }
    rememberRelease(engine?.destroy?.());
  };

  const awaitUpdate = async (element) => {
    try {
      await element?.updateComplete;
    } catch (_) {}
  };

  const applyReady = (engine, streamType) => {
    if (!isCurrentEngine(engine)) return;
    mediaBindings.get(engine)?.stopLoadingFallbackRefresh?.();
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
    mediaBindings.get(engine)?.stopLoadingFallbackRefresh?.();
    stopLoadingFallbackRefresh?.();
    onCommittedStream?.("snapshot");
    applyResolvedStreamUiState(resolveHaDirectFailedState());
  };

  const bindHlsMedia = (engine) => {
    const binding = {
      disposed: false,
      revision: 0,
      failed: false,
      failureRevision: 0,
      recoveryVideo: null,
      cleanupRecovery: () => {},
      abortController: new AbortController(),
      reconcile: null,
      onStreams: null,
      takeoverEngine: null,
      stopLoadingFallbackRefresh: () => {},
    };
    const watchRecovery = (video) => {
      if (binding.recoveryVideo === video) return;
      binding.cleanupRecovery();
      if (!video) return;
      binding.recoveryVideo = video;
      let active = true;
      let frameId = null;
      let firstPaintFrame = null;
      let secondPaintFrame = null;
      let presentationPending = false;
      const initialTime = Number(video.currentTime);
      let lastTime = Number.isFinite(initialTime) ? initialTime : null;
      let advancingSamples = 0;
      let progressStartTime = null;
      const isActive = () =>
        active && !binding.disposed && binding.failed &&
        isCurrentEngine(engine) &&
        findActiveHaCameraStreamVideo(engine) === video;
      const hasUsablePlaybackState = () => {
        const playbackRate = Number(video.playbackRate);
        return !video.paused && !video.ended && !video.seeking &&
          Number(video.readyState) >= 2 && Number(video.videoWidth) > 0 &&
          (!Number.isFinite(playbackRate) || playbackRate > 0);
      };
      const resetTimeEvidence = (time) => {
        lastTime = Number.isFinite(time) ? time : null;
        advancingSamples = 0;
        progressStartTime = null;
      };
      let onFrame = null;
      const armFrameRecovery = () => {
        if (
          frameId == null &&
          typeof video.requestVideoFrameCallback === "function"
        ) {
          frameId = video.requestVideoFrameCallback(onFrame);
        }
      };
      const recover = () => {
        presentationPending = false;
        if (!isActive()) return;
        if (!hasUsablePlaybackState()) {
          armFrameRecovery();
          return;
        }
        binding.failed = false;
        binding.cleanupRecovery();
        applyReady(engine, "hls");
      };
      const recoverAfterPaint = () => {
        if (
          !isActive() ||
          !hasUsablePlaybackState() ||
          presentationPending
        ) {
          return;
        }
        presentationPending = true;
        const requestFrame = globalThis.requestAnimationFrame;
        if (typeof requestFrame !== "function") {
          recover();
          return;
        }
        firstPaintFrame = requestFrame(() => {
          firstPaintFrame = null;
          if (!isActive()) return;
          secondPaintFrame = requestFrame(() => {
            secondPaintFrame = null;
            recover();
          });
        });
      };
      const onTimeUpdate = () => {
        if (!isActive()) return;
        const time = Number(video.currentTime);
        if (!Number.isFinite(time) || !hasUsablePlaybackState()) {
          resetTimeEvidence(time);
          return;
        }
        if (lastTime == null || time < lastTime) {
          resetTimeEvidence(time);
          return;
        }
        if (time === lastTime) return;
        advancingSamples += 1;
        if (progressStartTime == null) progressStartTime = time;
        lastTime = time;
        if (
          advancingSamples >= HA_DIRECT_TIME_RECOVERY_MIN_ADVANCES &&
          time - progressStartTime >=
            HA_DIRECT_TIME_RECOVERY_MIN_PROGRESS_SECONDS
        ) {
          recoverAfterPaint();
        }
      };
      onFrame = () => {
        frameId = null;
        if (!isActive()) return;
        if (!hasUsablePlaybackState()) {
          armFrameRecovery();
          return;
        }
        recoverAfterPaint();
      };
      binding.cleanupRecovery = () => {
        active = false;
        if (frameId != null) video.cancelVideoFrameCallback?.(frameId);
        if (firstPaintFrame != null) {
          globalThis.cancelAnimationFrame?.(firstPaintFrame);
        }
        if (secondPaintFrame != null) {
          globalThis.cancelAnimationFrame?.(secondPaintFrame);
        }
        firstPaintFrame = null;
        secondPaintFrame = null;
        presentationPending = false;
        video.removeEventListener?.("timeupdate", onTimeUpdate);
        binding.recoveryVideo = null;
        binding.cleanupRecovery = () => {};
      };
      // A lone time jump can be a seek or stale buffered state. WKWebView may
      // omit frame callbacks, so require sustained playback as the fallback.
      video.addEventListener?.("timeupdate", onTimeUpdate);
      armFrameRecovery();
    };
    binding.fail = () => {
      if (binding.disposed || !isCurrentEngine(engine)) return;
      if (!binding.failed) {
        binding.failed = true;
        binding.failureRevision += 1;
        applyFailed(engine);
      }
      binding.reconcile();
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
        if (binding.failed) watchRecovery(video);
      })();
    };
    binding.onStreams = (event) => {
      if (event?.detail?.hasVideo === false) binding.fail();
      else binding.reconcile();
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
      stopLoadingFallbackRefresh: () => {},
    };
    mediaBindings.set(engine, binding);
    return binding;
  };

  const detachWebRtcForHandoff = (engine) => {
    const binding = mediaBindings.get(engine);
    if (
      engine?.type !== "ha_direct" ||
      engine?.streamType !== "webrtc" ||
      !engine?.video ||
      !engine?.pc ||
      !binding ||
      binding.disposed ||
      binding.takeoverEngine
    ) {
      return false;
    }
    binding.disposed = true;
    binding.revision += 1;
    binding.stopLoadingFallbackRefresh?.();
    binding.abortController.abort();
    mediaBindings.delete(engine);
    engine.deactivateRecovery?.();
    return true;
  };

  const adoptRetainedWebRtcEngine = (engine) => {
    if (
      engine?.type !== "ha_direct" ||
      engine?.streamType !== "webrtc" ||
      !engine?.video ||
      !engine?.pc
    ) {
      return false;
    }
    const existingBinding = mediaBindings.get(engine);
    if (!existingBinding || existingBinding.disposed) {
      createWebRtcBinding(engine);
    }
    engine.setRecoveryHandler?.((reason) => scheduleResumeLive?.(reason));
    engine.activateRecovery?.();
    return true;
  };

  const tryMount = async (slot, startup = null, options = {}) => {
    const entity = String(options.entity || "").trim();
    const useNativeHls = shouldUseNativeHls?.() === true;
    if (!useNativeHls) {
      const playbackPreparation = prepare();
      if (playbackPreparation?.then) await playbackPreparation;
    }
    const preferredStreamType = getPreferredStreamType();
    const haDirectPlan = buildHaDirectMountPlan({
      startup: startup || {},
      preferredStreamType,
    });
    const initialStreamType = normalizeHaDirectStreamType(
      haDirectPlan.streamType,
    );
    const commit = options.commit !== false;
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

    const createHlsEngine = async (styleText = "") => {
      const hlsOptions = {
        hass,
        entity,
        controls: false,
        muted: options?.muted ?? getStreamMuted(),
        defaultMuted: options.defaultMuted,
        fitMode: "contain",
        styleText: styleText || options.styleText || HA_DIRECT_VISIBLE_STYLE,
      };
      let engine = null;
      try {
        engine = useNativeHls
          ? await createNativeHlsVideo(hlsOptions)
          : createHaHlsPlayerElement(hlsOptions);
      } catch (_) {
        engine = null;
      }
      if (!engine) return false;
      engine.type = "ha_direct";
      engine.streamType = "hls";
      return engine;
    };

    const mountHls = async () => {
      const engine = await createHlsEngine();
      if (!engine) return false;
      replaceSlotContent(engine);
      if (!commit) {
        return { ok: true, type: "hls", engine, slot };
      }

      assignCommittedEngine(engine);
      const binding = bindHlsMedia(engine);
      binding.stopLoadingFallbackRefresh =
        startLoadingFallbackRefresh?.() || (() => {});
      if (getRotateOverlayActive()) setLiveNativeControls(true);
      const startupReady = (async () => {
        const failureRevision = binding.failureRevision;
        const ready = await waitForStreamStart(engine, haDirectPlan.waitMs, {
          ...haDirectPlan.waitOptions,
          abortSignal: binding.abortController.signal,
          resolveVideo: () => findActiveHaCameraStreamVideo(engine),
        });
        if (binding.disposed || !isCurrentEngine(engine)) return false;
        // A stream error transfers readiness ownership to the recovery watcher.
        // The older startup result must not undo its newer failure or recovery.
        if (failureRevision !== binding.failureRevision) return false;
        if (!ready) {
          binding.fail();
          return false;
        }
        applyReady(engine, "hls");
        return true;
      })();
      return { ok: true, type: "hls", engine, slot, startupReady };
    };

    const removeSlotChildrenExcept = (node) => {
      for (const child of Array.from(slot.children || [])) {
        if (child !== node) child.remove?.();
      }
    };

    const showReadyWebRtc = (ownerEngine) => {
      ownerEngine.video.style.cssText =
        options.styleText || HA_DIRECT_VISIBLE_STYLE;
      removeSlotChildrenExcept(ownerEngine.video);
      if (ownerEngine.video.parentElement !== slot) {
        slot.appendChild(ownerEngine.video);
      }
      onCommittedMediaReady?.(ownerEngine, ownerEngine.video);
      applyReady(ownerEngine, "webrtc");
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
    if (!commit) {
      replaceSlotContent(engine.video);
      void playback.start();
      return { ok: true, type: "webrtc", engine, slot };
    }

    const hlsEngine = await createHlsEngine(
      HA_DIRECT_VISIBLE_HLS_ATTEMPT_STYLE,
    );
    if (!hlsEngine) {
      replaceSlotContent(engine.video);
      assignCommittedEngine(engine);
      const binding = createWebRtcBinding(engine);
      binding.stopLoadingFallbackRefresh =
        startLoadingFallbackRefresh?.() || (() => {});
      onCommittedMediaReady?.(engine, engine.video);
      if (getRotateOverlayActive()) setLiveNativeControls(true);
      const priorRelease = releaseBarrier;
      const startupReady = (async () => {
        await priorRelease;
        if (binding.disposed || !isCurrentEngine(engine)) return false;
        const signalingStarted = await playback.start();
        if (!signalingStarted || binding.disposed || !isCurrentEngine(engine)) {
          return false;
        }
        const ready = await Promise.race([
          waitForStreamStart(engine, haDirectPlan.waitMs, {
            ...haDirectPlan.waitOptions,
            strict: true,
            minCurrentTime: Math.max(
              0.05,
              Number(haDirectPlan.waitOptions.minCurrentTime) || 0,
            ),
            minDecodedFrames: Math.max(
              1,
              Number(haDirectPlan.waitOptions.minDecodedFrames) || 0,
            ),
            requirePresentedFrame: true,
            abortSignal: binding.abortController.signal,
            resolveVideo: () => engine.video,
          }),
          engine.failure,
        ]);
        if (binding.disposed || !isCurrentEngine(engine)) return false;
        if (ready !== true) {
          applyFailed(engine);
          return false;
        }
        showReadyWebRtc(engine);
        return true;
      })();
      return { ok: true, type: "webrtc", engine, slot, startupReady };
    }

    replaceSlotContent(hlsEngine);
    engine.video.style.cssText = HA_DIRECT_PENDING_WEBRTC_STYLE;
    slot.appendChild(engine.video);
    assignCommittedEngine(hlsEngine);
    const hlsBinding = bindHlsMedia(hlsEngine);
    hlsBinding.stopLoadingFallbackRefresh =
      startLoadingFallbackRefresh?.() || (() => {});
    hlsBinding.takeoverEngine = engine;
    if (getRotateOverlayActive()) setLiveNativeControls(true);

    const discardPendingWebRtc = () => {
      if (hlsBinding.takeoverEngine !== engine) return;
      hlsBinding.takeoverEngine = null;
      hlsEngine.cancelPendingTakeover = null;
      release(engine);
      engine.video.remove?.();
    };
    hlsEngine.cancelPendingTakeover = discardPendingWebRtc;

    const hlsReady = (async () => {
      const failureRevision = hlsBinding.failureRevision;
      const ready = await waitForStreamStart(hlsEngine, haDirectPlan.waitMs, {
        ...haDirectPlan.waitOptions,
        abortSignal: hlsBinding.abortController.signal,
        resolveVideo: () => findActiveHaCameraStreamVideo(hlsEngine),
      });
      if (hlsBinding.disposed || !isCurrentEngine(hlsEngine)) return false;
      if (failureRevision !== hlsBinding.failureRevision) return false;
      if (!ready) {
        hlsBinding.fail();
        return false;
      }
      applyReady(hlsEngine, "hls");
      return true;
    })();

    const priorRelease = releaseBarrier;
    const webRtcReady = (async () => {
      await priorRelease;
      if (
        hlsBinding.disposed ||
        hlsBinding.takeoverEngine !== engine ||
        !isCurrentEngine(hlsEngine)
      ) {
        return false;
      }
      const signalingStarted = await playback.start();
      if (
        !signalingStarted ||
        hlsBinding.disposed ||
        hlsBinding.takeoverEngine !== engine ||
        !isCurrentEngine(hlsEngine)
      ) {
        return false;
      }
      const ready = await Promise.race([
        waitForStreamStart(engine, haDirectPlan.waitMs, {
          ...haDirectPlan.waitOptions,
          strict: true,
          minCurrentTime: Math.max(
            0.05,
            Number(haDirectPlan.waitOptions.minCurrentTime) || 0,
          ),
          minDecodedFrames: Math.max(
            1,
            Number(haDirectPlan.waitOptions.minDecodedFrames) || 0,
          ),
          requirePresentedFrame: true,
          abortSignal: hlsBinding.abortController.signal,
          resolveVideo: () => engine.video,
        }),
        engine.failure,
      ]);
      return ready === true;
    })();

    void (async () => {
      const [, didWebRtcStart] = await Promise.all([
        hlsReady,
        webRtcReady,
      ]);
      if (
        hlsBinding.disposed ||
        hlsBinding.takeoverEngine !== engine ||
        !isCurrentEngine(hlsEngine)
      ) {
        return;
      }
      if (!didWebRtcStart) {
        discardPendingWebRtc();
        return;
      }
      // HLS exclusively owns startup. WebRTC may replace it only after the
      // HLS startup attempt has settled and WebRTC has rendered live media.
      hlsBinding.takeoverEngine = null;
      hlsEngine.cancelPendingTakeover = null;
      createWebRtcBinding(engine);
      assignCommittedEngine(engine, { retainPrevious: true });
      showReadyWebRtc(engine);
      hlsEngine.remove?.();
      release(hlsEngine);
    })();

    return {
      ok: true,
      type: "hls",
      engine: hlsEngine,
      slot,
      startupReady: hlsReady,
    };
  };

  return {
    adoptRetainedWebRtcEngine,
    detachWebRtcForHandoff,
    prepare,
    release,
    tryMount,
  };
}
