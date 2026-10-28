import { watchMediaFirstFrame } from "../../shared/media/first-frame.js";

const HA_CAMERA_PLAYBACK_ELEMENTS = Object.freeze([
  "ha-camera-stream",
  "ha-hls-player",
  "ha-web-rtc-player",
]);
const playbackPreparationByRegistry = new WeakMap();

const hasHaCameraPlaybackElements = (registry) =>
  HA_CAMERA_PLAYBACK_ELEMENTS.every((tagName) => registry.get(tagName));

export function ensureHaCameraPlaybackElements({
  registry = globalThis.customElements,
  loadCardHelpers = () => globalThis.loadCardHelpers?.(),
} = {}) {
  if (!registry?.get) return false;
  if (hasHaCameraPlaybackElements(registry)) return true;

  const existingPreparation = playbackPreparationByRegistry.get(registry);
  if (existingPreparation) return existingPreparation;

  const preparation = (async () => {
    try {
      const helpers = await loadCardHelpers?.();
      if (typeof helpers?.createCardElement !== "function") return false;

      // picture-glance statically imports hui-image, which imports HA's
      // complete camera playback stack. Creating it loads code, not a stream.
      await helpers.createCardElement({
        type: "picture-glance",
        entities: [],
        camera_image: "camera.frigate_view_component_loader",
      });
      return hasHaCameraPlaybackElements(registry);
    } catch (_) {
      return false;
    }
  })();
  const trackedPreparation = preparation.then((prepared) => {
    if (!prepared) playbackPreparationByRegistry.delete(registry);
    return prepared;
  });
  playbackPreparationByRegistry.set(registry, trackedPreparation);
  return trackedPreparation;
}

export function buildHaCameraStreamState(hass, entity) {
  return hass?.states?.[entity] || null;
}

export function createHaCameraStreamElement({
  stateObj,
  muted = false,
  controls = false,
  defaultMuted,
  fitMode,
  styleText = "",
} = {}) {
  if (!stateObj) return null;
  const stream = document.createElement("ha-camera-stream");
  stream.stateObj = stateObj;
  stream.controls = controls;
  stream.muted = muted;
  if (fitMode !== undefined) {
    stream.fitMode = fitMode;
  }
  if (defaultMuted !== undefined) {
    stream.defaultMuted = defaultMuted;
  }
  if (styleText) {
    stream.style.cssText = styleText;
  }
  return stream;
}

export function createHaNativeHlsVideoElement({
  hass,
  entity,
  streamFormat,
  muted = false,
  controls = false,
  defaultMuted,
  fitMode,
  styleText = "",
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  documentTarget = globalThis.document,
  windowTarget = globalThis.window,
} = {}) {
  const entityId = String(entity || "").trim();
  if (!hass?.callWS || !entityId) return null;

  const video = document.createElement("video");
  let destroyed = false;
  let pendingUrl = null;
  let retryTimer = null;
  let stallTimer = null;
  let lastRecoveryAt = -Infinity;
  let generation = 0;
  let resumeTimer = null;
  let resumeProgress = null;
  video.hlsBackgroundSuspended = false;
  video.hlsResumePending = false;
  video.autoplay = true;
  video.playsInline = true;
  video.controls = controls;
  video.muted = muted;
  video.preload = "auto";
  if (defaultMuted !== undefined) video.defaultMuted = defaultMuted;
  if (styleText) video.style.cssText = styleText;
  if (fitMode !== undefined) video.style.objectFit = fitMode;
  const streamRequest = {
    type: "camera/stream",
    entity_id: entityId,
  };
  const requestedFormat = String(streamFormat || "").trim();
  if (requestedFormat) streamRequest.format = requestedFormat;
  const requestUrl = ({ recovery = false } = {}) => {
    if (destroyed || video.hlsBackgroundSuspended) return Promise.resolve(false);
    if (pendingUrl) return pendingUrl;
    const requestGeneration = generation;
    pendingUrl = (async () => {
      await Promise.resolve();
      try {
        if (destroyed || requestGeneration !== generation) return false;
        const response = await hass.callWS(streamRequest);
        const path = typeof response?.url === "string" ? response.url.trim() : "";
        if (destroyed || requestGeneration !== generation || !path) return false;
        if (recovery && !video.hlsRecovering) return true;
        video.src = hass.hassUrl?.(path) || path;
        return true;
      } catch (_) {
        return false;
      } finally {
        if (requestGeneration === generation) pendingUrl = null;
      }
    })();
    return pendingUrl;
  };
  const watchStall = () => {
    if (destroyed || video.hlsBackgroundSuspended || video.hlsResumePending || stallTimer !== null) return;
    const stoppedAt = video.currentTime;
    // Only watch an actual interruption, including in an unselected player.
    // Healthy retained playback has no polling or connection timer.
    stallTimer = setTimer(() => {
      stallTimer = null;
      if (destroyed || (!video.error && video.currentTime !== stoppedAt)) return;
      recover();
    }, 10000);
  };
  const cancelResumeCheck = () => {
    if (resumeTimer !== null) clearTimer(resumeTimer);
    resumeTimer = null;
    if (resumeProgress) video.removeEventListener?.("timeupdate", resumeProgress);
    resumeProgress = null;
    video.hlsResumePending = false;
  };
  const recover = () => {
    if (destroyed || video.hlsBackgroundSuspended || (video.hlsRecoverySuspended && !video.hlsRecovering)) return;
    cancelResumeCheck();
    if (stallTimer !== null) clearTimer(stallTimer);
    stallTimer = null;
    video.hlsRecovering = true;
    if (pendingUrl || retryTimer !== null) return;
    const delay = Math.max(0, 5000 - (now() - lastRecoveryAt));
    const retry = async () => {
      retryTimer = null;
      if (destroyed || video.hlsBackgroundSuspended) return;
      const recoveryGeneration = generation;
      lastRecoveryAt = now();
      const ready = await requestUrl({ recovery: true });
      if (destroyed || recoveryGeneration !== generation || !video.hlsRecovering) return;
      if (!ready) { recover(); return; }
      watchStall();
      try { await video.play?.(); } catch (_) {
        if (recoveryGeneration === generation && video.hlsRecovering) recover();
      }
    };
    if (delay) retryTimer = setTimer(retry, delay);
    else void retry();
  };
  const recovered = () => {
    if (destroyed || video.hlsBackgroundSuspended || video.error || video.readyState < 2) return;
    video.hlsRecovering = false;
    if (retryTimer !== null) clearTimer(retryTimer);
    retryTimer = null;
    if (stallTimer !== null) clearTimer(stallTimer);
    stallTimer = null;
  };
  const stopMedia = () => {
    video.muted = true;
    video.autoplay = false;
    try {
      video.pause?.();
      video.removeAttribute?.("src");
      video.load?.();
    } catch (_) {}
  };
  const suspend = () => {
    if (destroyed || video.hlsBackgroundSuspended) return;
    // Explicit PiP playback keeps its existing native presentation lifecycle.
    if (documentTarget?.pictureInPictureElement === video ||
        video.webkitPresentationMode === "picture-in-picture") return;
    video.hlsBackgroundSuspended = true;
    cancelResumeCheck();
    generation += 1;
    pendingUrl = null;
    video.hlsRecovering = false;
    if (retryTimer !== null) clearTimer(retryTimer);
    if (stallTimer !== null) clearTimer(stallTimer);
    retryTimer = null;
    stallTimer = null;
    // Retain the native stream, but never retain audible background playback.
    video.muted = true;
    video.onHlsBackground?.();
  };
  const resume = () => {
    if (destroyed || !video.hlsBackgroundSuspended || documentTarget?.visibilityState === "hidden") return;
    // A replaced card must not resurrect its orphaned native player.
    if (video.isConnected === false) return;
    video.hlsBackgroundSuspended = false;
    video.muted = true;
    video.autoplay = true;
    lastRecoveryAt = -Infinity;
    video.onHlsForeground?.();
    if (!video.src || video.error || video.ended || video.readyState < 2) {
      recover();
      return;
    }
    // A cached frame is not proof of a healthy retained HLS connection.
    // Verify foreground progress once; only a stalled player needs a fresh URL.
    const resumeGeneration = generation;
    const startTime = video.currentTime;
    video.hlsResumePending = true;
    resumeProgress = () => {
      if (destroyed || generation !== resumeGeneration || video.hlsBackgroundSuspended) return;
      if (!video.paused && video.currentTime > startTime + 0.1) {
        cancelResumeCheck();
        video.onHlsResumeReady?.();
      }
    };
    video.addEventListener?.("timeupdate", resumeProgress);
    resumeTimer = setTimer(() => {
      resumeTimer = null;
      if (destroyed || generation !== resumeGeneration || video.hlsBackgroundSuspended) return;
      cancelResumeCheck();
      recover();
    }, 1500);
    if (video.paused) {
      try { video.play?.()?.catch?.(() => {}); } catch (_) {}
    }
  };
  const visibilityChanged = () => {
    if (documentTarget?.visibilityState === "hidden") suspend();
    else resume();
  };
  documentTarget?.addEventListener?.("visibilitychange", visibilityChanged);
  windowTarget?.addEventListener?.("pagehide", suspend);
  windowTarget?.addEventListener?.("pageshow", resume);
  video.recoverHls = recover;
  video.addEventListener?.("error", recover);
  video.addEventListener?.("ended", recover);
  video.addEventListener?.("playing", recovered);
  video.addEventListener?.("waiting", watchStall);
  video.addEventListener?.("stalled", watchStall);
  video.addEventListener?.("leavepictureinpicture", visibilityChanged);
  video.addEventListener?.("webkitpresentationmodechanged", visibilityChanged);
  if (documentTarget?.visibilityState === "hidden") suspend();
  const startupGeneration = generation;
  video.hlsUrlReady = requestUrl();
  void video.hlsUrlReady.then((ready) => {
    if (!ready && !destroyed && startupGeneration === generation) recover();
  });
  video.destroy = () => {
    destroyed = true;
    generation += 1;
    cancelResumeCheck();
    video.hlsRecovering = false;
    if (retryTimer !== null) clearTimer(retryTimer);
    retryTimer = null;
    if (stallTimer !== null) clearTimer(stallTimer);
    stallTimer = null;
    video.removeEventListener?.("error", recover);
    video.removeEventListener?.("ended", recover);
    video.removeEventListener?.("playing", recovered);
    video.removeEventListener?.("waiting", watchStall);
    video.removeEventListener?.("stalled", watchStall);
    video.removeEventListener?.("leavepictureinpicture", visibilityChanged);
    video.removeEventListener?.("webkitpresentationmodechanged", visibilityChanged);
    documentTarget?.removeEventListener?.("visibilitychange", visibilityChanged);
    windowTarget?.removeEventListener?.("pagehide", suspend);
    windowTarget?.removeEventListener?.("pageshow", resume);
    video.onHlsBackground = null;
    video.onHlsForeground = null;
    video.onHlsResumeReady = null;
    stopMedia();
  };
  return video;
}

export function findActiveHaCameraStreamPlayer(stream) {
  const tagName = stream?.tagName?.toLowerCase?.();
  if (tagName === "video") {
    return !stream?.hidden && !stream?.classList?.contains?.("hidden")
      ? stream
      : null;
  }
  if (tagName === "ha-web-rtc-player" || tagName === "ha-hls-player") {
    return !stream?.hidden && !stream?.classList?.contains?.("hidden")
      ? stream
      : null;
  }
  const players = Array.from(
    stream?.shadowRoot?.querySelectorAll?.(
      "ha-web-rtc-player,ha-hls-player",
    ) || [],
  );
  return (
    players.find(
      (player) =>
        !player?.hidden && !player?.classList?.contains?.("hidden"),
    ) || null
  );
}

export function findActiveHaCameraStreamVideo(stream) {
  const player = findActiveHaCameraStreamPlayer(stream);
  if (!player) return null;
  if (player.tagName?.toLowerCase?.() === "video") return player;
  return (
    player.shadowRoot?.querySelector?.("video") ||
    player.querySelector?.("video") ||
    null
  );
}

export function watchHaPlaybackFirstFrame({
  stream,
  isDestroyed = () => false,
  onReady,
  pollMs = 80,
} = {}) {
  if (!stream || typeof onReady !== "function") return () => {};

  let disposed = false;
  let revision = 0;
  let cleanupFrameWatch = () => {};

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    revision += 1;
    cleanupFrameWatch();
    cleanupFrameWatch = () => {};
    stream.removeEventListener?.("load", reconcile, true);
    stream.removeEventListener?.("streams", reconcile, true);
  };
  const finish = () => {
    if (disposed || isDestroyed()) return;
    cleanup();
    onReady();
  };
  const reconcile = () => {
    const currentRevision = ++revision;
    cleanupFrameWatch();
    cleanupFrameWatch = () => {};
    void (async () => {
      try {
        // The provider observes child events during capture. Yield once so
        // ha-camera-stream can process that event and schedule its own update
        // before we read the current updateComplete promise.
        await Promise.resolve();
        await stream.updateComplete;
      } catch (_) {}
      if (
        disposed ||
        isDestroyed() ||
        currentRevision !== revision
      ) {
        return;
      }
      cleanupFrameWatch = watchMediaFirstFrame({
        mediaRoot: stream,
        findVideo: findActiveHaCameraStreamVideo,
        isDestroyed,
        onReady: finish,
        pollMs,
      });
    })();
  };

  stream.addEventListener?.("load", reconcile, true);
  stream.addEventListener?.("streams", reconcile, true);
  reconcile();
  return cleanup;
}
