import {
  createHaCameraStreamElement,
  findActiveHaCameraStreamVideo,
  resolveActiveHaCameraStreamType,
  setHaCameraStreamOutputMuted,
  watchHaPlaybackFirstFrame,
} from "../../integrations/home-assistant/playback.js";
import {
  buildHaDirectMountPlan,
  resolveHaDirectFailedState,
  resolveHaDirectMountUnavailableState,
  resolveHaDirectReadyState,
} from "./startup-policy.js";

const HA_DIRECT_VISIBLE_STYLE =
  "width:100%;height:100%;display:block;background:var(--c-bg-deep)";

const isManagedHaCameraStream = (engine) =>
  engine?.type === "ha_direct" &&
  engine?.tagName?.toLowerCase?.() === "ha-camera-stream";

export function createHaDirectMounter({
  getHass,
  getPreferredStreamType,
  getStreamMuted,
  getRotateOverlayActive,
  getCurrentEngine,
  isCurrentEngine,
  waitForStreamStart,
  assignCommittedEngine,
  onCommittedMediaReady,
  onCommittedStream,
  applyResolvedStreamUiState,
  setLiveNativeControls,
}) {
  const mediaBindings = new WeakMap();

  const applyReady = (engine) => {
    if (!isCurrentEngine(engine)) return;
    const streamType = resolveActiveHaCameraStreamType(
      engine,
      engine.streamType || "hls",
    );
    engine.streamType = streamType;
    onCommittedStream?.(streamType);
    applyResolvedStreamUiState(
      resolveHaDirectReadyState({
        rotateOverlayActive: getRotateOverlayActive(),
        isCurrentEngine: true,
        waitSucceeded: true,
      }),
    );
  };

  const applyFailed = (engine) => {
    if (!isCurrentEngine(engine)) return;
    onCommittedStream?.("snapshot");
    applyResolvedStreamUiState(resolveHaDirectFailedState());
  };

  const applyOutputMute = (engine, binding) => {
    if (binding.disposed) return false;
    return setHaCameraStreamOutputMuted(engine, binding.outputMuted);
  };

  const stopReadyWatch = (binding) => {
    binding.readyRevision += 1;
    binding.readyAbortController?.abort?.();
    binding.readyAbortController = null;
    binding.cleanupRecovery?.();
    binding.cleanupRecovery = null;
  };

  const startReadyWatch = (engine, binding, expectedVideo = null) => {
    stopReadyWatch(binding);
    if (binding.disposed) return;

    const revision = binding.readyRevision;
    const abortController = new AbortController();
    binding.readyAbortController = abortController;
    const resolveVideo = () => {
      const activeVideo = findActiveHaCameraStreamVideo(engine);
      return expectedVideo && activeVideo !== expectedVideo
        ? null
        : activeVideo;
    };

    void (async () => {
      const ready = await waitForStreamStart(engine, binding.plan.waitMs, {
        ...binding.plan.waitOptions,
        abortSignal: abortController.signal,
        resolveVideo,
        onVideoReady: (video) => onCommittedMediaReady?.(engine, video),
      });
      if (
        binding.disposed ||
        revision !== binding.readyRevision ||
        !isCurrentEngine(engine)
      ) {
        return;
      }
      binding.readyAbortController = null;
      const activeVideo = resolveVideo();
      if (ready && activeVideo) {
        binding.hasCommittedFrame = true;
        binding.observedVideo = activeVideo;
        binding.readyVideo = activeVideo;
        applyOutputMute(engine, binding);
        applyReady(engine);
        return;
      }

      applyFailed(engine);
      binding.cleanupRecovery = watchHaPlaybackFirstFrame({
        stream: engine,
        isDestroyed: () =>
          binding.disposed ||
          revision !== binding.readyRevision ||
          !isCurrentEngine(engine),
        onReady: () => {
          if (
            binding.disposed ||
            revision !== binding.readyRevision ||
            !isCurrentEngine(engine)
          ) {
            return;
          }
          const recoveredVideo = findActiveHaCameraStreamVideo(engine);
          if (!recoveredVideo) return;
          binding.hasCommittedFrame = true;
          binding.observedVideo = recoveredVideo;
          binding.readyVideo = recoveredVideo;
          applyOutputMute(engine, binding);
          onCommittedMediaReady?.(engine, recoveredVideo);
          applyReady(engine);
        },
      });
    })();
  };

  const scheduleReconcile = (engine, binding) => {
    const revision = ++binding.reconcileRevision;
    void Promise.resolve().then(async () => {
      try {
        await engine.updateComplete;
      } catch (_) {}
      if (
        binding.disposed ||
        revision !== binding.reconcileRevision ||
        !isCurrentEngine(engine)
      ) {
        return;
      }

      const video = findActiveHaCameraStreamVideo(engine);
      applyOutputMute(engine, binding);
      if (!video) return;
      onCommittedMediaReady?.(engine, video);
      if (video === binding.observedVideo) return;
      binding.observedVideo = video;
      if (binding.hasCommittedFrame) startReadyWatch(engine, binding, video);
    });
  };

  const setOutputMuted = (engine, binding, muted) => {
    binding.outputMuted = muted === true;
    if (!binding.outputMuted && binding.selectionMuted) {
      binding.selectionMuted = false;
      engine.muted = false;
    }
    applyOutputMute(engine, binding);
    scheduleReconcile(engine, binding);
  };

  const bindManagedMedia = (engine, { entity, plan, muted }) => {
    const binding = {
      disposed: false,
      entity,
      plan,
      selectionMuted: muted === true,
      outputMuted: muted === true,
      hasCommittedFrame: false,
      observedVideo: null,
      readyVideo: null,
      readyRevision: 0,
      readyAbortController: null,
      cleanupRecovery: null,
      reconcileRevision: 0,
      reconcile: null,
    };
    binding.reconcile = () => scheduleReconcile(engine, binding);
    mediaBindings.set(engine, binding);
    engine.setOutputMuted = (nextMuted) =>
      setOutputMuted(engine, binding, nextMuted);
    engine.addEventListener?.("load", binding.reconcile, true);
    engine.addEventListener?.("streams", binding.reconcile, true);
    scheduleReconcile(engine, binding);
    startReadyWatch(engine, binding);
    return binding;
  };

  const release = (engine) => {
    const binding = mediaBindings.get(engine);
    if (!binding) return;
    binding.disposed = true;
    binding.reconcileRevision += 1;
    stopReadyWatch(binding);
    engine.removeEventListener?.("load", binding.reconcile, true);
    engine.removeEventListener?.("streams", binding.reconcile, true);
    engine.setOutputMuted = null;
    mediaBindings.delete(engine);
  };

  const canRetarget = (engine, entity = "") => {
    const candidate = engine || getCurrentEngine?.() || null;
    const binding = mediaBindings.get(candidate);
    const targetEntity = String(entity || "").trim();
    return Boolean(
      targetEntity &&
        isManagedHaCameraStream(candidate) &&
        binding &&
        !binding.disposed &&
        binding.entity !== targetEntity,
    );
  };

  const configureManagedEngine = (
    engine,
    binding,
    { hass, stateObj, entity, plan, muted, styleText },
  ) => {
    stopReadyWatch(binding);
    binding.entity = entity;
    binding.plan = plan;
    binding.selectionMuted = muted === true;
    binding.outputMuted = muted === true;
    binding.hasCommittedFrame = false;
    binding.observedVideo = null;
    binding.readyVideo = null;
    engine.hass = hass;
    engine.controls = false;
    engine.fitMode = "contain";
    engine.style.cssText = styleText || HA_DIRECT_VISIBLE_STYLE;
    engine.streamType = "hls";
    engine.muted = binding.selectionMuted;
    engine.defaultMuted = binding.outputMuted;
    engine.stateObj = stateObj;
    applyOutputMute(engine, binding);
    scheduleReconcile(engine, binding);
    startReadyWatch(engine, binding);
  };

  const tryMount = async (slot, startup = null, options = {}) => {
    const entity = String(options.entity || "").trim();
    const hass = getHass();
    if (!entity) return false;
    const stateObj = hass?.states?.[entity];
    if (!stateObj) {
      if (options.commit !== false) {
        applyResolvedStreamUiState(resolveHaDirectMountUnavailableState());
      }
      return false;
    }

    const plan = buildHaDirectMountPlan({
      startup: startup || {},
      preferredStreamType: getPreferredStreamType(),
    });
    const muted = options.muted ?? getStreamMuted();
    const currentEngine = getCurrentEngine?.() || null;
    if (options.commit !== false && canRetarget(currentEngine, entity)) {
      const binding = mediaBindings.get(currentEngine);
      configureManagedEngine(currentEngine, binding, {
        hass,
        stateObj,
        entity,
        plan,
        muted,
        styleText: options.styleText,
      });
      if (currentEngine.parentElement !== slot) {
        slot.innerHTML = "";
        slot.appendChild(currentEngine);
      }
      assignCommittedEngine(currentEngine, { retainPrevious: true });
      if (getRotateOverlayActive()) setLiveNativeControls(true);
      return { ok: true, type: "hls", engine: currentEngine, slot };
    }

    const engine = createHaCameraStreamElement({
      hass,
      stateObj,
      muted,
      controls: false,
      defaultMuted: muted,
      fitMode: "contain",
      styleText: options.styleText || HA_DIRECT_VISIBLE_STYLE,
    });
    if (!engine) return false;
    engine.type = "ha_direct";
    engine.streamType = "hls";

    slot.innerHTML = "";
    slot.appendChild(engine);
    if (options.commit === false) {
      return { ok: true, type: "hls", engine, slot };
    }

    assignCommittedEngine(engine);
    bindManagedMedia(engine, { entity, plan, muted });
    if (getRotateOverlayActive()) setLiveNativeControls(true);
    return { ok: true, type: "hls", engine, slot };
  };

  return {
    adoptRetainedWebRtcEngine: () => false,
    canRetarget,
    detachWebRtcForHandoff: () => false,
    isManagedEngine: isManagedHaCameraStream,
    release,
    tryMount,
  };
}
