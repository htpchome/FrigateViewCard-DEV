import {
  createHaCameraStreamElement,
  findActiveHaCameraStreamPlayer,
  findActiveHaCameraStreamVideo,
} from "../../integrations/home-assistant/playback.js";
import {
  buildHaDirectMountPlan,
  resolveHaDirectFailedState,
  resolveHaDirectMountUnavailableState,
  resolveHaDirectReadyState,
} from "./startup-policy.js";

const HA_DIRECT_VISIBLE_STYLE =
  "width:100%;height:100%;display:block;background:var(--c-bg-deep)";

const normalizeHaDirectStreamType = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_");
  return normalized === "hls" ? "hls" : "webrtc";
};

const isManagedHaCameraStream = (engine) =>
  engine?.tagName?.toLowerCase?.() === "ha-camera-stream";

const resolveManagedStreamType = (engine, fallback = "webrtc") => {
  const playerTag = findActiveHaCameraStreamPlayer(engine)
    ?.tagName?.toLowerCase?.();
  if (playerTag === "ha-hls-player") return "hls";
  if (playerTag === "ha-web-rtc-player") return "webrtc";
  return normalizeHaDirectStreamType(engine?.streamType || fallback);
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
}) {
  const mediaBindings = new WeakMap();

  const applyReady = (engine, fallbackType = "webrtc") => {
    if (!isCurrentEngine(engine)) return;
    const streamType = resolveManagedStreamType(engine, fallbackType);
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

  const bindManagedMedia = (engine, fallbackType) => {
    const binding = {
      disposed: false,
      revision: 0,
      abortController: new AbortController(),
      reconcile: null,
    };

    binding.reconcile = () => {
      const revision = ++binding.revision;
      void (async () => {
        try {
          await engine.updateComplete;
        } catch (_) {}
        if (
          binding.disposed ||
          revision !== binding.revision ||
          !isCurrentEngine(engine)
        ) {
          return;
        }
        const video = findActiveHaCameraStreamVideo(engine);
        if (!video) return;
        onCommittedMediaReady?.(engine, video);
        const hasFrame =
          Number(video.readyState || 0) >= 2 &&
          Number(video.videoWidth || 0) > 0;
        if (hasFrame) applyReady(engine, fallbackType);
      })();
    };

    mediaBindings.set(engine, binding);
    engine.addEventListener?.("load", binding.reconcile, true);
    engine.addEventListener?.("streams", binding.reconcile, true);
    binding.reconcile();
    return binding;
  };

  const release = (engine) => {
    const binding = mediaBindings.get(engine);
    if (!binding) return;
    binding.disposed = true;
    binding.revision += 1;
    binding.abortController.abort();
    engine.removeEventListener?.("load", binding.reconcile, true);
    engine.removeEventListener?.("streams", binding.reconcile, true);
    mediaBindings.delete(engine);
  };

  const detachWebRtcForHandoff = (engine) => {
    if (!isManagedHaCameraStream(engine)) return false;
    release(engine);
    return true;
  };

  const adoptRetainedWebRtcEngine = (engine) => {
    if (!isManagedHaCameraStream(engine)) return false;
    engine.muted = getStreamMuted();
    engine.defaultMuted = getStreamMuted();
    engine.controls = false;
    engine.style.cssText = HA_DIRECT_VISIBLE_STYLE;
    if (!mediaBindings.has(engine)) {
      bindManagedMedia(engine, engine.streamType || getPreferredStreamType());
    }
    return true;
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
    const initialStreamType = normalizeHaDirectStreamType(plan.streamType);
    const engine = createHaCameraStreamElement({
      hass,
      stateObj,
      muted: options.muted ?? getStreamMuted(),
      controls: false,
      allowExoPlayer: true,
      defaultMuted: options.defaultMuted,
      fitMode: "contain",
      styleText: options.styleText || HA_DIRECT_VISIBLE_STYLE,
    });
    if (!engine) return false;
    engine.type = "ha_direct";
    engine.streamType = initialStreamType;

    slot.innerHTML = "";
    slot.appendChild(engine);
    if (options.commit === false) {
      return { ok: true, type: initialStreamType, engine, slot };
    }

    assignCommittedEngine(engine);
    const binding = bindManagedMedia(engine, initialStreamType);
    if (getRotateOverlayActive()) setLiveNativeControls(true);

    void (async () => {
      const ready = await waitForStreamStart(engine, plan.waitMs, {
        ...plan.waitOptions,
        abortSignal: binding.abortController.signal,
        resolveVideo: () => findActiveHaCameraStreamVideo(engine),
        onVideoReady: (video) => onCommittedMediaReady?.(engine, video),
      });
      if (binding.disposed || !isCurrentEngine(engine)) return;
      if (ready) applyReady(engine, initialStreamType);
      else applyFailed(engine);
    })();

    return { ok: true, type: initialStreamType, engine, slot };
  };

  return {
    adoptRetainedWebRtcEngine,
    detachWebRtcForHandoff,
    release,
    tryMount,
  };
}
