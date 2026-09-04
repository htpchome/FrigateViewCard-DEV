export const CARD_VIEW_START_MODES = Object.freeze({
  live: "live",
  slideshow: "slideshow",
  grid: "grid",
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
