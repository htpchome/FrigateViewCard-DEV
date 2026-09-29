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

const normalizeHaStreamType = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_");
  if (normalized === "hls") return "hls";
  if (normalized === "webrtc" || normalized === "web_rtc") return "webrtc";
  return "";
};

export function resolveHaDirectCameraStreamType({
  entity,
  activeEntity,
  activeStreamType,
  advertisedStreamType,
  requestedStreamType,
  fallbackStreamType = "hls",
} = {}) {
  const targetEntity = String(entity || "").trim();
  const currentEntity = String(activeEntity || "").trim();
  const active = normalizeHaStreamType(activeStreamType);
  if (targetEntity && targetEntity === currentEntity && active) return active;

  const advertised = normalizeHaStreamType(advertisedStreamType);
  const requested = normalizeHaStreamType(requestedStreamType);
  const fallback = normalizeHaStreamType(fallbackStreamType);
  return advertised || requested || fallback || "hls";
}

export function buildHaCameraStreamState(
  hass,
  entity,
  streamType = null,
  fallbackStreamType = "webrtc",
) {
  const raw = hass?.states?.[entity];
  if (!raw) return null;
  const attrs = { ...raw.attributes };
  attrs.frontend_stream_type = streamType || fallbackStreamType;
  return { ...raw, attributes: attrs };
}

export function createHaCameraStreamElement({
  hass,
  stateObj,
  muted = false,
  controls = false,
  defaultMuted,
  fitMode,
  styleText = "",
} = {}) {
  if (!hass || !stateObj) return null;
  const stream = document.createElement("ha-camera-stream");
  stream.hass = hass;
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

export function createHaHlsPlayerElement({
  hass,
  entity,
  muted = false,
  controls = false,
  defaultMuted,
  fitMode,
  styleText = "",
} = {}) {
  const entityId = String(entity || "").trim();
  if (!hass || !entityId) return null;
  const player = document.createElement("ha-hls-player");
  player.hass = hass;
  player.entityid = entityId;
  player.autoPlay = true;
  player.playsInline = true;
  player.controls = controls;
  player.muted = muted;
  if (fitMode !== undefined) {
    player.fitMode = fitMode;
  }
  if (defaultMuted !== undefined) {
    player.defaultMuted = defaultMuted;
  }
  if (styleText) {
    player.style.cssText = styleText;
  }
  return player;
}

export function createHaNativeHlsVideoElement({
  hass,
  entity,
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
  video.hlsUrlReady = Promise.resolve(
    hass.callWS({
      type: "camera/stream",
      entity_id: entityId,
    }),
  )
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
