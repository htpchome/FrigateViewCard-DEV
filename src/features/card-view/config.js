import {
  PAGE_START_MODES,
  normalizePageStartMode,
} from "../navigation/start-mode.js";

export const CARD_VIEW_START_MODES = PAGE_START_MODES;

export const CARD_VIEW_MEDIA_DRAWER_TYPES = Object.freeze({
  alerts: "alerts",
  clips: "clips",
  snapshots: "snapshots",
  recordings: "recordings",
  favorites: "kept",
});

export const CARD_VIEW_MEDIA_DRAWER_ORDER = Object.freeze([
  CARD_VIEW_MEDIA_DRAWER_TYPES.alerts,
  CARD_VIEW_MEDIA_DRAWER_TYPES.clips,
  CARD_VIEW_MEDIA_DRAWER_TYPES.snapshots,
  CARD_VIEW_MEDIA_DRAWER_TYPES.recordings,
  CARD_VIEW_MEDIA_DRAWER_TYPES.favorites,
]);

const CARD_VIEW_HIDDEN_TAB_BY_DRAWER_TYPE = Object.freeze({
  [CARD_VIEW_MEDIA_DRAWER_TYPES.alerts]: "alerts",
  [CARD_VIEW_MEDIA_DRAWER_TYPES.clips]: "clips",
  [CARD_VIEW_MEDIA_DRAWER_TYPES.snapshots]: "snapshot",
  [CARD_VIEW_MEDIA_DRAWER_TYPES.recordings]: "recordings",
  [CARD_VIEW_MEDIA_DRAWER_TYPES.favorites]: "kept",
});

export const resolveCardViewMediaDrawerTypes = (hiddenTabs = []) => {
  const hidden = new Set(Array.isArray(hiddenTabs) ? hiddenTabs : []);
  return CARD_VIEW_MEDIA_DRAWER_ORDER.filter(
    (drawerType) => !hidden.has(CARD_VIEW_HIDDEN_TAB_BY_DRAWER_TYPE[drawerType]),
  );
};

export const CARD_VIEW_VIEW_MODES = Object.freeze({
  videoOnly: "video-only",
  bottomPanelOpen: "bottom-panel-open",
  bottomPanelClosed: "bottom-panel-closed",
});

const CARD_VIEW_MASONRY_SIZE_HINTS = Object.freeze({
  [CARD_VIEW_VIEW_MODES.videoOnly]: 6,
  [CARD_VIEW_VIEW_MODES.bottomPanelOpen]: 11,
  [CARD_VIEW_VIEW_MODES.bottomPanelClosed]: 7,
});

export const normalizeCardViewStartMode = normalizePageStartMode;

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

export const resolveCardViewMasonrySizeHint = (viewMode) =>
  CARD_VIEW_MASONRY_SIZE_HINTS[normalizeCardViewViewMode(viewMode)] ||
  CARD_VIEW_MASONRY_SIZE_HINTS[CARD_VIEW_VIEW_MODES.bottomPanelOpen];

const CARD_VIEW_MEDIA_DRAWER_TYPE_ALIASES = Object.freeze({
  alert: CARD_VIEW_MEDIA_DRAWER_TYPES.alerts,
  alerts: CARD_VIEW_MEDIA_DRAWER_TYPES.alerts,
  clip: CARD_VIEW_MEDIA_DRAWER_TYPES.clips,
  clips: CARD_VIEW_MEDIA_DRAWER_TYPES.clips,
  snapshot: CARD_VIEW_MEDIA_DRAWER_TYPES.snapshots,
  snapshots: CARD_VIEW_MEDIA_DRAWER_TYPES.snapshots,
  recording: CARD_VIEW_MEDIA_DRAWER_TYPES.recordings,
  recordings: CARD_VIEW_MEDIA_DRAWER_TYPES.recordings,
  favorite: CARD_VIEW_MEDIA_DRAWER_TYPES.favorites,
  favorites: CARD_VIEW_MEDIA_DRAWER_TYPES.favorites,
  kept: CARD_VIEW_MEDIA_DRAWER_TYPES.favorites,
});

export const normalizeCardViewMediaDrawerType = (value) =>
  CARD_VIEW_MEDIA_DRAWER_TYPE_ALIASES[
    String(value || "").trim().toLowerCase()
  ] || CARD_VIEW_MEDIA_DRAWER_TYPES.alerts;
