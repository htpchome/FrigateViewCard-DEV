import { hideFallbackStatus } from "./fallbacks/fallback-status.js";

export const isLiveTransportType = (type) => {
  const active = String(type || "")
    .trim()
    .toLowerCase();
  return active === "webrtc" || active === "mse" || active === "hls";
};

export const hasCurrentHaDirectLiveEvidence = (engine, state) => {
  if (engine?.haDirectProvider !== true) return true;
  if (engine.haDirectProviderReady === false) return false;
  if (state?.state !== "unavailable") return true;
  const readyState = engine.haDirectReadyState;
  // Re-projecting a retained player is not fresh media after a new outage.
  return Boolean(readyState && readyState.state === "unavailable" &&
    (readyState === state || (state.last_changed &&
      readyState.last_changed === state.last_changed)));
};

export const resolveCameraAvailabilitySnapshot = ({
  previous = null,
  entity = "",
  state = null,
  suspended = false,
} = {}) => {
  const current = {
    entity: String(entity || ""),
    available: state?.state !== "unavailable" && suspended !== true,
  };
  return {
    current,
    recovered:
      Boolean(current.entity) &&
      previous?.entity === current.entity &&
      previous?.available === false &&
      current.available === true,
  };
};

export const resolveActiveStreamTypeState = ({ type, lastLiveStreamHint }) => {
  const activeStreamType = type || "--";
  return {
    activeStreamType,
    lastLiveStreamHint: isLiveTransportType(activeStreamType)
      ? String(activeStreamType).trim().toLowerCase()
      : lastLiveStreamHint,
  };
};

export const applyStreamLoadingState = ({ shadowRoot, loading, text }) => {
  const el = shadowRoot?.querySelector?.("#stream-loading");
  if (!el) return;
  el.hidden = !loading;
  const label = el.querySelector?.(".label");
  if (label) label.textContent = text;
};

export const applyStreamLoadingStateForCard = ({ card, loading, text }) => {
  if (!card) return;
  applyStreamLoadingState({
    shadowRoot: card.shadowRoot,
    loading,
    text,
  });
};

export const applyStreamFallbackState = ({
  shadowRoot,
  visible,
  refreshImage,
  onRefresh,
}) => {
  const placeholder = shadowRoot?.querySelector?.("#stream-fallback");
  const status = shadowRoot?.querySelector?.("#stream-fallback-status");
  if (!placeholder) return;
  placeholder.hidden = !visible;
  if (!visible) hideFallbackStatus(status);
  if (visible && refreshImage) onRefresh?.();
};

export const applyStreamFallbackVisibility = ({
  shadowRoot,
  visible,
  refreshImage,
  refreshFallbackImage,
}) => {
  applyStreamFallbackState({
    shadowRoot,
    visible,
    refreshImage,
    onRefresh: () => refreshFallbackImage?.(),
  });
};

export const applyStreamFallbackVisibilityForCard = ({
  card,
  visible,
  refreshImage,
}) => {
  if (!card) return;
  applyStreamFallbackVisibility({
    shadowRoot: card.shadowRoot,
    visible,
    refreshImage,
    refreshFallbackImage: () => card._refreshStreamFallbackImage?.(),
  });
};

export const applyActiveStreamTypeForCard = ({ card, type }) => {
  if (!card) return;
  const liveEntity = String(
    card._activeGroupMemberOverride || card._activeCam?.entity || "",
  ).trim();
  const nextState = resolveActiveStreamTypeState({
    type: isLiveTransportType(type) && !hasCurrentHaDirectLiveEvidence(
      card._engine, card._hass?.states?.[liveEntity],
    ) ? "--" : type,
    lastLiveStreamHint: card._lastLiveStreamHint,
  });
  card._activeStreamType = nextState.activeStreamType;
  card._lastLiveStreamHint = nextState.lastLiveStreamHint;
  const committedEngine = isLiveTransportType(nextState.activeStreamType)
    ? card._engine || null
    : null;
  card._committedLiveAvailabilityEntity = committedEngine ? liveEntity : "";
  card._committedLiveAvailabilityEngine = committedEngine;
  card._renderStats?.();
};

export const resolveSnapshotFallbackState = ({
  refreshImage = false,
} = {}) => ({
  activeStreamType: "snapshot",
  loading: false,
  fallbackVisible: true,
  refreshFallbackImage: refreshImage === true,
});
