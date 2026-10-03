import {
  buildHaCameraStreamState,
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

const HA_DIRECT_PROVIDER_STYLE =
  "width:100%;height:100%;display:block;background:var(--c-bg-deep)";
const HA_DIRECT_PROVIDER_SLOT_STYLE =
  "position:absolute;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none;opacity:0;z-index:0";

const normalizeEntity = (entity) => String(entity || "").trim();

const resolveProviderStreamType = (provider) => {
  const tagName =
    findActiveHaCameraStreamPlayer(provider)?.tagName?.toLowerCase?.() || "";
  if (tagName === "ha-web-rtc-player") return "webrtc";
  if (tagName === "ha-hls-player" || tagName === "video") return "hls";
  return "";
};

export function createHaDirectProviderMounter({
  getHass,
  getStreamMuted,
  getRotateOverlayActive,
  isCurrentEngine,
  assignCommittedEngine,
  onCommittedMediaReady,
  onCommittedStream,
  applyResolvedStreamUiState,
  startLoadingFallbackRefresh,
  stopLoadingFallbackRefresh,
  setLiveNativeControls,
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
  const ownerToken = {};
  const bindings = new WeakMap();
  const providerSlots = new WeakMap();
  const ownedProviders = new Set();
  const settledEntities = new Set();
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
    stopFallbackRefresh(binding);
    provider.removeEventListener?.("load", binding.onLoad, true);
    provider.removeEventListener?.("streams", binding.onStreams, true);
    bindings.delete(provider);
    return true;
  };

  const release = (provider) => {
    if (provider?.haDirectProvider !== true) return;
    disposeBinding(provider);
    ownedProviders.delete(provider);
    const providerSlot = providerSlots.get(provider);
    providerSlots.delete(provider);
    if (provider?.haDirectProviderOwner !== ownerToken) return;
    provider.haDirectProviderMetadataCleanup?.();
    delete provider.haDirectProviderMetadataCleanup;
    delete provider.haDirectProviderSlot;
    delete provider.haDirectProviderOwner;
    try {
      providerSlot?.remove?.();
    } catch (_) {}
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

  const createProvider = ({ entity, muted = true }) => {
    const hass = getHass?.();
    const targetEntity = normalizeEntity(entity);
    const stateObj = buildHaCameraStreamState(hass, targetEntity);
    if (!targetEntity || !stateObj) return null;
    const providerSlot = createProviderSlot(targetEntity);
    if (!providerSlot) return null;
    let provider = null;
    try {
      provider = createCameraStream({
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
    provider.streamType = "";
    provider.haDirectEntity = targetEntity;
    provider.haDirectProvider = true;
    provider.haDirectProviderOwner = ownerToken;
    provider.haDirectProviderSlot = providerSlot;
    const onProviderLoad = () => {
      provider.haDirectProviderReady = true;
    };
    const onProviderStreams = (event) => {
      if (event?.detail?.hasVideo === false) {
        provider.haDirectProviderReady = false;
      }
    };
    provider.addEventListener?.("load", onProviderLoad, true);
    provider.addEventListener?.("streams", onProviderStreams, true);
    provider.haDirectProviderMetadataCleanup = () => {
      provider.removeEventListener?.("load", onProviderLoad, true);
      provider.removeEventListener?.("streams", onProviderStreams, true);
    };
    providerSlot.appendChild(provider);
    providerSlots.set(provider, providerSlot);
    ownedProviders.add(provider);
    return provider;
  };

  const markSettled = (provider) => {
    const entity = normalizeEntity(provider?.haDirectEntity);
    if (entity) settledEntities.add(entity);
  };

  const applyReady = (provider) => {
    const binding = bindings.get(provider);
    if (
      binding?.disposed ||
      !isCurrentEngine?.(provider) ||
      !isSelectedEntity(provider?.haDirectEntity)
    ) {
      return false;
    }
    stopFallbackRefresh(binding);
    stopLoadingFallbackRefresh?.();
    markSettled(provider);
    provider.haDirectProviderReady = true;
    const streamType = resolveProviderStreamType(provider);
    const video = findActiveHaCameraStreamVideo(provider);
    if (streamType) provider.streamType = streamType;
    if (video) onCommittedMediaReady?.(provider, video);
    onCommittedStream?.(provider.streamType || "hls");
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

  const applyFailed = (provider) => {
    const binding = bindings.get(provider);
    if (
      binding?.disposed ||
      !isCurrentEngine?.(provider) ||
      !isSelectedEntity(provider?.haDirectEntity)
    ) {
      return false;
    }
    stopFallbackRefresh(binding);
    stopLoadingFallbackRefresh?.();
    markSettled(provider);
    provider.haDirectProviderReady = false;
    onCommittedStream?.("snapshot");
    applyResolvedStreamUiState?.(resolveHaDirectFailedState());
    schedulePreloadDeckAfterPaint();
    return true;
  };

  const bindProvider = (provider) => {
    const existing = bindings.get(provider);
    if (existing && !existing.disposed) return existing;
    const binding = {
      disposed: false,
      stopLoadingFallbackRefresh: () => {},
      onLoad: () => applyReady(provider),
      onStreams: (event) => {
        if (event?.detail?.hasVideo === false) applyFailed(provider);
      },
    };
    bindings.set(provider, binding);
    provider.addEventListener?.("load", binding.onLoad, true);
    provider.addEventListener?.("streams", binding.onStreams, true);
    return binding;
  };

  const isRetainableProvider = (provider) =>
    Boolean(
      provider?.type === "ha_direct" &&
        provider?.haDirectProvider === true &&
        provider?.haDirectProviderSlot,
    );

  const moveProviderSlot = (provider) => {
    if (provider?.haDirectProvider !== true) return false;
    const providerSlot = provider.haDirectProviderSlot;
    const host = getPreloadHost?.();
    if (!providerSlot || !host) return false;
    if (providerSlot.parentElement !== host && providerSlot.parentNode !== host) {
      if (typeof host.moveBefore !== "function") return false;
      try {
        host.moveBefore(providerSlot, null);
      } catch (_) {
        return false;
      }
    }
    provider.haDirectProviderOwner = ownerToken;
    providerSlots.set(provider, providerSlot);
    ownedProviders.add(provider);
    const stateObj = getHass?.()?.states?.[provider.haDirectEntity];
    if (stateObj && provider.stateObj !== stateObj) provider.stateObj = stateObj;
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

  const adoptRetainedProvider = (_slot, provider) => {
    if (
      !moveProviderSlot(provider) ||
      !isSelectedEntity(provider?.haDirectEntity) ||
      !setProviderVisible(provider, true)
    ) {
      return false;
    }
    assignCommittedEngine?.(provider);
    const binding = bindProvider(provider);
    binding.stopLoadingFallbackRefresh =
      startLoadingFallbackRefresh?.() || (() => {});
    if (getRotateOverlayActive?.()) setLiveNativeControls?.(true);
    if (provider.haDirectProviderReady === true) applyReady(provider);
    else if (provider.haDirectProviderReady === false) applyFailed(provider);
    return true;
  };

  const waitForProviderOutcome = (provider, abortSignal) =>
    new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        provider.removeEventListener?.("load", onLoad, true);
        provider.removeEventListener?.("streams", onStreams, true);
        abortSignal?.removeEventListener?.("abort", onAbort);
        resolve(value);
      };
      const onLoad = () => finish(true);
      const onStreams = (event) => {
        if (event?.detail?.hasVideo === false) finish(false);
      };
      const onAbort = () => finish(null);
      provider.addEventListener?.("load", onLoad, true);
      provider.addEventListener?.("streams", onStreams, true);
      abortSignal?.addEventListener?.("abort", onAbort, { once: true });
      if (provider.haDirectProviderReady === true) finish(true);
      else if (provider.haDirectProviderReady === false) finish(false);
      else if (abortSignal?.aborted) finish(null);
    });

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

  const syncProviderStates = () => {
    const hass = getHass?.();
    for (const provider of ownedProviders) {
      const stateObj = hass?.states?.[provider?.haDirectEntity];
      if (stateObj && provider.stateObj !== stateObj) {
        provider.stateObj = stateObj;
      }
    }
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
    const provider = createProvider({ entity: targetEntity, muted: true });
    if (!provider) return false;
    const abortController = new AbortController();
    const pending = {
      abortController,
      entity: targetEntity,
      promoted: false,
      provider,
    };
    pendingPreload = pending;
    const outcome = await waitForProviderOutcome(
      provider,
      abortController.signal,
    );
    if (pendingPreload === pending) pendingPreload = null;
    if (pending.promoted) return true;
    const stillConfigured = (getPreloadEntities?.() || []).includes(targetEntity);
    if (
      outcome == null ||
      generation !== preloadGeneration ||
      shouldPreload?.() !== true ||
      !stillConfigured
    ) {
      release(provider);
      return false;
    }
    markSettled(provider);
    provider.haDirectProviderReady = outcome === true;
    provider.streamType = resolveProviderStreamType(provider);
    if (retainPreloadedEngine?.(targetEntity, provider) === true) return true;
    release(provider);
    return false;
  };

  const runPreloadDeck = async (generation) => {
    if (preloadRunning || generation !== preloadGeneration) return;
    const activeEntity = normalizeEntity(getActiveEntity?.());
    if (!activeEntity || !settledEntities.has(activeEntity)) return;
    preloadRunning = true;
    try {
      const entities = [...new Set(getPreloadEntities?.() || [])];
      syncRetainedEntities?.(entities);
      for (const entity of entities) {
        if (generation !== preloadGeneration || shouldPreload?.() !== true) {
          break;
        }
        if (
          entity === activeEntity ||
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
    const activeEntity = normalizeEntity(getActiveEntity?.());
    if (
      shouldPreload?.() !== true ||
      !activeEntity ||
      !settledEntities.has(activeEntity)
    ) {
      return;
    }
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

  const tryMount = async (_slot, _startup = null, options = {}) => {
    const entity = normalizeEntity(options.entity);
    const commit = options.commit !== false;
    const mountToken = options.mountToken;
    const hass = getHass?.();
    if (!entity) return false;
    if (!hass?.states?.[entity]) {
      if (commit) {
        applyResolvedStreamUiState?.(resolveHaDirectMountUnavailableState());
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
    const provider = pendingForEntity
      ? cancelPendingPreload({ preserveProvider: true })
      : createProvider({
          entity,
          muted: options.muted ?? getStreamMuted?.(),
        });
    if (!pendingForEntity && commit) cancelPendingPreload();
    if (!provider) {
      if (commit) applyResolvedStreamUiState?.(resolveHaDirectFailedState());
      return false;
    }
    if (!commit) {
      return {
        ok: true,
        type: "ha",
        engine: provider,
        slot: provider.haDirectProviderSlot,
      };
    }
    if (!isOwnedMountAttempt(entity, mountToken)) {
      release(provider);
      return false;
    }

    setProviderVisible(provider, true);
    assignCommittedEngine?.(provider);
    const binding = bindProvider(provider);
    binding.stopLoadingFallbackRefresh =
      startLoadingFallbackRefresh?.() || (() => {});
    if (getRotateOverlayActive?.()) setLiveNativeControls?.(true);
    return {
      ok: true,
      type: provider.streamType || "ha",
      engine: provider,
      slot: provider.haDirectProviderSlot,
      startupReady: Promise.resolve(true),
    };
  };

  return {
    adoptRetainedProvider,
    adoptTransferredProvider: moveProviderSlot,
    cancelPreloads,
    detachProviderForHandoff,
    isRetainableProvider,
    prepare,
    release,
    schedulePreloadDeckAfterPaint,
    syncProviderStates,
    suspendRetainedProvider,
    tryMount,
  };
}
