import {
  buildHaCameraStreamState,
  createHaCameraStreamElement,
  ensureHaCameraPlaybackElements,
  findActiveHaCameraStreamPlayer,
  findActiveHaCameraStreamVideo,
  watchHaPlaybackFirstFrame,
} from "../../integrations/home-assistant/playback.js";
import {
  resolveHaDirectFailedState,
  resolveHaDirectMountUnavailableState,
  resolveHaDirectReadyState,
} from "./startup-policy.js";

const HA_DIRECT_PROVIDER_STYLE =
  "width:100%;height:100%;display:block;background:var(--c-bg-deep)";
const HA_DIRECT_PROVIDER_SLOT_STYLE =
  "position:absolute;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none;opacity:0;z-index:0";
const HA_DIRECT_PROVIDER_WAIT_MS = 8000;

const normalizeEntity = (entity) => String(entity || "").trim();

const normalizeRequestedStreamType = (streamType) =>
  String(streamType || "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_") === "hls"
    ? "hls"
    : "webrtc";

const toHaStreamType = (streamType) =>
  normalizeRequestedStreamType(streamType) === "hls" ? "hls" : "web_rtc";

const resolveProviderStreamType = (provider, fallback = "webrtc") => {
  const player = findActiveHaCameraStreamPlayer(provider);
  const tagName = player?.tagName?.toLowerCase?.() || "";
  if (tagName === "ha-hls-player" || tagName === "video") return "hls";
  if (tagName === "ha-web-rtc-player") return "webrtc";
  return normalizeRequestedStreamType(fallback);
};

export function createHaDirectProviderMounter({
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
  preparePlaybackElements = ensureHaCameraPlaybackElements,
  createCameraStream = createHaCameraStreamElement,
  getPreloadEntities = () => [],
  getActiveEntity = () => "",
  getSelectedEntity = () => "",
  isMountAttemptCurrent = () => true,
  getPreloadHost = () => null,
  shouldPreload = () => false,
  hasRetainedEngine = () => false,
  retainPreloadedEngine = () => false,
  adoptEditorPreloadedEngine = () => false,
  syncRetainedEntities = () => {},
  requestFrame = (callback) => globalThis.requestAnimationFrame?.(callback),
  cancelFrame = (frame) => globalThis.cancelAnimationFrame?.(frame),
}) {
  const bindings = new WeakMap();
  const providerSlots = new WeakMap();
  const ownedProviders = new Set();
  let preloadGeneration = 0;
  let preloadRunning = false;
  let preloadRescheduleRequested = false;
  let preloadFrame = null;
  let preloadPaintFrame = null;
  let pendingPreload = null;

  const prepare = () => {
    try {
      return preparePlaybackElements?.() ?? false;
    } catch (_) {
      return false;
    }
  };

  const isSelectedEntity = (entity) =>
    normalizeEntity(getSelectedEntity?.()) === normalizeEntity(entity);

  const isOwnedMountAttempt = (entity, mountToken) =>
    mountToken == null || isMountAttemptCurrent?.(mountToken, entity) === true;

  const stopFallbackRefresh = (binding) => {
    binding?.stopLoadingFallbackRefresh?.();
    if (binding) binding.stopLoadingFallbackRefresh = () => {};
  };

  const setProviderVisible = (provider, visible) => {
    const providerSlot = providerSlots.get(provider);
    if (!providerSlot) return false;
    providerSlot.style.opacity = visible ? "1" : "0";
    providerSlot.style.zIndex = visible ? "3" : "0";
    if (visible) providerSlot.removeAttribute?.("aria-hidden");
    else providerSlot.setAttribute?.("aria-hidden", "true");
    provider.muted = visible ? Boolean(getStreamMuted?.()) : true;
    provider.defaultMuted = provider.muted;
    return true;
  };

  const disposeBinding = (provider) => {
    const binding = bindings.get(provider);
    if (!binding) return false;
    binding.disposed = true;
    binding.abortController.abort();
    binding.cleanupRecovery?.();
    stopFallbackRefresh(binding);
    provider.removeEventListener?.("load", binding.onPlaybackChanged, true);
    provider.removeEventListener?.("streams", binding.onPlaybackChanged, true);
    bindings.delete(provider);
    return true;
  };

  const release = (provider) => {
    if (!provider?.haDirectProvider) return;
    disposeBinding(provider);
    ownedProviders.delete(provider);
    const providerSlot = providerSlots.get(provider);
    providerSlots.delete(provider);
    delete provider.haDirectProviderSlot;
    try {
      providerSlot?.remove?.();
    } catch (_) {}
    if (!providerSlot) {
      try {
        provider.remove?.();
      } catch (_) {}
    }
  };

  const createProviderSlot = (entity) => {
    const host = getPreloadHost?.();
    if (!host?.appendChild || !globalThis.document?.createElement) return null;
    const providerSlot = document.createElement("div");
    providerSlot.setAttribute?.("data-fvc-ha-direct-provider", entity);
    providerSlot.setAttribute?.("aria-hidden", "true");
    providerSlot.style.cssText = HA_DIRECT_PROVIDER_SLOT_STYLE;
    host.appendChild(providerSlot);
    return providerSlot;
  };

  const createProvider = ({ entity, requestedStreamType, muted = true }) => {
    const hass = getHass?.();
    const targetEntity = normalizeEntity(entity);
    if (!targetEntity || !hass?.states?.[targetEntity]) return null;
    const preferredStreamType = normalizeRequestedStreamType(
      requestedStreamType || getPreferredStreamType?.(),
    );
    const stateObj = buildHaCameraStreamState(
      hass,
      targetEntity,
      toHaStreamType(preferredStreamType),
      "web_rtc",
    );
    if (!stateObj) return null;
    const providerSlot = createProviderSlot(targetEntity);
    if (!providerSlot) return null;
    let provider = null;
    try {
      provider = createCameraStream({
        hass,
        stateObj,
        muted,
        defaultMuted: muted,
        controls: false,
        fitMode: "contain",
        styleText: HA_DIRECT_PROVIDER_STYLE,
      });
    } catch (_) {
      provider = null;
    }
    if (!provider) {
      providerSlot.remove?.();
      return null;
    }
    provider.type = "ha_direct";
    provider.streamType = preferredStreamType;
    provider.haDirectEntity = targetEntity;
    provider.haDirectProvider = true;
    provider.haDirectProviderSlot = providerSlot;
    providerSlot.appendChild(provider);
    providerSlots.set(provider, providerSlot);
    ownedProviders.add(provider);
    return provider;
  };

  const applyReady = (provider, video = null) => {
    const binding = bindings.get(provider);
    if (
      binding?.disposed ||
      !isCurrentEngine?.(provider) ||
      !isSelectedEntity(provider?.haDirectEntity)
    ) {
      return false;
    }
    binding.failed = false;
    binding.cleanupRecovery?.();
    binding.cleanupRecovery = () => {};
    stopFallbackRefresh(binding);
    stopLoadingFallbackRefresh?.();
    const readyVideo = video || findActiveHaCameraStreamVideo(provider);
    provider.streamType = resolveProviderStreamType(
      provider,
      provider.streamType,
    );
    if (readyVideo) onCommittedMediaReady?.(provider, readyVideo);
    onCommittedStream?.(provider.streamType);
    applyResolvedStreamUiState?.(
      resolveHaDirectReadyState({
        rotateOverlayActive: getRotateOverlayActive?.() === true,
        isCurrentEngine: true,
        waitSucceeded: true,
      }),
    );
    schedulePreloadDeckAfterPaint();
    return true;
  };

  const watchRecovery = (provider, binding) => {
    binding.cleanupRecovery?.();
    binding.cleanupRecovery = watchHaPlaybackFirstFrame({
      stream: provider,
      isDestroyed: () =>
        binding.disposed ||
        !isCurrentEngine?.(provider) ||
        !isSelectedEntity(provider?.haDirectEntity),
      onReady: () =>
        applyReady(provider, findActiveHaCameraStreamVideo(provider)),
    });
  };

  const applyFailed = (provider) => {
    const binding = bindings.get(provider);
    if (
      binding?.disposed ||
      !isCurrentEngine?.(provider) ||
      !isSelectedEntity(provider?.haDirectEntity)
    ) {
      return;
    }
    binding.failed = true;
    stopFallbackRefresh(binding);
    stopLoadingFallbackRefresh?.();
    onCommittedStream?.("snapshot");
    applyResolvedStreamUiState?.(resolveHaDirectFailedState());
    watchRecovery(provider, binding);
  };

  const bindProvider = (provider) => {
    const existing = bindings.get(provider);
    if (existing && !existing.disposed) return existing;
    const binding = {
      abortController: new AbortController(),
      cleanupRecovery: () => {},
      disposed: false,
      failed: false,
      stopLoadingFallbackRefresh: () => {},
      onPlaybackChanged: null,
    };
    binding.onPlaybackChanged = (event) => {
      if (event?.type === "streams" && event?.detail?.hasVideo === false) {
        applyFailed(provider);
        return;
      }
      watchRecovery(provider, binding);
    };
    bindings.set(provider, binding);
    provider.addEventListener?.("load", binding.onPlaybackChanged, true);
    provider.addEventListener?.("streams", binding.onPlaybackChanged, true);
    return binding;
  };

  const isRetainableProvider = (provider) => {
    if (
      provider?.type !== "ha_direct" ||
      provider?.haDirectProvider !== true ||
      !providerSlots.has(provider)
    ) {
      return false;
    }
    const video = findActiveHaCameraStreamVideo(provider);
    return Boolean(
      video &&
        video.ended !== true &&
        !video.error &&
        Number(video.readyState) >= 2 &&
        Number(video.videoWidth) > 0,
    );
  };

  const registerTransferredProvider = (provider) => {
    if (provider?.haDirectProvider !== true) return false;
    const providerSlot = provider.haDirectProviderSlot;
    const host = getPreloadHost?.();
    if (!providerSlot || !host?.appendChild) return false;
    if (providerSlot.parentElement !== host) {
      try {
        if (typeof host.moveBefore === "function") {
          host.moveBefore(providerSlot, null);
        } else {
          host.appendChild(providerSlot);
        }
      } catch (_) {
        return false;
      }
    }
    providerSlots.set(provider, providerSlot);
    ownedProviders.add(provider);
    return true;
  };

  const detachProviderForHandoff = (provider) => {
    if (!isRetainableProvider(provider)) return false;
    disposeBinding(provider);
    ownedProviders.delete(provider);
    providerSlots.delete(provider);
    return true;
  };

  const suspendRetainedProvider = (provider) => {
    if (!isRetainableProvider(provider)) return false;
    disposeBinding(provider);
    return setProviderVisible(provider, false);
  };

  const adoptRetainedProvider = (slot, provider) => {
    if (
      !slot ||
      !registerTransferredProvider(provider) ||
      !isRetainableProvider(provider) ||
      !isSelectedEntity(provider?.haDirectEntity)
    ) {
      return false;
    }
    slot.innerHTML = "";
    if (!setProviderVisible(provider, true)) return false;
    assignCommittedEngine?.(provider);
    const binding = bindProvider(provider);
    const video = findActiveHaCameraStreamVideo(provider);
    if (video) {
      video.muted = Boolean(getStreamMuted?.());
      video.defaultMuted = video.muted;
      void video.play?.().catch?.(() => {});
    }
    if (getRotateOverlayActive?.()) setLiveNativeControls?.(true);
    return applyReady(provider, video) && binding.disposed !== true;
  };

  const cancelScheduledPreload = () => {
    if (preloadFrame != null) cancelFrame?.(preloadFrame);
    if (preloadPaintFrame != null) cancelFrame?.(preloadPaintFrame);
    preloadFrame = null;
    preloadPaintFrame = null;
  };

  const cancelPendingPreload = ({ preserveProvider = false } = {}) => {
    const pending = pendingPreload;
    if (!pending) return null;
    pendingPreload = null;
    pending.promoted = preserveProvider;
    pending.abortController.abort();
    if (!preserveProvider) release(pending.provider);
    return preserveProvider ? pending.provider : null;
  };

  const cancelPreloads = () => {
    preloadGeneration += 1;
    preloadRescheduleRequested = false;
    cancelScheduledPreload();
    cancelPendingPreload();
  };

  const preloadEntity = async (entity, generation) => {
    const targetEntity = normalizeEntity(entity);
    if (
      !targetEntity ||
      generation !== preloadGeneration ||
      shouldPreload?.() !== true ||
      hasRetainedEngine?.(targetEntity) === true
    ) {
      return false;
    }
    if (adoptEditorPreloadedEngine?.(targetEntity) === true) return true;
    const provider = createProvider({
      entity: targetEntity,
      requestedStreamType: getPreferredStreamType?.(),
      muted: true,
    });
    if (!provider) return false;
    const abortController = new AbortController();
    const pending = {
      abortController,
      entity: targetEntity,
      promoted: false,
      provider,
    };
    pendingPreload = pending;
    let ready = false;
    try {
      ready = await waitForStreamStart?.(provider, HA_DIRECT_PROVIDER_WAIT_MS, {
        requireReadyState: 2,
        abortSignal: abortController.signal,
        resolveVideo: () => findActiveHaCameraStreamVideo(provider),
      });
    } catch (_) {
      ready = false;
    }
    if (pendingPreload === pending) pendingPreload = null;
    if (pending.promoted) return true;
    const stillConfigured = (getPreloadEntities?.() || []).includes(targetEntity);
    if (
      ready !== true ||
      generation !== preloadGeneration ||
      shouldPreload?.() !== true ||
      !stillConfigured
    ) {
      release(provider);
      return false;
    }
    provider.streamType = resolveProviderStreamType(
      provider,
      provider.streamType,
    );
    if (retainPreloadedEngine?.(targetEntity, provider) === true) return true;
    release(provider);
    return false;
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
          entity === normalizeEntity(getActiveEntity?.()) ||
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
    const entity = normalizeEntity(options.entity);
    const commit = options.commit !== false;
    const mountToken = options.mountToken;
    const hass = getHass?.();
    if (!entity) return false;
    if (!hass?.states?.[entity]) {
      if (commit) {
        applyResolvedStreamUiState?.(
          resolveHaDirectMountUnavailableState(),
        );
      }
      return false;
    }
    const prepared = prepare();
    if (prepared?.then) await prepared;
    if (commit && !isOwnedMountAttempt(entity, mountToken)) return false;

    const pendingForEntity = pendingPreload?.entity === entity;
    if (commit) {
      preloadGeneration += 1;
      cancelScheduledPreload();
    }
    const requestedStreamType = normalizeRequestedStreamType(
      startup?.streamType || getPreferredStreamType?.(),
    );
    const provider = pendingForEntity
      ? cancelPendingPreload({ preserveProvider: true })
      : createProvider({
          entity,
          requestedStreamType,
          muted: options.muted ?? getStreamMuted?.(),
        });
    if (!pendingForEntity && commit) cancelPendingPreload();
    if (!provider) {
      if (commit) applyResolvedStreamUiState?.(resolveHaDirectFailedState());
      return false;
    }
    provider.streamType = requestedStreamType;
    if (!commit) {
      slot.innerHTML = "";
      slot.appendChild(provider);
      return { ok: true, type: requestedStreamType, engine: provider, slot };
    }
    if (!isOwnedMountAttempt(entity, mountToken)) {
      release(provider);
      return false;
    }

    slot.innerHTML = "";
    setProviderVisible(provider, true);
    assignCommittedEngine?.(provider);
    const binding = bindProvider(provider);
    binding.stopLoadingFallbackRefresh =
      startLoadingFallbackRefresh?.() || (() => {});
    if (getRotateOverlayActive?.()) setLiveNativeControls?.(true);

    const startupReady = (async () => {
      let ready = false;
      try {
        ready = await waitForStreamStart?.(
          provider,
          HA_DIRECT_PROVIDER_WAIT_MS,
          {
            requireReadyState: 2,
            abortSignal: binding.abortController.signal,
            resolveVideo: () => findActiveHaCameraStreamVideo(provider),
          },
        );
      } catch (_) {
        ready = false;
      }
      if (
        binding.disposed ||
        !isCurrentEngine?.(provider) ||
        !isOwnedMountAttempt(entity, mountToken)
      ) {
        return false;
      }
      if (ready !== true) {
        applyFailed(provider);
        scheduleResumeLive?.("ha-camera-stream-failed");
        return false;
      }
      return applyReady(provider, findActiveHaCameraStreamVideo(provider));
    })();

    return {
      ok: true,
      type: requestedStreamType,
      engine: provider,
      slot,
      startupReady,
    };
  };

  return {
    adoptRetainedHlsEngine: adoptRetainedProvider,
    adoptRetainedWebRtcEngine: (provider) =>
      provider?.haDirectProvider === true &&
      registerTransferredProvider(provider),
    adoptTransferredProvider: registerTransferredProvider,
    cancelPreloads,
    detachProviderForHandoff,
    detachWebRtcForHandoff: (provider) =>
      provider?.haDirectProvider === true
        ? detachProviderForHandoff(provider)
        : false,
    isRetainableHlsEngine: isRetainableProvider,
    prepare,
    release,
    schedulePreloadDeckAfterPaint,
    suspendRetainedHlsEngine: suspendRetainedProvider,
    tryMount,
  };
}
