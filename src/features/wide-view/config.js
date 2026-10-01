export const WIDE_VIEW_WIDTH_OPTIONS = Object.freeze([50, 75, 100]);
export const WIDE_VIEW_WIDTH_DEFAULT = 100;
export const WIDE_VIEW_RIGHT_COLUMN_MIN_PX = 250;
export const WIDE_LEFT_RESIZE_MIN = 50;
export const WIDE_LEFT_RESIZE_FALLBACK_MAX = 75;
export const WIDE_TIMELINE_SCALE_OPTIONS_HOURS = Object.freeze([1, 6, 12, 24]);
export const WIDE_TIMELINE_DEFAULT_SCALE_HOURS = 12;

export const normalizeWideViewWidth = (value) => {
  const numeric = Number(value);
  return WIDE_VIEW_WIDTH_OPTIONS.includes(numeric)
    ? numeric
    : WIDE_VIEW_WIDTH_DEFAULT;
};

export const normalizeWideTimelineScale = (value) => {
  const numeric = Number(value);
  return WIDE_TIMELINE_SCALE_OPTIONS_HOURS.includes(numeric)
    ? numeric
    : WIDE_TIMELINE_DEFAULT_SCALE_HOURS;
};
