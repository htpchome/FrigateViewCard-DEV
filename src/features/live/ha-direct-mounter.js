import {
  createHaCameraStreamElement,
  ensureHaCameraPlaybackElements,
  findActiveHaCameraStreamPlayer,
  findActiveHaCameraStreamVideo,
} from "../../integrations/home-assistant/playback.js";
import {
  resolveHaDirectFailedState,
  resolveHaDirectMountUnavailableState,
  resolveHaDirectReadyState,
} from "./startup-policy.js";

const HA_DIRECT_DECK_STYLE =
  "position:absolute;inset:0;width:100%;height:100%;overflow:hidden;background:var(--c-bg-deep)";
const HA_DIRECT_ACTIVE_STREAM_STYLE =
  "position:absolute;inset:0;z-index:2;width:100%;height:100%;display:block;transform:translateX(0);pointer-events:auto;background:var(--c-bg-deep)";
const HA_DIRECT_RETAINED_STREAM_STYLE =
  "position:absolute;inset:0;z-index:1;width:100%;height:100%;display:block;transform:translateX(-200%);pointer-events:none;background:var(--c-bg-deep)";
const HA_DIRECT_READY_TIMEOUT_MS = 9000;

const resolvePlayerStreamType = (player) =>
  player?.tagName?.toLowerCase?.() === "ha-web-rtc-player"
    ? "webrtc"
    : "hls";

const setMediaMuted = (media, muted) => {
  if (!media) return;
  if ("muted" in media) media.muted = muted;
  if ("defaultMuted" in media) media.defaultMuted = muted;
  if (!muted) {
    if (typeof media.volume === "number") media.volume = 1;
    media.play?.().catch?.(() => {});
  }
};

/**
 * Mount Home Assistant's own camera-stream pipeline and retain each visited
 * camera while this live view remains mounted. This mirrors HA/ACC ownership:
 * HA presents HLS immediately, negotiates WebRTC in parallel, and promotes it
 * without FrigateViewCard racing or replacing either transport.
 */
export function createHaDirectMounter({
  getHass,
  getStreamMuted,
  getRotateOverlayActive,
  isCurrentEngine,
  assignCommittedEngine,
  onCommittedMediaReady,
  onCommittedStream,
  applyResolvedStreamUiState,
  setLiveNativeControls,
  preparePlaybackElements = ensureHaCameraPlaybackElements,
}) {
  const providers = new Map();
  let engine = null;
  let activeBinding = null;

  const prepare = () => {
    try {
      return preparePlaybackElements?.() ?? false;
    } catch (_) {
      return false;
    }
  };

  const syncBindingOutputMute = (binding) => {
    if (!binding || binding.disposed) return;
    const players = Array.from(
      binding.stream.shadowRoot?.querySelectorAll?.(
        "ha-hls-player,ha-web-rtc-player",
      ) || [],
    );
    for (const player of players) {
      setMediaMuted(player, binding.outputMuted);
      const video =
        player.shadowRoot?.querySelector?.("video") ||
        player.querySelector?.("video") ||
        null;
      setMediaMuted(video, binding.outputMuted);
    }
  };

  const scheduleBindingSync = (binding) => {
    const revision = ++binding.syncRevision;
    void (async () => {
      try {
        await binding.stream.updateComplete;
      } catch (_) {}
      if (binding.disposed || revision !== binding.syncRevision) return;
      syncBindingOutputMute(binding);
      globalThis.requestAnimationFrame?.(() => {
        if (!binding.disposed && revision === binding.syncRevision) {
          syncBindingOutputMute(binding);
        }
      });
    })();
  };

  const isActive = (binding) =>
    !binding.disposed &&
    binding === activeBinding &&
    binding.engine === engine &&
    isCurrentEngine(binding.engine);

  const applyReady = (binding) => {
    if (!isActive(binding)) return;
    const player = findActiveHaCameraStreamPlayer(binding.stream);
    const video = findActiveHaCameraStreamVideo(binding.stream);
    if (!video || Number(video.readyState) < 2) return;

    binding.ready = true;
    if (binding.readyTimer) clearTimeout(binding.readyTimer);
    binding.readyTimer = null;
    binding.video = video;
    binding.engine.streamType = resolvePlayerStreamType(player);
    onCommittedMediaReady?.(binding.engine, video);
    onCommittedStream?.(binding.engine.streamType);
    applyResolvedStreamUiState?.(
      resolveHaDirectReadyState({
        rotateOverlayActive: getRotateOverlayActive?.() === true,
        isCurrentEngine: true,
        waitSucceeded: true,
      }),
    );
    if (getRotateOverlayActive?.()) setLiveNativeControls?.(true);
  };

  const applyFailed = (binding) => {
    if (!isActive(binding)) return;
    onCommittedStream?.("snapshot");
    applyResolvedStreamUiState?.(resolveHaDirectFailedState());
  };

  const armReadyTimeout = (binding) => {
    if (binding.readyTimer) clearTimeout(binding.readyTimer);
    const activationRevision = binding.activationRevision;
    binding.readyTimer = globalThis.setTimeout(() => {
      binding.readyTimer = null;
      if (
        binding.activationRevision !== activationRevision ||
        !isActive(binding)
      ) {
        return;
      }
      applyReady(binding);
      if (!binding.ready) applyFailed(binding);
    }, HA_DIRECT_READY_TIMEOUT_MS);
    binding.readyTimer?.unref?.();
  };

  const reconcile = (binding) => {
    if (binding.disposed) return;
    const revision = ++binding.reconcileRevision;
    void (async () => {
      try {
        await binding.stream.updateComplete;
      } catch (_) {}
      if (binding.disposed || revision !== binding.reconcileRevision) return;

      syncBindingOutputMute(binding);
      if (!isActive(binding)) return;
      const player = findActiveHaCameraStreamPlayer(binding.stream);
      const video = findActiveHaCameraStreamVideo(binding.stream);
      binding.engine.streamType = resolvePlayerStreamType(player);

      if (binding.video && binding.video !== video) {
        binding.video.removeEventListener?.("loadeddata", binding.onLoadedData);
      }
      binding.video = video;
      video?.addEventListener?.("loadeddata", binding.onLoadedData, {
        once: true,
      });
      if (video) onCommittedMediaReady?.(binding.engine, video);
      applyReady(binding);
    })();
  };

  const applyOutputMuted = (muted) => {
    const binding = activeBinding;
    if (!binding || binding.disposed) return;
    binding.outputMuted = Boolean(muted);

    // HA uses the outer muted property to choose its transport. Once audio has
    // been requested, keep that selection latched and mute only the leaf
    // player so a later mute cannot downgrade/restart the stream.
    if (!binding.outputMuted && binding.selectionMuted) {
      binding.selectionMuted = false;
      binding.stream.muted = false;
    }
    syncBindingOutputMute(binding);
    scheduleBindingSync(binding);
  };
  const destroyBinding = (binding) => {
    if (!binding || binding.disposed) return;
    binding.disposed = true;
    binding.reconcileRevision += 1;
    binding.syncRevision += 1;
    if (binding.readyTimer) clearTimeout(binding.readyTimer);
    binding.readyTimer = null;
    binding.video?.removeEventListener?.("loadeddata", binding.onLoadedData);
    binding.stream.removeEventListener?.("load", binding.onPlaybackChange, true);
    binding.stream.removeEventListener?.(
      "streams",
      binding.onPlaybackChange,
      true,
    );
    binding.stream.removeEventListener?.("error", binding.onPlaybackError, true);
    binding.stream.remove?.();
  };

  const createBinding = (entity, hass, muted) => {
    const stream = createHaCameraStreamElement({
      hass,
      stateObj: hass.states[entity],
      muted,
      controls: false,
      defaultMuted: muted,
      fitMode: "contain",
      styleText: HA_DIRECT_RETAINED_STREAM_STYLE,
    });
    if (!stream) return null;

    const binding = {
      entity,
      engine,
      stream,
      video: null,
      ready: false,
      readyTimer: null,
      disposed: false,
      activationRevision: 0,
      selectionMuted: Boolean(muted),
      outputMuted: Boolean(muted),
      reconcileRevision: 0,
      syncRevision: 0,
      onLoadedData: null,
      onPlaybackChange: null,
      onPlaybackError: null,
    };
    binding.onLoadedData = () => {
      syncBindingOutputMute(binding);
      applyReady(binding);
    };
    binding.onPlaybackChange = () => reconcile(binding);
    binding.onPlaybackError = () => {
      reconcile(binding);
      globalThis.queueMicrotask?.(() => {
        if (!isActive(binding)) return;
        applyReady(binding);
        if (!binding.ready) applyFailed(binding);
      });
    };
    stream.addEventListener?.("load", binding.onPlaybackChange, true);
    stream.addEventListener?.("streams", binding.onPlaybackChange, true);
    stream.addEventListener?.("error", binding.onPlaybackError, true);
    providers.set(entity, binding);
    binding.engine.appendChild(stream);
    reconcile(binding);
    return binding;
  };

  const activateBinding = (binding, hass, muted) => {
    for (const candidate of providers.values()) {
      const active = candidate === binding;
      if (!active) {
        if (candidate.readyTimer) clearTimeout(candidate.readyTimer);
        candidate.readyTimer = null;
        candidate.outputMuted = true;
        syncBindingOutputMute(candidate);
      }
      candidate.stream.style.cssText = active
        ? HA_DIRECT_ACTIVE_STREAM_STYLE
        : HA_DIRECT_RETAINED_STREAM_STYLE;
      candidate.stream.toggleAttribute?.("aria-hidden", !active);
    }
    activeBinding = binding;
    binding.activationRevision += 1;
    binding.ready = false;
    binding.stream.hass = hass;
    binding.stream.stateObj = hass.states[binding.entity];
    binding.engine.entity = binding.entity;
    binding.engine.streamType = resolvePlayerStreamType(
      findActiveHaCameraStreamPlayer(binding.stream),
    );
    applyOutputMuted(muted);
    armReadyTimeout(binding);
    reconcile(binding);
  };

  const createEngine = () => {
    const nextEngine = document.createElement("div");
    nextEngine.type = "ha_direct";
    nextEngine.streamType = "hls";
    nextEngine.entity = "";
    nextEngine.fvcManagedHaDirect = true;
    nextEngine.style.cssText = HA_DIRECT_DECK_STYLE;
    nextEngine.setAttribute?.("data-fvc-ha-direct-deck", "");
    Object.defineProperty(nextEngine, "video", {
      configurable: true,
      get: () =>
        engine === nextEngine && activeBinding
          ? findActiveHaCameraStreamVideo(activeBinding.stream)
          : null,
    });
    nextEngine.setOutputMuted = (muted) => {
      if (engine === nextEngine) applyOutputMuted(muted);
    };
    nextEngine.markStarted = () => {};
    nextEngine.activateRecovery = () => {};
    nextEngine.deactivateRecovery = () => {};
    nextEngine.destroy = () => release(nextEngine);
    engine = nextEngine;
    return nextEngine;
  };

  const releaseAll = (candidate = engine) => {
    if (!candidate || candidate !== engine) return;
    for (const binding of providers.values()) destroyBinding(binding);
    providers.clear();
    activeBinding = null;
    candidate.remove?.();
    engine = null;
  };

  const release = (candidate) => {
    if (candidate === engine) {
      releaseAll(candidate);
      return;
    }
    if (
      candidate?.type === "ha_direct" &&
      candidate?.streamType === "webrtc"
    ) {
      void candidate.destroy?.();
    }
  };

  const retainMountedEngine = (candidate) => {
    if (candidate !== engine || engine?.isConnected === false) return false;
    applyOutputMuted(true);
    return true;
  };

  const hasRetainedMount = (slot) =>
    Boolean(engine && engine.parentElement === slot);

  const tryMount = async (slot, _startup = null, options = {}) => {
    const playbackPreparation = prepare();
    if (playbackPreparation?.then) await playbackPreparation;

    const entity = String(options.entity || "").trim();
    const hass = getHass?.();
    const commit = options.commit !== false;
    if (!entity || !hass?.states?.[entity]) {
      if (commit) {
        applyResolvedStreamUiState?.(resolveHaDirectMountUnavailableState());
      }
      return false;
    }
    const currentEngine = engine || createEngine();

    if (currentEngine.parentElement !== slot) {
      slot.innerHTML = "";
      slot.appendChild(currentEngine);
    }
    const muted = options.muted ?? getStreamMuted?.() ?? true;
    const binding =
      providers.get(entity) || createBinding(entity, hass, muted);
    if (!binding) {
      if (commit) applyResolvedStreamUiState?.(resolveHaDirectFailedState());
      return false;
    }

    activateBinding(binding, hass, muted);
    if (commit) assignCommittedEngine?.(currentEngine);
    reconcile(binding);
    return {
      ok: true,
      type: currentEngine.streamType,
      engine: currentEngine,
      slot,
    };
  };

  return {
    adoptRetainedWebRtcEngine: () => false,
    detachWebRtcForHandoff: () => false,
    hasRetainedMount,
    prepare,
    release,
    releaseAll,
    retainMountedEngine,
    tryMount,
  };
}
