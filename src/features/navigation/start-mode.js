export const PAGE_START_MODES = Object.freeze({
  live: "live",
  grid: "grid",
  slideshow: "slideshow",
});

const PAGE_START_MODE_SET = new Set(Object.values(PAGE_START_MODES));

export const normalizePageStartMode = (value) => {
  const mode = String(value || "").trim().toLowerCase();
  return PAGE_START_MODE_SET.has(mode) ? mode : PAGE_START_MODES.live;
};

export const pageStartModeOptions = ({
  gridEnabled = false,
  slideshowEnabled = false,
} = {}) => [
  {
    value: PAGE_START_MODES.live,
    label: "Live",
    disabled: false,
    disabledReason: "",
  },
  {
    value: PAGE_START_MODES.grid,
    label: "Grid",
    disabled: gridEnabled !== true,
    disabledReason:
      "Enable Grid Mode in Grid Mode Settings to use this option.",
  },
  {
    value: PAGE_START_MODES.slideshow,
    label: "Slideshow",
    disabled: slideshowEnabled !== true,
    disabledReason:
      "Enable Slideshow Mode in Slideshow Settings to use this option.",
  },
];
