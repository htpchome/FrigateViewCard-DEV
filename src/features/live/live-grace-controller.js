import {
  createGraceEngineEntry,
  createGracePendingEntry,
  normalizeGraceEntityKey,
  prepareEngineVideoForGraceHost,
  prepareEngineVideoForLiveDeck,
} from "./grace-pool.js";
import { splitPendingDestroyersByGraceMse } from "./pending-destroyers.js";
import {
  buildVideoOptionsForView,
  configureVideoElement,
  mountNodeIntoSlot,
} from "../../shared/media/video-factory.js";

export function createLiveGraceController({
  graceMs,
  graceMax,
  haDirectRetainedMax = graceMax,
  catalystRetainedMax = graceMax,
  getShadowRoot,
  getScopeKey,
  getPendingMountDestroyers,
  setPendingMountDestroyers,
  getPendingWebRtcTakeoverTimer,
  setPendingWebRtcTakeoverTimer,
  clearRotateOverlayAudioSync,
  clearRotateVideoFullscreenStyle,
  getEngine,
  setEngine,
  getActiveStreamType,
  getStreamMuted,
  setEngineMountedMuted,
  getRotateOverlayActive,
  attachVideoFit,
  setActiveStreamType,
  setStreamLoading,
  setStreamFallbackVisible,
  setLiveNativeControls,
  releaseHaDirectEngine,
  adoptHaDirectWebRtcEngine,
  isHaDirectHlsEngineReusable,
  suspendHaDirectHlsEngine,
  adoptHaDirectHlsEngine,
  isCatalystHlsEngineReusable,
  suspendCatalystHlsEngine,
  adoptCatalystHlsEngine,
  releaseCatalystHlsEngine,
  scheduleResumeLive,
  resetMseDiagnostics,
  markMseChunk,
}) {
  const mseGracePool = new Map();
  const webRtcGracePool = new Map();
  const haDirectRetainedPool = new Map();
  const catalystHlsRetainedPool = new Map();
  const terminalWebRtcStates = new Set(["closed", "failed", "disconnected"]);
  let graceEntrySequence = 0;

  const isMseEngineReusable = (engine) => {
    if (!engine?.video || !engine?.ws) return false;
    const wsState = Number(engine.ws.readyState);
    return !Number.isFinite(wsState) || wsState <= 1;
  };
  const isWebRtcEngineReusable = (engine) => {
    if (!engine?.video || !engine?.pc || !engine?.ws) return false;
    const connectionState = String(engine.pc.connectionState || "")
      .trim()
      .toLowerCase();
    const iceState = String(engine.pc.iceConnectionState || "")
      .trim()
      .toLowerCase();
    const wsState = Number(engine.ws.readyState);
    const signalingClosedAfterConnect =
      engine.signalingComplete === true && wsState >= 2;
    return (
      !terminalWebRtcStates.has(connectionState) &&
      !terminalWebRtcStates.has(iceState) &&
      (!Number.isFinite(wsState) || wsState <= 1 || signalingClosedAfterConnect)
    );
  };
  const isHaDirectWebRtcEngineTransferable = (engine) => {
    if (
      engine?.type !== "ha_direct" ||
      engine?.streamType !== "webrtc" ||
      !engine?.video ||
      !engine?.pc
    ) {
      return false;
    }
    const connectionState = String(engine.pc.connectionState || "")
      .trim()
      .toLowerCase();
    const iceState = String(engine.pc.iceConnectionState || "")
      .trim()
      .toLowerCase();
    const peerConnected =
      connectionState === "connected" ||
      (!connectionState && ["connected", "completed"].includes(iceState));
    const iceConnected =
      !iceState || ["connected", "completed"].includes(iceState);
    return (
      peerConnected &&
      iceConnected &&
      engine.video.ended !== true &&
      engine.hasLiveVideoTrack?.() === true
    );
  };
  const isHaDirectWebRtcEngineReusable = (engine) => {
    if (!isHaDirectWebRtcEngineTransferable(engine)) return false;
    const video = engine.video;
    const playbackRate = Number(video.playbackRate);
    const hasUsableFrame =
      !video.paused &&
      !video.ended &&
      !video.seeking &&
      Number(video.readyState) >= 2 &&
      Number(video.videoWidth) > 0 &&
      (!Number.isFinite(playbackRate) || playbackRate > 0);
    const hasRecentMediaActivity =
      engine.hasRecentMediaActivity?.() === true;
    return hasUsableFrame && hasRecentMediaActivity;
  };
  const isHaDirectEngineReusable = (engine) =>
    engine?.streamType === "hls"
      ? isHaDirectHlsEngineReusable?.(engine) === true
      : isHaDirectWebRtcEngineReusable(engine);
  let mseGraceHost = null;
  let haDirectDeckHost = null;
  let catalystHlsDeckHost = null;

  const evictGraceMseEntry = (entity) => {
    const key = normalizeGraceEntityKey(entity);
    if (!key) return;
    const entry = mseGracePool.get(key);
    if (!entry) return;
    entry.cancelled = true;
    if (entry.timer) clearTimeout(entry.timer);
    mseGracePool.delete(key);
    try {
      entry.engine?.destroy?.();
    } catch (_) {}
  };

  const evictGraceWebRtcEntry = (entity) => {
    const key = normalizeGraceEntityKey(entity);
    if (!key) return;
    const entry = webRtcGracePool.get(key);
    if (!entry) return;
    entry.cancelled = true;
    if (entry.timer) clearTimeout(entry.timer);
    webRtcGracePool.delete(key);
    try {
      entry.engine?.destroy?.();
    } catch (_) {}
  };

  const evictGraceHaDirectEntry = (entity) => {
    const key = normalizeGraceEntityKey(entity);
    if (!key) return;
    const entry = haDirectRetainedPool.get(key);
    if (!entry) return;
    entry.cancelled = true;
    if (entry.timer) clearTimeout(entry.timer);
    haDirectRetainedPool.delete(key);
    try {
      releaseHaDirectEngine?.(entry.engine);
    } catch (_) {}
    const mediaNode = entry.engine?.video || entry.engine;
    try {
      mediaNode?.remove?.();
    } catch (_) {}
  };

  const evictRetainedCatalystHlsEntry = (entity) => {
    const key = normalizeGraceEntityKey(entity);
    if (!key) return;
    const entry = catalystHlsRetainedPool.get(key);
    if (!entry) return;
    entry.cancelled = true;
    if (entry.timer) clearTimeout(entry.timer);
    catalystHlsRetainedPool.delete(key);
    try {
      releaseCatalystHlsEngine?.(entry.engine);
    } catch (_) {}
    try {
      entry.engine?.remove?.();
    } catch (_) {}
  };

  const trimGracePool = () => {
    const maxEntries = Math.max(0, Number(graceMax) || 0);
    while (mseGracePool.size + webRtcGracePool.size > maxEntries) {
      const mseKey = mseGracePool.keys().next().value || "";
      const webRtcKey = webRtcGracePool.keys().next().value || "";
      const mseOrder = Number(mseGracePool.get(mseKey)?.graceOrder) || Infinity;
      const webRtcOrder =
        Number(webRtcGracePool.get(webRtcKey)?.graceOrder) || Infinity;
      if (mseOrder <= webRtcOrder) {
        if (!mseKey) break;
        evictGraceMseEntry(mseKey);
      } else {
        if (!webRtcKey) break;
        evictGraceWebRtcEntry(webRtcKey);
      }
    }
  };

  const trimHaDirectGracePool = () => {
    const maxEntries = Math.max(0, Number(haDirectRetainedMax) || 0);
    while (haDirectRetainedPool.size > maxEntries) {
      const oldestKey = haDirectRetainedPool.keys().next().value || "";
      if (!oldestKey) break;
      evictGraceHaDirectEntry(oldestKey);
    }
  };

  const trimCatalystHlsRetainedPool = () => {
    const maxEntries = Math.max(0, Number(catalystRetainedMax) || 0);
    while (catalystHlsRetainedPool.size > maxEntries) {
      const oldestKey = catalystHlsRetainedPool.keys().next().value || "";
      if (!oldestKey) break;
      evictRetainedCatalystHlsEntry(oldestKey);
    }
  };

  const ensureMseGraceHost = () => {
    if (mseGraceHost?.isConnected) return mseGraceHost;
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText =
      "position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;left:-9999px;top:-9999px";
    getShadowRoot?.()?.appendChild?.(host);
    mseGraceHost = host;
    return host;
  };
  const ensureHaDirectDeckHost = () => {
    if (haDirectDeckHost?.isConnected) return haDirectDeckHost;
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("data-fvc-ha-direct-deck", "");
    host.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none;z-index:2";
    const shadowRoot = getShadowRoot?.();
    const engine = shadowRoot?.querySelector?.("#engine") || null;
    const parent = engine?.parentElement || shadowRoot;
    if (engine && parent?.insertBefore) {
      parent.insertBefore(host, engine);
    } else {
      parent?.appendChild?.(host);
    }
    haDirectDeckHost = host;
    return host;
  };
  const ensureCatalystHlsDeckHost = () => {
    if (catalystHlsDeckHost?.isConnected) return catalystHlsDeckHost;
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("data-fvc-catalyst-hls-deck", "");
    host.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none;z-index:0;background:var(--c-bg-deep)";
    const shadowRoot = getShadowRoot?.();
    const engine = shadowRoot?.querySelector?.("#engine") || null;
    const parent = engine?.parentElement || shadowRoot;
    if (engine && parent?.insertBefore) {
      parent.insertBefore(host, engine);
    } else {
      parent?.appendChild?.(host);
    }
    catalystHlsDeckHost = host;
    return host;
  };
  const stashMseEngineForGrace = (entity, engine) => {
    const key = normalizeGraceEntityKey(entity);
    if (!key || !engine?.video || !engine?.ws) return false;
    evictGraceMseEntry(key);
    engine.deactivateRecovery?.();
    ensureMseGraceHost().appendChild(engine.video);
    prepareEngineVideoForGraceHost(engine.video);
    const entry = createGraceEngineEntry({
      engine,
      graceMs,
      onExpire: () => {
        if (mseGracePool.get(key) !== entry) return;
        evictGraceMseEntry(key);
      },
    });
    entry.graceOrder = ++graceEntrySequence;
    mseGracePool.set(key, entry);
    trimGracePool();
    return true;
  };
  const stashWebRtcEngineForGrace = (entity, engine) => {
    const key = normalizeGraceEntityKey(entity);
    if (!key || !isWebRtcEngineReusable(engine)) return false;
    evictGraceWebRtcEntry(key);
    engine.deactivateRecovery?.();
    ensureMseGraceHost().appendChild(engine.video);
    prepareEngineVideoForGraceHost(engine.video);
    const entry = createGraceEngineEntry({
      engine,
      graceMs,
      onExpire: () => {
        if (webRtcGracePool.get(key) !== entry) return;
        evictGraceWebRtcEntry(key);
      },
    });
    entry.graceOrder = ++graceEntrySequence;
    webRtcGracePool.set(key, entry);
    trimGracePool();
    return true;
  };
  const stashHaDirectEngineForGrace = (entity, engine, options = {}) => {
    const key = normalizeGraceEntityKey(entity);
    if (!key) return false;
    engine?.cancelPendingTakeover?.();
    const engineEntity = normalizeGraceEntityKey(engine?.haDirectEntity);
    if (engineEntity && engineEntity !== key) return false;
    if (engine && !engineEntity) engine.haDirectEntity = key;
    const reusableEngine =
      options.allowPlaybackResume === true && engine?.streamType === "webrtc"
        ? isHaDirectWebRtcEngineTransferable(engine)
        : isHaDirectEngineReusable(engine);
    if (!reusableEngine) return false;
    if (
      engine.streamType === "hls" &&
      suspendHaDirectHlsEngine?.(engine) !== true
    ) {
      return false;
    }
    const mediaNode = engine.video || null;
    if (engine.streamType !== "hls" && !mediaNode) return false;
    evictGraceHaDirectEntry(key);
    if (engine.streamType !== "hls") {
      engine.deactivateRecovery?.();
      ensureHaDirectDeckHost().appendChild(mediaNode);
      prepareEngineVideoForLiveDeck(mediaNode);
      // The HA Direct deck sits above the visible live slot so its HLS layers
      // can be revealed in place. Dormant WebRTC videos share that host, but
      // must not paint there or a later camera connection can cover the
      // selected camera.
      mediaNode.style.opacity = "0";
      mediaNode.style.zIndex = "0";
      mediaNode.setAttribute?.("aria-hidden", "true");
      if (options.allowPlaybackResume === true) {
        void mediaNode.play?.().catch?.(() => {});
      }
    }
    const entry = {
      engine,
      cancelled: false,
      timer: null,
    };
    entry.graceOrder = ++graceEntrySequence;
    haDirectRetainedPool.set(key, entry);
    trimHaDirectGracePool();
    return true;
  };
  const stashCatalystHlsEngineForRetention = (entity, engine) => {
    const key = normalizeGraceEntityKey(entity);
    if (
      !key ||
      isCatalystHlsEngineReusable?.(engine) !== true ||
      suspendCatalystHlsEngine?.(engine) !== true
    ) {
      return false;
    }
    evictRetainedCatalystHlsEntry(key);
    ensureCatalystHlsDeckHost().appendChild(engine);
    prepareEngineVideoForLiveDeck(engine);
    const entry = {
      engine,
      cancelled: false,
      timer: null,
    };
    entry.graceOrder = ++graceEntrySequence;
    catalystHlsRetainedPool.set(key, entry);
    trimCatalystHlsRetainedPool();
    return true;
  };

  const stashPendingMsePromiseForGrace = (entity, promise) => {
    const key = normalizeGraceEntityKey(entity);
    if (!key || !promise) return false;
    evictGraceMseEntry(key);
    const entry = createGracePendingEntry({
      graceMs,
      onExpire: () => {
        if (mseGracePool.get(key) !== entry) return;
        evictGraceMseEntry(key);
      },
    });
    entry.graceOrder = ++graceEntrySequence;
    entry.promise = (async () => {
      try {
        const result = await promise;
        if (entry.cancelled) {
          try {
            result?.engine?.destroy?.();
          } catch (_) {}
          return null;
        }
        if (!result?.ok || result.type !== "mse" || !result.engine) {
          evictGraceMseEntry(key);
          return null;
        }
        ensureMseGraceHost().appendChild(result.engine.video);
        prepareEngineVideoForGraceHost(result.engine.video);
        entry.engine = result.engine;
        entry.promise = null;
        return result.engine;
      } catch (_) {
        if (mseGracePool.get(key) === entry) {
          evictGraceMseEntry(key);
        }
        return null;
      }
    })();
    entry.graceOrder = ++graceEntrySequence;
    mseGracePool.set(key, entry);
    trimGracePool();
    return true;
  };

  const takeGraceMseEntry = (entity) => {
    const key = normalizeGraceEntityKey(entity);
    if (!key) return null;
    const entry = mseGracePool.get(key);
    if (!entry) return null;
    if (entry.timer) clearTimeout(entry.timer);
    mseGracePool.delete(key);
    return entry;
  };
  const takeGraceWebRtcEntry = (entity) => {
    const key = normalizeGraceEntityKey(entity);
    if (!key) return null;
    const entry = webRtcGracePool.get(key);
    if (!entry) return null;
    if (entry.timer) clearTimeout(entry.timer);
    webRtcGracePool.delete(key);
    return entry;
  };
  const takeGraceHaDirectEntry = (entity, streamType = "") => {
    const key = normalizeGraceEntityKey(entity);
    if (!key) return null;
    const entry = haDirectRetainedPool.get(key);
    if (!entry) return null;
    if (normalizeGraceEntityKey(entry.engine?.haDirectEntity) !== key) {
      evictGraceHaDirectEntry(key);
      return null;
    }
    const expectedType = String(streamType || "")
      .trim()
      .toLowerCase();
    if (expectedType && entry.engine?.streamType !== expectedType) return null;
    if (!isHaDirectEngineReusable(entry.engine)) {
      evictGraceHaDirectEntry(key);
      return null;
    }
    if (entry.timer) clearTimeout(entry.timer);
    haDirectRetainedPool.delete(key);
    return entry;
  };

  const peekRetainedHaDirectEngineForHandoff = (
    entity,
    streamType = "webrtc",
  ) => {
    const key = normalizeGraceEntityKey(entity);
    if (!key) return null;
    const entry = haDirectRetainedPool.get(key);
    const engine = entry?.engine || null;
    const expectedType = String(streamType || "")
      .trim()
      .toLowerCase();
    if (
      !engine ||
      normalizeGraceEntityKey(engine.haDirectEntity) !== key ||
      (expectedType && engine.streamType !== expectedType) ||
      engine.streamType !== "webrtc" ||
      !isHaDirectWebRtcEngineTransferable(engine)
    ) {
      return null;
    }
    return engine;
  };

  const takeRetainedHaDirectEngineForHandoff = (
    entity,
    expectedEngine,
    streamType = "webrtc",
  ) => {
    const key = normalizeGraceEntityKey(entity);
    const engine = peekRetainedHaDirectEngineForHandoff(entity, streamType);
    if (!key || !engine || engine !== expectedEngine) return null;
    const entry = haDirectRetainedPool.get(key);
    if (entry?.timer) clearTimeout(entry.timer);
    haDirectRetainedPool.delete(key);
    return engine;
  };

  const hasRetainedHaDirectEngine = (entity) => {
    const key = normalizeGraceEntityKey(entity);
    if (!key) return false;
    const entry = haDirectRetainedPool.get(key);
    if (!entry) return false;
    if (isHaDirectEngineReusable(entry.engine)) return true;
    evictGraceHaDirectEntry(key);
    return false;
  };

  const hasRetainedHaDirectHandoffEngines = () =>
    [...haDirectRetainedPool.values()].some(({ engine } = {}) =>
      isHaDirectWebRtcEngineTransferable(engine),
    );

  const retainHaDirectEngine = (entity, engine, options = {}) =>
    stashHaDirectEngineForGrace(entity, engine, options);

  const syncRetainedHaDirectEntities = (entities = []) => {
    const retainedEntities = new Set(
      entities.map((entity) => normalizeGraceEntityKey(entity)).filter(Boolean),
    );
    for (const entity of [...haDirectRetainedPool.keys()]) {
      if (!retainedEntities.has(entity)) evictGraceHaDirectEntry(entity);
    }
  };
  const takeGraceCatalystHlsEntry = (entity) => {
    const key = normalizeGraceEntityKey(entity);
    if (!key) return null;
    const entry = catalystHlsRetainedPool.get(key);
    if (!entry) return null;
    if (isCatalystHlsEngineReusable?.(entry.engine) !== true) {
      evictRetainedCatalystHlsEntry(key);
      return null;
    }
    if (entry.timer) clearTimeout(entry.timer);
    catalystHlsRetainedPool.delete(key);
    return entry;
  };

  const hasRetainedCatalystHlsEngine = (entity) => {
    const key = normalizeGraceEntityKey(entity);
    if (!key) return false;
    const entry = catalystHlsRetainedPool.get(key);
    if (!entry) return false;
    if (isCatalystHlsEngineReusable?.(entry.engine) === true) return true;
    evictRetainedCatalystHlsEntry(key);
    return false;
  };

  const retainCatalystHlsEngine = (entity, engine) =>
    stashCatalystHlsEngineForRetention(entity, engine);

  const adoptGraceMseEngine = (slot, engine) => {
    if (!slot || !isMseEngineReusable(engine)) {
      try {
        engine?.destroy?.();
      } catch (_) {}
      return false;
    }
    configureVideoElement(
      engine.video,
      buildVideoOptionsForView(
        "live",
        {
          muted: getStreamMuted?.(),
          controls: false,
        },
        { scopeKey: getScopeKey?.() },
      ),
    );
    mountNodeIntoSlot(slot, engine.video);
    attachVideoFit?.(engine.video);
    resetMseDiagnostics?.(Date.now());
    engine.setRecoveryHandler?.((reason) => scheduleResumeLive?.(reason));
    engine.setActivityHandler?.((chunkAt) => markMseChunk?.(chunkAt));
    engine.activateRecovery?.();
    setEngine?.(engine);
    setEngineMountedMuted?.(getStreamMuted?.());
    setActiveStreamType?.("mse");
    setStreamLoading?.(false);
    setStreamFallbackVisible?.(false);
    if (getRotateOverlayActive?.()) setLiveNativeControls?.(true);
    void engine.video.play?.().catch?.(() => {});
    return true;
  };
  const adoptGraceWebRtcEngine = (slot, engine) => {
    if (!slot || !isWebRtcEngineReusable(engine)) {
      try {
        engine?.destroy?.();
      } catch (_) {}
      return false;
    }
    configureVideoElement(
      engine.video,
      buildVideoOptionsForView(
        "live",
        {
          muted: getStreamMuted?.(),
          controls: false,
        },
        { scopeKey: getScopeKey?.() },
      ),
    );
    mountNodeIntoSlot(slot, engine.video);
    attachVideoFit?.(engine.video);
    engine.setRecoveryHandler?.((reason) => scheduleResumeLive?.(reason));
    engine.activateRecovery?.();
    setEngine?.(engine);
    setEngineMountedMuted?.(getStreamMuted?.());
    setActiveStreamType?.("webrtc");
    setStreamLoading?.(false);
    setStreamFallbackVisible?.(false);
    if (getRotateOverlayActive?.()) setLiveNativeControls?.(true);
    void engine.video.play?.().catch?.(() => {});
    return true;
  };
  const adoptGraceHaDirectEngine = (slot, engine, options = {}) => {
    if (engine?.streamType === "hls") {
      if (
        !slot ||
        isHaDirectHlsEngineReusable?.(engine) !== true ||
        adoptHaDirectHlsEngine?.(slot, engine) !== true
      ) {
        try {
          releaseHaDirectEngine?.(engine);
        } catch (_) {}
        return false;
      }
      return true;
    }
    const reusableWebRtc = options.allowPlaybackResume === true
      ? isHaDirectWebRtcEngineTransferable(engine)
      : isHaDirectEngineReusable(engine);
    if (!slot || !reusableWebRtc) {
      try {
        releaseHaDirectEngine?.(engine);
      } catch (_) {}
      const mediaNode = engine?.video || engine;
      try {
        mediaNode?.remove?.();
      } catch (_) {}
      return false;
    }
    const mediaNode = engine.video || null;
    const video = engine.video || null;
    if (!mediaNode) return false;
    configureVideoElement(
      video,
      buildVideoOptionsForView(
        "live",
        {
          muted: getStreamMuted?.(),
          controls: false,
        },
        { scopeKey: getScopeKey?.() },
      ),
    );
    video.style.opacity = "";
    video.style.zIndex = "";
    video.removeAttribute?.("aria-hidden");
    mountNodeIntoSlot(slot, mediaNode);
    attachVideoFit?.(video);
    setEngine?.(engine);
    const ownershipAdopted = adoptHaDirectWebRtcEngine?.(engine);
    if (ownershipAdopted === false) {
      setEngine?.(null, { retainPrevious: true });
      try {
        releaseHaDirectEngine?.(engine);
      } catch (_) {}
      try {
        mediaNode.remove?.();
      } catch (_) {}
      return false;
    }
    if (ownershipAdopted !== true) engine.activateRecovery?.();
    setEngineMountedMuted?.(getStreamMuted?.());
    setActiveStreamType?.("webrtc");
    setStreamLoading?.(false);
    setStreamFallbackVisible?.(false);
    if (getRotateOverlayActive?.()) setLiveNativeControls?.(true);
    void video?.play?.().catch?.(() => {});
    return true;
  };
  const adoptGraceCatalystHlsEngine = (slot, engine) => {
    if (
      !slot ||
      isCatalystHlsEngineReusable?.(engine) !== true ||
      adoptCatalystHlsEngine?.(slot, engine) !== true
    ) {
      try {
        releaseCatalystHlsEngine?.(engine);
      } catch (_) {}
      try {
        engine?.remove?.();
      } catch (_) {}
      return false;
    }
    return true;
  };

  const cleanupEngine = (options = {}) => {
    const pendingTakeoverTimer = getPendingWebRtcTakeoverTimer?.();
    if (pendingTakeoverTimer) {
      clearTimeout(pendingTakeoverTimer);
      setPendingWebRtcTakeoverTimer?.(null);
    }
    clearRotateOverlayAudioSync?.();
    clearRotateVideoFullscreenStyle?.();

    const preserveLiveEntity = String(
      options?.preserveLiveEntity || options?.preserveMseEntity || "",
    ).trim();
    const pending = getPendingMountDestroyers?.() || [];
    setPendingMountDestroyers?.([]);

    const { toPreserve, toDestroy } = splitPendingDestroyersByGraceMse({
      pendingDestroyers: pending,
      preserveMseEntity: preserveLiveEntity,
    });

    for (const pendingAttempt of toPreserve) {
      stashPendingMsePromiseForGrace(preserveLiveEntity, pendingAttempt.promise);
    }
    for (const pendingAttempt of toDestroy) {
      try {
        pendingAttempt?.destroy?.();
      } catch (_) {}
    }

    const engine = getEngine?.();
    if (!engine) return;
    const activeStreamType = String(getActiveStreamType?.() || "")
      .trim()
      .toLowerCase();
    if (
      preserveLiveEntity &&
      engine?.catalystHls === true &&
      engine?.streamType === activeStreamType &&
      stashCatalystHlsEngineForRetention(preserveLiveEntity, engine)
    ) {
      setEngine?.(null, { retainPrevious: true });
      return;
    }
    if (
      preserveLiveEntity &&
      engine?.type === "ha_direct" &&
      engine?.streamType === activeStreamType &&
      stashHaDirectEngineForGrace(preserveLiveEntity, engine)
    ) {
      setEngine?.(null, { retainPrevious: true });
      return;
    }
    if (engine?.type === "ha_direct") {
      try {
        releaseHaDirectEngine?.(engine);
      } catch (_) {}
      const mediaNode =
        engine.streamType === "webrtc" ? engine.video : engine;
      try {
        mediaNode?.remove?.();
      } catch (_) {}
      setEngine?.(null, { retainPrevious: true });
      return;
    }
    if (
      preserveLiveEntity &&
      activeStreamType === "webrtc" &&
      stashWebRtcEngineForGrace(preserveLiveEntity, engine)
    ) {
      setEngine?.(null);
      return;
    }
    if (
      preserveLiveEntity &&
      activeStreamType === "mse" &&
      stashMseEngineForGrace(preserveLiveEntity, engine)
    ) {
      setEngine?.(null);
      return;
    }
    try {
      if (typeof engine.destroy === "function") engine.destroy();
      if (engine.ws && typeof engine.ws.close === "function") engine.ws.close();
      if (engine.pc && typeof engine.pc.close === "function") engine.pc.close();
    } catch (_) {}
    setEngine?.(null);
  };

  const clearGracePool = () => {
    for (const entity of [...mseGracePool.keys()]) {
      evictGraceMseEntry(entity);
    }
    for (const entity of [...webRtcGracePool.keys()]) {
      evictGraceWebRtcEntry(entity);
    }
    for (const entity of [...haDirectRetainedPool.keys()]) {
      evictGraceHaDirectEntry(entity);
    }
    for (const entity of [...catalystHlsRetainedPool.keys()]) {
      evictRetainedCatalystHlsEntry(entity);
    }
    try {
      mseGraceHost?.remove?.();
    } catch (_) {}
    mseGraceHost = null;
    try {
      haDirectDeckHost?.remove?.();
    } catch (_) {}
    haDirectDeckHost = null;
    try {
      catalystHlsDeckHost?.remove?.();
    } catch (_) {}
    catalystHlsDeckHost = null;
  };

  const evictEntity = (entity) => {
    evictGraceMseEntry(entity);
    evictGraceWebRtcEntry(entity);
    evictGraceHaDirectEntry(entity);
    evictRetainedCatalystHlsEntry(entity);
  };

  return {
    cleanupEngine,
    clearGracePool,
    evictEntity,
    takeGraceMseEntry,
    adoptGraceMseEngine,
    isMseEngineReusable,
    takeGraceWebRtcEntry,
    adoptGraceWebRtcEngine,
    isWebRtcEngineReusable,
    takeGraceHaDirectEntry,
    peekRetainedHaDirectEngineForHandoff,
    takeRetainedHaDirectEngineForHandoff,
    adoptGraceHaDirectEngine,
    isHaDirectEngineReusable,
    isHaDirectWebRtcEngineTransferable,
    hasRetainedHaDirectEngine,
    hasRetainedHaDirectHandoffEngines,
    retainHaDirectEngine,
    syncRetainedHaDirectEntities,
    getHaDirectDeckHost: ensureHaDirectDeckHost,
    getHaDirectWebRtcDeckHost: ensureHaDirectDeckHost,
    takeGraceCatalystHlsEntry,
    hasRetainedCatalystHlsEngine,
    retainCatalystHlsEngine,
    adoptGraceCatalystHlsEngine,
    getCatalystHlsDeckHost: ensureCatalystHlsDeckHost,
  };
}
