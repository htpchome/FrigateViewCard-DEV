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

const HA_DIRECT_HIDDEN_ATTEMPT_STYLE =
  "position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;left:-9999px;top:-9999px;background:var(--c-bg-deep)";
const HA_DIRECT_VISIBLE_HLS_ATTEMPT_STYLE =
  "position:absolute;inset:0;z-index:1;width:100%;height:100%;display:block;pointer-events:none;background:var(--c-bg-deep)";
const HA_DIRECT_VISIBLE_STYLE =
  "width:100%;height:100%;display:block;background:var(--c-bg-deep)";
const HA_DIRECT_HLS_DECK_LAYER_STYLE =
  "position:absolute;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none;opacity:0;z-index:0";
const HA_DIRECT_TIME_RECOVERY_MIN_ADVANCES = 2;
const HA_DIRECT_TIME_RECOVERY_MIN_PROGRESS_SECONDS = 0.05;
const HA_DIRECT_HLS_HEALTH_CHECK_MS = 3000;
const HA_DIRECT_HLS_STALL_TIMEOUT_MS = 12000;

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
  createWebRtcPlayback = createHaDirectWebRtcPlayback,
  getPreloadEntities = () => [],
  getActiveEntity = () => "",
  getSelectedEntity = null,
  isMountAttemptCurrent = () => true,
  getPreloadHost = () => null,
  shouldPreload = () => false,
  hasRetainedEngine = () => false,
  retainPreloadedEngine = () => false,
  adoptEditorPreloadedEngine = () => false,
  syncRetainedEntities = () => {},
  requestFrame = (callback) => globalThis.requestAnimationFrame?.(callback),
  cancelFrame = (frame) => globalThis.cancelAnimationFrame?.(frame),
  now = () => Date.now(),
  setHealthInterval = (callback, delay) =>
    globalThis.setInterval?.(callback, delay),
  clearHealthInterval = (interval) =>
    globalThis.clearInterval?.(interval),
}) {
  const mediaBindings = new WeakMap();
  const hlsDeckSlots = new WeakMap();
  const hlsHealthStates = new WeakMap();
  let releaseBarrier = Promise.resolve();
  let activeDeckHlsEngine = null;
  let preloadGeneration = 0;
  let preloadRunning = false;
  let preloadRescheduleRequested = false;
  let preloadFrame = null;
  let preloadPaintFrame = null;
  let pendingPreload = null;

  const normalizeEntity = (value) => String(value || "").trim();
  const isSelectedEntity = (entity) => {
    const targetEntity = normalizeEntity(entity);
    if (!targetEntity) return false;
    if (typeof getSelectedEntity !== "function") return true;
    return normalizeEntity(getSelectedEntity()) === targetEntity;
  };
  const isOwnedMountAttempt = (entity, mountToken) =>
    isSelectedEntity(entity) &&
    isMountAttemptCurrent?.(mountToken, normalizeEntity(entity)) !== false;
  const isCurrentOwnedEngine = (engine) =>
    isCurrentEngine(engine) && isSelectedEntity(engine?.haDirectEntity);

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

  const mountHlsEngineInDeck = (engine, entity) => {
    const host = getPreloadHost?.();
    if (!host?.appendChild || !globalThis.document?.createElement) return false;
    const deckSlot = document.createElement("div");
    deckSlot.setAttribute?.("aria-hidden", "true");
    deckSlot.setAttribute?.("data-fvc-ha-direct-hls", entity);
    deckSlot.style.cssText = HA_DIRECT_HLS_DECK_LAYER_STYLE;
    deckSlot.appendChild(engine);
    host.appendChild(deckSlot);
    hlsDeckSlots.set(engine, deckSlot);
    engine.haDirectHlsDeck = true;
    engine.haDirectEntity = entity;
    return true;
  };

  const setDeckHlsActive = (engine, active) => {
    const deckSlot = hlsDeckSlots.get(engine);
    if (!deckSlot) return false;
    if (active && activeDeckHlsEngine && activeDeckHlsEngine !== engine) {
      setDeckHlsActive(activeDeckHlsEngine, false);
    }
    deckSlot.style.opacity = active ? "1" : "0";
    deckSlot.style.zIndex = active ? "2" : "0";
    engine.muted = active ? Boolean(getStreamMuted()) : true;
    if (active) {
      activeDeckHlsEngine = engine;
      void engine.play?.().catch?.(() => {});
    } else if (activeDeckHlsEngine === engine) {
      activeDeckHlsEngine = null;
    }
    return true;
  };

  const removeHlsDeckSlot = (engine) => {
    const deckSlot = hlsDeckSlots.get(engine);
    if (!deckSlot) return false;
    if (activeDeckHlsEngine === engine) activeDeckHlsEngine = null;
    hlsDeckSlots.delete(engine);
    try {
      deckSlot.remove?.();
    } catch (_) {}
    return true;
  };

  const stopHlsHealthTracking = (engine) => {
    const state = hlsHealthStates.get(engine);
    if (!state) return;
    if (state.interval != null) clearHealthInterval?.(state.interval);
    state.video?.removeEventListener?.("timeupdate", state.onTimeUpdate);
    state.video?.removeEventListener?.("playing", state.onPlaying);
    hlsHealthStates.delete(engine);
  };

  const sampleHlsHealth = (engine) => {
    const state = hlsHealthStates.get(engine);
    if (!state) return null;
    const video = findActiveHaCameraStreamVideo(engine);
    if (state.video !== video) {
      state.video?.removeEventListener?.("timeupdate", state.onTimeUpdate);
      state.video?.removeEventListener?.("playing", state.onPlaying);
      state.video = video;
      state.lastCurrentTime = Number(video?.currentTime);
      state.lastProgressAt = now();
      video?.addEventListener?.("timeupdate", state.onTimeUpdate);
      video?.addEventListener?.("playing", state.onPlaying);
      return state;
    }
    const currentTime = Number(video?.currentTime);
    if (
      Number.isFinite(currentTime) &&
      (!Number.isFinite(state.lastCurrentTime) ||
        Math.abs(currentTime - state.lastCurrentTime) > 0.001)
    ) {
      state.lastCurrentTime = currentTime;
      state.lastProgressAt = now();
    }
    return state;
  };

  const beginHlsHealthTracking = (engine) => {
    if (!engine || hlsHealthStates.has(engine)) return;
    const state = {
      interval: null,
      lastCurrentTime: Number.NaN,
      lastProgressAt: now(),
      onPlaying: null,
      onTimeUpdate: null,
      video: null,
    };
    state.onPlaying = () => {
      state.lastProgressAt = now();
      state.lastCurrentTime = Number(state.video?.currentTime);
    };
    state.onTimeUpdate = () => sampleHlsHealth(engine);
    hlsHealthStates.set(engine, state);
    sampleHlsHealth(engine);
    state.interval = setHealthInterval?.(() => {
      if (globalThis.document?.visibilityState === "hidden") {
        state.lastProgressAt = now();
        return;
      }
      const sampled = sampleHlsHealth(engine);
      if (
        !sampled ||
        now() - sampled.lastProgressAt < HA_DIRECT_HLS_STALL_TIMEOUT_MS
      ) {
        return;
      }
      const wasCurrent = isCurrentOwnedEngine(engine);
      release(engine);
      if (wasCurrent) {
        scheduleResumeLive?.("hls-stalled");
      } else {
        schedulePreloadDeckAfterPaint();
      }
    }, HA_DIRECT_HLS_HEALTH_CHECK_MS);
    state.interval?.unref?.();
  };

  const isHlsHealthFresh = (engine) => {
    const state = sampleHlsHealth(engine);
    return Boolean(
      state && now() - state.lastProgressAt < HA_DIRECT_HLS_STALL_TIMEOUT_MS,
    );
  };

  const release = (engine) => {
    const binding = mediaBindings.get(engine);
    if (!binding) {
      if (engine?.type === "ha_direct" && engine?.streamType === "webrtc") {
        rememberRelease(engine.destroy?.());
      } else if (engine?.type === "ha_direct" && engine?.streamType === "hls") {
        stopHlsHealthTracking(engine);
        rememberRelease(engine.destroy?.());
        if (!removeHlsDeckSlot(engine)) engine.remove?.();
      }
      return;
    }
    binding.disposed = true;
    binding.revision += 1;
    binding.stopLoadingFallbackRefresh?.();
    binding.cleanupRecovery?.();
    binding.abortController.abort();
    binding.fallbackAbortController?.abort?.();
    const fallbackEngine = binding.fallbackEngine || null;
    const takeoverEngine = binding.takeoverEngine || null;
    binding.fallbackAbortController = null;
    binding.fallbackEngine = null;
    binding.takeoverEngine = null;
    if (engine) engine.cancelPendingTakeover = null;
    engine.removeEventListener?.("load", binding.reconcile, true);
    engine.removeEventListener?.("streams", binding.onStreams, true);
    mediaBindings.delete(engine);
    if (fallbackEngine && fallbackEngine !== engine) {
      release(fallbackEngine);
    }
    if (takeoverEngine && takeoverEngine !== engine) {
      release(takeoverEngine);
    }
    rememberRelease(engine?.destroy?.());
    if (engine?.streamType === "hls") {
      stopHlsHealthTracking(engine);
      if (!removeHlsDeckSlot(engine)) engine.remove?.();
    }
  };

  const awaitUpdate = async (element) => {
    try {
      await element?.updateComplete;
    } catch (_) {}
  };

  const applyReady = (engine, streamType) => {
    if (!isCurrentOwnedEngine(engine)) return;
    mediaBindings.get(engine)?.stopLoadingFallbackRefresh?.();
    engine.markStarted?.();
    onCommittedStream?.(streamType);
    const readyState = resolveHaDirectReadyState({
      rotateOverlayActive: getRotateOverlayActive(),
      isCurrentEngine: true,
      waitSucceeded: true,
    });
    applyResolvedStreamUiState(readyState);
    schedulePreloadDeckAfterPaint();
  };

  const applyFailed = (engine) => {
    if (!isCurrentOwnedEngine(engine)) return;
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
        isCurrentOwnedEngine(engine) &&
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
      if (binding.disposed || !isCurrentOwnedEngine(engine)) return;
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
          !isCurrentOwnedEngine(engine)
        ) {
          return;
        }
        const video = findActiveHaCameraStreamVideo(engine);
        sampleHlsHealth(engine);
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
      fallbackAbortController: null,
      fallbackEngine: null,
      takeoverEngine: null,
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
      !engine?.pc
    ) {
      return false;
    }
    if (!binding) {
      engine.deactivateRecovery?.();
      return true;
    }
    if (
      binding.disposed ||
      binding.fallbackEngine ||
      binding.fallbackAbortController ||
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
      !engine?.pc ||
      !isSelectedEntity(engine?.haDirectEntity)
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

  const isRetainableHlsEngine = (engine) => {
    if (
      engine?.type !== "ha_direct" ||
      engine?.streamType !== "hls" ||
      engine?.haDirectHlsDeck !== true ||
      !hlsDeckSlots.has(engine)
    ) {
      return false;
    }
    const video = findActiveHaCameraStreamVideo(engine);
    return Boolean(
      video &&
        video.ended !== true &&
        !video.error &&
        Number(video.readyState) >= 2 &&
        Number(video.videoWidth) > 0 &&
        isHlsHealthFresh(engine),
    );
  };

  const suspendRetainedHlsEngine = (engine) => {
    if (!isRetainableHlsEngine(engine)) return false;
    const binding = mediaBindings.get(engine);
    if (binding) {
      binding.disposed = true;
      binding.revision += 1;
      binding.stopLoadingFallbackRefresh?.();
      binding.cleanupRecovery?.();
      binding.abortController.abort();
      binding.fallbackAbortController?.abort?.();
      const fallbackEngine = binding.fallbackEngine || null;
      const takeoverEngine = binding.takeoverEngine || null;
      binding.fallbackEngine = null;
      binding.fallbackAbortController = null;
      binding.takeoverEngine = null;
      engine.cancelPendingTakeover = null;
      engine.removeEventListener?.("load", binding.reconcile, true);
      engine.removeEventListener?.("streams", binding.onStreams, true);
      mediaBindings.delete(engine);
      if (fallbackEngine && fallbackEngine !== engine) release(fallbackEngine);
      if (takeoverEngine && takeoverEngine !== engine) release(takeoverEngine);
    }
    setDeckHlsActive(engine, false);
    engine.muted = true;
    try {
      void engine.play?.().catch?.(() => {});
    } catch (_) {}
    return true;
  };

  const cancelScheduledPreload = () => {
    if (preloadFrame != null) cancelFrame?.(preloadFrame);
    if (preloadPaintFrame != null) cancelFrame?.(preloadPaintFrame);
    preloadFrame = null;
    preloadPaintFrame = null;
  };

  const cancelPendingPreload = ({ preservePlayback = false } = {}) => {
    const pending = pendingPreload;
    if (!pending) return null;
    pendingPreload = null;
    pending.promoted = preservePlayback;
    if (!preservePlayback) {
      pending.cancelled = true;
      pending.abortController.abort();
      release(pending.engine);
      if (
        pending.playback?.engine &&
        pending.playback.engine !== pending.engine
      ) {
        release(pending.playback.engine);
      }
    }
    try {
      pending.slot?.remove?.();
    } catch (_) {}
    return preservePlayback ? pending : null;
  };

  const cancelPreloads = () => {
    preloadGeneration += 1;
    preloadRescheduleRequested = false;
    cancelScheduledPreload();
    cancelPendingPreload();
  };

  const createWebRtc = (entity, muted) => {
    const targetEntity = normalizeEntity(entity);
    let playback = null;
    playback = createWebRtcPlayback({
      hass: getHass(),
      entity: targetEntity,
      muted,
      controls: false,
      scopeKey,
      onConnectionLost: (reason) => {
        if (isCurrentOwnedEngine(playback?.engine)) {
          scheduleResumeLive?.(reason);
        }
      },
    });
    if (playback?.engine) playback.engine.haDirectEntity = targetEntity;
    return playback;
  };

  const createHlsEngine = async ({
    entity,
    muted,
    defaultMuted,
    styleText = HA_DIRECT_VISIBLE_STYLE,
    useDeck = true,
  } = {}) => {
    const hass = getHass();
    if (!hass?.states?.[entity]) return null;
    const hlsOptions = {
      hass,
      entity,
      controls: false,
      muted: muted ?? getStreamMuted(),
      defaultMuted,
      fitMode: "contain",
      styleText,
    };
    let engine = null;
    try {
      engine = shouldUseNativeHls?.() === true
        ? await createNativeHlsVideo(hlsOptions)
        : createHaHlsPlayerElement(hlsOptions);
    } catch (_) {
      engine = null;
    }
    if (!engine) return null;
    engine.type = "ha_direct";
    engine.streamType = "hls";
    engine.haDirectEntity = normalizeEntity(entity);
    if (useDeck) mountHlsEngineInDeck(engine, entity);
    beginHlsHealthTracking(engine);
    return engine;
  };

  const startWebRtcTakeoverForRetainedHls = (hlsEngine, slot) => {
    const hlsBinding = mediaBindings.get(hlsEngine);
    const entity = String(hlsEngine?.haDirectEntity || "").trim();
    if (
      !hlsBinding ||
      hlsBinding.disposed ||
      !entity ||
      !slot ||
      !isSelectedEntity(entity)
    ) {
      return false;
    }
    const playback = createWebRtc(entity, getStreamMuted());
    if (!playback?.engine) return false;

    const { engine } = playback;
    engine.video.style.cssText = HA_DIRECT_HIDDEN_ATTEMPT_STYLE;
    slot.appendChild(engine.video);
    const webRtcBinding = createWebRtcBinding(engine);
    hlsBinding.takeoverEngine = engine;
    hlsEngine.cancelPendingTakeover = () => {
      const activeBinding = mediaBindings.get(hlsEngine);
      const pendingEngine = activeBinding?.takeoverEngine || null;
      if (activeBinding) activeBinding.takeoverEngine = null;
      hlsEngine.cancelPendingTakeover = null;
      if (pendingEngine) release(pendingEngine);
    };

    const plan = buildHaDirectMountPlan({
      startup: { streamType: "webrtc" },
      preferredStreamType: "webrtc",
    });
    void (async () => {
      let ready = false;
      try {
        await releaseBarrier;
        if (
          hlsBinding.disposed ||
          hlsBinding.takeoverEngine !== engine ||
          !isCurrentOwnedEngine(hlsEngine) ||
          !isSelectedEntity(engine.haDirectEntity)
        ) {
          release(engine);
          return;
        }
        const signalingStarted = await playback.start();
        if (signalingStarted) {
          ready = await Promise.race([
            waitForStreamStart(engine, plan.waitMs, {
              ...plan.waitOptions,
              strict: true,
              minCurrentTime: Math.max(
                0.05,
                Number(plan.waitOptions.minCurrentTime) || 0,
              ),
              minDecodedFrames: Math.max(
                1,
                Number(plan.waitOptions.minDecodedFrames) || 0,
              ),
              requirePresentedFrame: true,
              abortSignal: webRtcBinding.abortController.signal,
              resolveVideo: () => engine.video,
            }),
            engine.failure,
          ]);
        }
      } catch (_) {
        ready = false;
      }

      if (
        ready !== true ||
        hlsBinding.disposed ||
        hlsBinding.takeoverEngine !== engine ||
        !isCurrentOwnedEngine(hlsEngine) ||
        !isSelectedEntity(engine.haDirectEntity)
      ) {
        if (hlsBinding.takeoverEngine === engine) {
          hlsBinding.takeoverEngine = null;
          hlsEngine.cancelPendingTakeover = null;
        }
        release(engine);
        return;
      }

      hlsBinding.takeoverEngine = null;
      hlsEngine.cancelPendingTakeover = null;
      engine.video.style.cssText = HA_DIRECT_VISIBLE_STYLE;
      slot.innerHTML = "";
      slot.appendChild(engine.video);
      assignCommittedEngine(engine);
      onCommittedMediaReady?.(engine, engine.video);
      applyReady(engine, "webrtc");
    })();
    return true;
  };

  const adoptRetainedHlsEngine = (slot, engine) => {
    if (
      !slot ||
      !isRetainableHlsEngine(engine) ||
      !isSelectedEntity(engine?.haDirectEntity)
    ) {
      return false;
    }
    slot.innerHTML = "";
    if (!setDeckHlsActive(engine, true)) return false;
    assignCommittedEngine(engine);
    const binding = bindHlsMedia(engine);
    const video = findActiveHaCameraStreamVideo(engine);
    if (video) onCommittedMediaReady?.(engine, video);
    if (getRotateOverlayActive()) setLiveNativeControls(true);
    applyReady(engine, "hls");
    startWebRtcTakeoverForRetainedHls(engine, slot);
    return binding.disposed !== true;
  };

  const preloadHaDirectEntity = async (entity, generation) => {
    if (
      generation !== preloadGeneration ||
      shouldPreload?.() !== true ||
      hasRetainedEngine?.(entity) === true
    ) {
      return false;
    }
    if (adoptEditorPreloadedEngine?.(entity) === true) return true;
    const engine = await createHlsEngine({
      entity,
      muted: true,
      styleText: HA_DIRECT_VISIBLE_STYLE,
      useDeck: true,
    });
    if (!engine) return false;
    if (
      generation !== preloadGeneration ||
      shouldPreload?.() !== true ||
      hasRetainedEngine?.(entity) === true
    ) {
      release(engine);
      return false;
    }
    const playback = createWebRtc(entity, true);
    const webRtcEngine = playback?.engine || null;
    if (webRtcEngine) createWebRtcBinding(webRtcEngine);
    const abortController = new AbortController();
    const pending = {
      abortController,
      cancelled: false,
      engine,
      entity,
      playback,
      promoted: false,
      slot: null,
      startPromise: null,
    };
    pendingPreload = pending;
    try {
      await engine.play?.();
    } catch (_) {}

    const hlsPlan = buildHaDirectMountPlan({
      startup: { streamType: "hls" },
      preferredStreamType: "webrtc",
    });
    const webRtcPlan = buildHaDirectMountPlan({
      startup: { streamType: "webrtc" },
      preferredStreamType: "webrtc",
    });
    const hlsReady = (async () => {
      try {
        return (
          (await waitForStreamStart(engine, hlsPlan.waitMs, {
            ...hlsPlan.waitOptions,
            abortSignal: abortController.signal,
            resolveVideo: () => findActiveHaCameraStreamVideo(engine),
          })) === true
        );
      } catch (_) {
        return false;
      }
    })();
    pending.startPromise = webRtcEngine
      ? (async () => {
          await releaseBarrier;
          if (abortController.signal.aborted) return false;
          try {
            return (await playback.start()) === true;
          } catch (_) {
            return false;
          }
        })()
      : Promise.resolve(false);
    const webRtcReady = webRtcEngine
      ? (async () => {
          if (!(await pending.startPromise) || abortController.signal.aborted) {
            return false;
          }
          try {
            const ready = await Promise.race([
              waitForStreamStart(webRtcEngine, webRtcPlan.waitMs, {
                ...webRtcPlan.waitOptions,
                strict: true,
                minCurrentTime: Math.max(
                  0.05,
                  Number(webRtcPlan.waitOptions.minCurrentTime) || 0,
                ),
                minDecodedFrames: Math.max(
                  1,
                  Number(webRtcPlan.waitOptions.minDecodedFrames) || 0,
                ),
                requirePresentedFrame: true,
                abortSignal: abortController.signal,
                resolveVideo: () => webRtcEngine.video,
              }),
              webRtcEngine.failure,
            ]);
            return ready === true;
          } catch (_) {
            return false;
          }
        })()
      : Promise.resolve(false);
    const readyCandidate = (type, promise) =>
      promise.then((ready) => {
        if (!ready) throw new Error(`${type} did not render`);
        return type;
      });
    const firstReady = await Promise.any([
      readyCandidate("hls", hlsReady),
      readyCandidate("webrtc", webRtcReady),
    ]).catch(() => "");
    const useWebRtc =
      firstReady === "webrtc" ||
      (firstReady === "hls" && (await webRtcReady) === true);
    let hlsSucceeded =
      firstReady === "hls" ||
      (!useWebRtc && (await hlsReady) === true);
    if (pendingPreload === pending) pendingPreload = null;
    if (pending.promoted) return true;
    if (pending.cancelled) return false;
    const stillConfigured = (getPreloadEntities?.() || []).includes(entity);
    if (
      (!useWebRtc && !hlsSucceeded) ||
      generation !== preloadGeneration ||
      shouldPreload?.() !== true ||
      !stillConfigured
    ) {
      release(engine);
      if (webRtcEngine) release(webRtcEngine);
      return false;
    }
    if (useWebRtc && webRtcEngine) {
      webRtcEngine.markStarted?.();
      if (retainPreloadedEngine?.(entity, webRtcEngine) === true) {
        abortController.abort();
        release(engine);
        return true;
      }
      release(webRtcEngine);
      hlsSucceeded = hlsSucceeded || (await hlsReady) === true;
    } else if (webRtcEngine) {
      release(webRtcEngine);
    }
    if (
      hlsSucceeded &&
      isRetainableHlsEngine(engine) &&
      retainPreloadedEngine?.(entity, engine) === true
    ) {
      return true;
    }
    release(engine);
    return false;
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
    return preloadHaDirectEntity(targetEntity, generation);
  };

  const runPreloadDeck = async (generation) => {
    if (preloadRunning || generation !== preloadGeneration) return;
    preloadRunning = true;
    try {
      const entities = [...new Set(getPreloadEntities?.() || [])];
      syncRetainedEntities?.(entities);
      for (const entity of entities) {
        if (generation !== preloadGeneration || shouldPreload?.() !== true) {
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

  const tryMount = async (slot, startup = null, options = {}) => {
    const entity = String(options.entity || "").trim();
    const mountToken = options.mountToken;
    const useNativeHls = shouldUseNativeHls?.() === true;
    if (!useNativeHls) {
      const playbackPreparation = prepare();
      if (playbackPreparation?.then) await playbackPreparation;
    }
    if (options.commit !== false && !isOwnedMountAttempt(entity, mountToken)) {
      return false;
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

    let promotedPreload = null;
    if (commit) {
      const pendingForEntity = pendingPreload?.entity === entity;
      preloadGeneration += 1;
      cancelScheduledPreload();
      if (pendingForEntity) {
        promotedPreload = cancelPendingPreload({ preservePlayback: true });
      } else {
        cancelPendingPreload();
      }
    }

    const replaceSlotContent = (node) => {
      slot.innerHTML = "";
      slot.appendChild(node);
    };

    const mountHls = async () => {
      const engine =
        promotedPreload?.engine?.streamType === "hls"
          ? promotedPreload.engine
          : await createHlsEngine({
              entity,
              muted: options?.muted ?? getStreamMuted(),
              defaultMuted: options.defaultMuted,
              styleText: options.styleText || HA_DIRECT_VISIBLE_STYLE,
              useDeck: commit,
            });
      if (!engine) return false;
      if (commit && !isOwnedMountAttempt(entity, mountToken)) {
        release(engine);
        return false;
      }
      if (hlsDeckSlots.has(engine)) {
        slot.innerHTML = "";
        setDeckHlsActive(engine, true);
      } else {
        replaceSlotContent(engine);
      }
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
        if (
          binding.disposed ||
          !isCurrentOwnedEngine(engine) ||
          !isOwnedMountAttempt(entity, mountToken)
        ) {
          return false;
        }
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

    const waitForHlsAttempt = async (engine, abortSignal) => {
      const ready = await waitForStreamStart(engine, haDirectPlan.waitMs, {
        ...haDirectPlan.waitOptions,
        abortSignal,
        resolveVideo: () => findActiveHaCameraStreamVideo(engine),
      });
      return ready === true;
    };

    const removeSlotChildrenExcept = (node) => {
      for (const child of Array.from(slot.children || [])) {
        if (child !== node) child.remove?.();
      }
    };

    const commitReadyHls = (engine, { retainPrevious = false } = {}) => {
      if (!isOwnedMountAttempt(entity, mountToken)) return false;
      engine.style.cssText = options.styleText || HA_DIRECT_VISIBLE_STYLE;
      const inDeck = hlsDeckSlots.has(engine);
      if (!retainPrevious) removeSlotChildrenExcept(inDeck ? null : engine);
      if (inDeck) {
        setDeckHlsActive(engine, true);
      } else if (engine.parentElement !== slot) {
        slot.appendChild(engine);
      }
      assignCommittedEngine(engine, { retainPrevious });
      bindHlsMedia(engine);
      if (getRotateOverlayActive()) setLiveNativeControls(true);
      applyReady(engine, "hls");
      return { ok: true, type: "hls", engine, slot };
    };

    const releaseHlsEngine = (hlsEngine) => {
      release(hlsEngine);
    };

    const showReadyWebRtc = (ownerEngine, hlsEngine) => {
      if (
        !isOwnedMountAttempt(entity, mountToken) ||
        !isSelectedEntity(ownerEngine?.haDirectEntity) ||
        (!isCurrentEngine(ownerEngine) && !isCurrentEngine(hlsEngine))
      ) {
        release(ownerEngine);
        return false;
      }
      ownerEngine.video.style.cssText =
        options.styleText || HA_DIRECT_VISIBLE_STYLE;
      removeSlotChildrenExcept(ownerEngine.video);
      if (ownerEngine.video.parentElement !== slot) {
        slot.appendChild(ownerEngine.video);
      }
      if (!isCurrentEngine(ownerEngine)) {
        assignCommittedEngine(ownerEngine);
      } else {
        releaseHlsEngine(hlsEngine);
      }
      onCommittedMediaReady?.(ownerEngine, ownerEngine.video);
      applyReady(ownerEngine, "webrtc");
      return true;
    };

    if (initialStreamType === "hls") return mountHls();

    const playback =
      promotedPreload?.playback ||
      createWebRtc(entity, options?.muted ?? getStreamMuted());
    if (!playback) return mountHls();

    const { engine } = playback;
    if (!isOwnedMountAttempt(entity, mountToken)) {
      release(engine);
      return false;
    }
    replaceSlotContent(engine.video);
    if (!commit) {
      void playback.start();
      return { ok: true, type: "webrtc", engine, slot };
    }

    assignCommittedEngine(engine);
    const binding = mediaBindings.get(engine) || createWebRtcBinding(engine);
    binding.stopLoadingFallbackRefresh =
      startLoadingFallbackRefresh?.() || (() => {});
    onCommittedMediaReady?.(engine, engine.video);
    if (getRotateOverlayActive()) setLiveNativeControls(true);
    // HLS is the first-picture path. A retained player stays in the stable
    // full-sized deck while WebRTC remains owned and may take over when ready.
    const fallbackEngine =
      promotedPreload?.engine?.streamType === "hls"
        ? promotedPreload.engine
        : await createHlsEngine({
            entity,
            muted: options?.muted ?? getStreamMuted(),
            defaultMuted: options.defaultMuted,
            styleText: HA_DIRECT_VISIBLE_HLS_ATTEMPT_STYLE,
            useDeck: true,
          });
    const fallbackAbortController = new AbortController();
    if (!isOwnedMountAttempt(entity, mountToken)) {
      fallbackAbortController.abort();
      release(fallbackEngine);
      release(engine);
      return false;
    }
    if (fallbackEngine) {
      binding.fallbackEngine = fallbackEngine;
      binding.fallbackAbortController = fallbackAbortController;
      if (hlsDeckSlots.has(fallbackEngine)) {
        setDeckHlsActive(fallbackEngine, true);
      } else {
        slot.appendChild(fallbackEngine);
      }
    }
    const isWebRtcAttemptActive = () => {
      if (binding.disposed || !isOwnedMountAttempt(entity, mountToken)) {
        return false;
      }
      if (isCurrentEngine(engine)) return true;
      const hlsBinding = fallbackEngine
        ? mediaBindings.get(fallbackEngine)
        : null;
      return Boolean(
        hlsBinding?.takeoverEngine === engine &&
          !hlsBinding.disposed &&
          isCurrentOwnedEngine(fallbackEngine),
      );
    };
    const startupReady = (async () => {
      const priorRelease = releaseBarrier;
      const webRtcReady = (async () => {
        await priorRelease;
        if (!isWebRtcAttemptActive()) return false;
        const signalingStarted = await (
          promotedPreload?.startPromise || playback.start()
        );
        if (!signalingStarted || !isWebRtcAttemptActive()) {
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
        return ready === true;
      })();
      const hlsReady = fallbackEngine
        ? (async () => {
            const ready = await waitForHlsAttempt(
              fallbackEngine,
              fallbackAbortController.signal,
            );
            return ready;
          })()
        : Promise.resolve(false);
      const readyCandidate = (type, promise) =>
        promise.then((ready) => {
          if (!ready) throw new Error(`${type} did not render`);
          return type;
        });
      let winner = await Promise.any([
        readyCandidate("webrtc", webRtcReady),
        readyCandidate("hls", hlsReady),
      ]).catch(() => "");
      if (!isWebRtcAttemptActive()) return false;
      if (winner === "hls") {
        binding.stopLoadingFallbackRefresh();
        binding.fallbackAbortController = null;
        binding.fallbackEngine = null;
        fallbackAbortController.abort();
        engine.video.style.cssText = HA_DIRECT_HIDDEN_ATTEMPT_STYLE;
        if (!commitReadyHls(fallbackEngine, { retainPrevious: true })) {
          release(engine);
          return false;
        }
        const hlsBinding = mediaBindings.get(fallbackEngine);
        if (!hlsBinding || !isCurrentOwnedEngine(fallbackEngine)) {
          release(engine);
          return false;
        }
        hlsBinding.takeoverEngine = engine;
        fallbackEngine.cancelPendingTakeover = () => {
          const activeBinding = mediaBindings.get(fallbackEngine);
          const pendingEngine = activeBinding?.takeoverEngine || null;
          if (activeBinding) activeBinding.takeoverEngine = null;
          fallbackEngine.cancelPendingTakeover = null;
          if (pendingEngine) release(pendingEngine);
        };
        // HLS is already usable, so release mount ownership now. The optional
        // takeover continues under the committed HLS binding without allowing
        // visibility/lifecycle callbacks to restart this mount in the gap.
        void (async () => {
          const webRtcStarted = await webRtcReady;
          if (
            hlsBinding.disposed ||
            !isCurrentOwnedEngine(fallbackEngine) ||
            !isOwnedMountAttempt(entity, mountToken)
          ) {
            release(engine);
            return;
          }
          hlsBinding.takeoverEngine = null;
          fallbackEngine.cancelPendingTakeover = null;
          if (!webRtcStarted) {
            release(engine);
            return;
          }
          showReadyWebRtc(engine, fallbackEngine);
        })();
        return true;
      }
      if (winner === "webrtc") {
        binding.stopLoadingFallbackRefresh();
        binding.fallbackAbortController = null;
        binding.fallbackEngine = null;
        fallbackAbortController.abort();
        return showReadyWebRtc(engine, fallbackEngine);
      }
      applyFailed(engine);
      release(engine);
      fallbackAbortController.abort();
      releaseHlsEngine(fallbackEngine);
      return false;
    })();

    return { ok: true, type: "webrtc", engine, slot, startupReady };
  };

  return {
    adoptRetainedHlsEngine,
    adoptRetainedWebRtcEngine,
    cancelPreloads,
    detachWebRtcForHandoff,
    isRetainableHlsEngine,
    prepare,
    release,
    schedulePreloadDeckAfterPaint,
    suspendRetainedHlsEngine,
    tryMount,
  };
}
