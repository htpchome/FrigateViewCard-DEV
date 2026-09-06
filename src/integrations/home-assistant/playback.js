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

export function findActiveHaCameraStreamPlayer(stream) {
  const tagName = stream?.tagName?.toLowerCase?.();
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
  return (
    player.shadowRoot?.querySelector?.("video") ||
    player.querySelector?.("video") ||
    null
  );
}
