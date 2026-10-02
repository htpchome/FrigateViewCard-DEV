export const WIDE_VIEW_WIDTH_IN_BETWEEN = 75;
export const WIDE_VIEW_WIDTH_CUSTOM = "custom";
export const WIDE_VIEW_WIDTH_OPTIONS = Object.freeze([
  50,
  WIDE_VIEW_WIDTH_IN_BETWEEN,
  100,
]);
export const WIDE_VIEW_WIDTH_DEFAULT = 100;
export const WIDE_CUSTOM_WIDTH_MIN = 25;
export const WIDE_CUSTOM_WIDTH_MAX = 75;
export const WIDE_CUSTOM_WIDTH_DEFAULT = 60;
export const WIDE_VIEW_RIGHT_COLUMN_MIN_PX = 250;
export const WIDE_LEFT_RESIZE_MIN = 50;
export const WIDE_LEFT_RESIZE_FALLBACK_MAX = 75;
export const WIDE_COMPANION_GRID_GAP_PX = 8;
export const WIDE_COMPANION_META_HEIGHT_PX = 24;
export const WIDE_COMPANION_MIN_CELL_WIDTH_PX = 160;
export const WIDE_COMPANION_LIVE_OVERLAP_RATIO = 0.7;
export const WIDE_TIMELINE_SCALE_OPTIONS_HOURS = Object.freeze([1, 6, 12, 24]);
export const WIDE_TIMELINE_DEFAULT_SCALE_HOURS = 12;

const finiteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

export const normalizeWideViewWidth = (value) => {
  const numeric = Number(value);
  return WIDE_VIEW_WIDTH_OPTIONS.includes(numeric)
    ? numeric
    : WIDE_VIEW_WIDTH_DEFAULT;
};

export const isWideCustomWidthConfigured = (value) =>
  value !== undefined &&
  value !== null &&
  String(value).trim() !== "";

export const normalizeWideCustomWidth = (value) => {
  if (!isWideCustomWidthConfigured(value)) {
    return WIDE_CUSTOM_WIDTH_DEFAULT;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return WIDE_CUSTOM_WIDTH_DEFAULT;
  return Math.min(
    WIDE_CUSTOM_WIDTH_MAX,
    Math.max(WIDE_CUSTOM_WIDTH_MIN, Math.round(numeric)),
  );
};

export const normalizeWideTimelineScale = (value) => {
  const numeric = Number(value);
  return WIDE_TIMELINE_SCALE_OPTIONS_HOURS.includes(numeric)
    ? numeric
    : WIDE_TIMELINE_DEFAULT_SCALE_HOURS;
};

export function resolveWideCompanionExpansionMax({
  panelTop,
  liveBottom,
  liveHeight,
} = {}) {
  const resolvedPanelTop = finiteNumber(panelTop);
  const resolvedLiveBottom = finiteNumber(liveBottom);
  const resolvedLiveHeight = Math.max(0, finiteNumber(liveHeight));
  if (resolvedPanelTop <= 0 || resolvedLiveBottom <= 0) return 0;

  const liveOverlap =
    resolvedLiveHeight * WIDE_COMPANION_LIVE_OVERLAP_RATIO;
  return Math.max(
    0,
    resolvedPanelTop - (resolvedLiveBottom - liveOverlap),
  );
}

export function resolveWideCompanionGridLayout({
  cameraCount,
  width,
  height,
  visibleHeight = 0,
  preferredColumns = 0,
  metadataHeight = WIDE_COMPANION_META_HEIGHT_PX,
  minimumCellWidth = WIDE_COMPANION_MIN_CELL_WIDTH_PX,
} = {}) {
  const configuredCount = Math.max(
    0,
    Math.floor(Number(cameraCount) || 0),
  );
  const count = configuredCount === 1 ? 2 : Math.max(1, configuredCount);
  const minimumColumns = count > 1 ? 2 : 1;
  const availableWidth = Math.max(0, Number(width) || 0);
  const availableHeight = Math.max(0, Number(height) || 0);
  const availableVisibleHeight = Math.max(0, Number(visibleHeight) || 0);
  const resolvedPreferredColumns = Math.max(
    0,
    Math.floor(Number(preferredColumns) || 0),
  );
  const resolvedMetaHeight = Math.max(
    0,
    Number(metadataHeight) || WIDE_COMPANION_META_HEIGHT_PX,
  );
  const resolvedMinimumCellWidth = Math.max(
    1,
    Number(minimumCellWidth) || WIDE_COMPANION_MIN_CELL_WIDTH_PX,
  );
  if (availableWidth <= 0) return { columns: 1, cellWidth: 0 };

  const candidates = [];
  for (let columns = minimumColumns; columns <= count; columns += 1) {
    const totalGapWidth = WIDE_COMPANION_GRID_GAP_PX * (columns - 1);
    const widthLimitedCellWidth = Math.max(
      0,
      (availableWidth - totalGapWidth) / columns,
    );
    const rows = Math.ceil(count / columns);
    const totalGapHeight = WIDE_COMPANION_GRID_GAP_PX * (rows - 1);
    candidates.push({
      columns,
      cellWidth: widthLimitedCellWidth,
      firstRowHeight:
        widthLimitedCellWidth * (9 / 16) + resolvedMetaHeight,
      contentHeight:
        rows * (widthLimitedCellWidth * (9 / 16) + resolvedMetaHeight) +
        totalGapHeight,
    });
  }

  const preferredCandidates = candidates.filter(
    ({ cellWidth }) => cellWidth >= resolvedMinimumCellWidth,
  );
  const preferredVisibleFitting = preferredCandidates.filter(
    ({ contentHeight, firstRowHeight }) =>
      (availableHeight <= 0 || contentHeight <= availableHeight + 0.5) &&
      (availableVisibleHeight <= 0 ||
        firstRowHeight <= availableVisibleHeight + 0.5),
  );
  const preferredFitting = preferredCandidates.filter(
    ({ contentHeight }) =>
      availableHeight <= 0 || contentHeight <= availableHeight + 0.5,
  );
  const fittingCandidates = candidates.filter(
    ({ contentHeight }) =>
      availableHeight <= 0 || contentHeight <= availableHeight + 0.5,
  );
  const preferredColumnLayout = preferredVisibleFitting.find(
    ({ columns }) => columns === resolvedPreferredColumns,
  );
  const bestLayout =
    preferredColumnLayout ||
    preferredVisibleFitting[0] ||
    preferredFitting[0] ||
    preferredCandidates.at(-1) ||
    fittingCandidates[0] ||
    candidates.at(-1);

  return {
    columns: bestLayout.columns,
    cellWidth: Math.floor(Math.max(1, bestLayout.cellWidth) * 10) / 10,
  };
}

export function resolveWideCompanionExpansionTarget({
  cameraCount,
  width,
  collapsedHeight,
  maxExpansion,
  metadataHeight = WIDE_COMPANION_META_HEIGHT_PX,
} = {}) {
  const count = Math.max(0, Math.floor(Number(cameraCount) || 0));
  const availableWidth = Math.max(0, finiteNumber(width));
  const baseHeight = Math.max(0, finiteNumber(collapsedHeight));
  const expansionLimit = Math.max(0, finiteNumber(maxExpansion));
  if (count === 0 || availableWidth <= 0 || expansionLimit <= 0) return 0;

  const resolvedMetadataHeight = Math.max(
    0,
    Number(metadataHeight) || WIDE_COMPANION_META_HEIGHT_PX,
  );
  const layout = resolveWideCompanionGridLayout({
    cameraCount: count,
    width: availableWidth,
    height: baseHeight + expansionLimit,
    metadataHeight: resolvedMetadataHeight,
  });
  const rows = Math.ceil(count / layout.columns);
  const contentHeight =
    rows * (layout.cellWidth * (9 / 16) + resolvedMetadataHeight) +
    WIDE_COMPANION_GRID_GAP_PX * Math.max(0, rows - 1);

  return Math.min(
    expansionLimit,
    Math.max(0, Math.ceil(contentHeight - baseHeight)),
  );
}
