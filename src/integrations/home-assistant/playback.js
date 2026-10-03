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
} = {}) {
  const entityId = String(entity || "").trim();
  if (!hass?.callWS || !entityId) return null;

  const video = document.createElement("video");
  let destroyed = false;
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
  video.hlsUrlReady = Promise.resolve(hass.callWS(streamRequest))
    .then((response) => {
      const path = String(response?.url || "").trim();
      if (destroyed || !path) return false;
      video.src = hass.hassUrl?.(path) || path;
      return true;
    })
    .catch(() => false);
  video.destroy = () => {
    destroyed = true;
    try {
      video.pause?.();
      video.removeAttribute?.("src");
      video.load?.();
    } catch (_) {}
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
