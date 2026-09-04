export const CARD_VIEW_START_MODES = Object.freeze({
  live: "live",
  slideshow: "slideshow",
  grid: "grid",
});

export const CARD_VIEW_MEDIA_DRAWER_TYPES = Object.freeze({
  alerts: "alerts",
  clips: "clips",
  snapshots: "snapshots",
});

export const CARD_VIEW_VIEW_MODES = Object.freeze({
  videoOnly: "video-only",
  bottomPanelOpen: "bottom-panel-open",
  bottomPanelClosed: "bottom-panel-closed",
});

const CARD_VIEW_START_MODE_SET = new Set(
  Object.values(CARD_VIEW_START_MODES),
);

export const normalizeCardViewStartMode = (value) => {
  const mode = String(value || "").trim().toLowerCase();
  return CARD_VIEW_START_MODE_SET.has(mode)
    ? mode
    : CARD_VIEW_START_MODES.live;
};

const CARD_VIEW_VIEW_MODE_SET = new Set(
  Object.values(CARD_VIEW_VIEW_MODES),
);

export const normalizeCardViewViewMode = (
  value,
  {
    legacyDrawerDefaultOpen,
    legacyVideoPanelOnly,
  } = {},
) => {
  const mode = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  if (CARD_VIEW_VIEW_MODE_SET.has(mode)) return mode;
  if (legacyVideoPanelOnly === true) {
    return CARD_VIEW_VIEW_MODES.videoOnly;
  }
  return legacyDrawerDefaultOpen === false
    ? CARD_VIEW_VIEW_MODES.bottomPanelClosed
    : CARD_VIEW_VIEW_MODES.bottomPanelOpen;
};

const CARD_VIEW_MEDIA_DRAWER_TYPE_ALIASES = Object.freeze({
  alert: CARD_VIEW_MEDIA_DRAWER_TYPES.alerts,
  alerts: CARD_VIEW_MEDIA_DRAWER_TYPES.alerts,
  clip: CARD_VIEW_MEDIA_DRAWER_TYPES.clips,
  clips: CARD_VIEW_MEDIA_DRAWER_TYPES.clips,
  snapshot: CARD_VIEW_MEDIA_DRAWER_TYPES.snapshots,
  snapshots: CARD_VIEW_MEDIA_DRAWER_TYPES.snapshots,
});

export const normalizeCardViewMediaDrawerType = (value) =>
  CARD_VIEW_MEDIA_DRAWER_TYPE_ALIASES[
    String(value || "").trim().toLowerCase()
  ] || CARD_VIEW_MEDIA_DRAWER_TYPES.alerts;
