import { CleanupController } from "../../shared/cleanup.js";
import { activateStandardPageRouteLifecycle } from "../navigation/route-lifecycle.js";
import {
  PAGE_START_MODES,
  normalizePageStartMode,
} from "../navigation/start-mode.js";
import { flattenCameraMembers } from "../camera-groups/model.js";

import {
  resolveWideCompanionExpansionMax,
  WIDE_COMPANION_GRID_GAP_PX,
  WIDE_COMPANION_LIVE_OVERLAP_RATIO,
  WIDE_COMPANION_META_HEIGHT_PX,
  WIDE_COMPANION_MIN_CELL_WIDTH_PX,
  WIDE_LEFT_RESIZE_FALLBACK_MAX,
  WIDE_LEFT_RESIZE_MIN,
  WIDE_VIEW_RIGHT_COLUMN_MIN_PX,
  WIDE_VIEW_WIDTH_IN_BETWEEN,
  normalizeWideViewWidth,
} from "./config.js";

const WIDE_LEFT_RESIZE_MAX = 100;

const positiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export function resolveWideLeftResizeMaxPct({
  layoutWidth,
  leftWidth,
  leftStylePct,
  companionHeight,
  companionHeaderHeight,
  liveWidth,
  liveHeight,
} = {}) {
  const layout = positiveNumber(layoutWidth);
  const left = positiveNumber(leftWidth);
  const styledPct = positiveNumber(leftStylePct);
  const panel = positiveNumber(companionHeight);
  const header = positiveNumber(companionHeaderHeight);
  const mediaWidth = positiveNumber(liveWidth);
  const mediaHeight = positiveNumber(liveHeight);
  if (!layout || !left) return WIDE_LEFT_RESIZE_FALLBACK_MAX;

  const currentPct = styledPct || (left / layout) * 100;
  if (!panel || !header || !mediaWidth || !mediaHeight) {
    return Math.max(currentPct, WIDE_LEFT_RESIZE_FALLBACK_MAX);
  }

  const collapsibleHeight = Math.max(0, panel - header);
  const liveHeightPerWidth = mediaHeight / mediaWidth;
  const boundaryLeftWidth =
    left + collapsibleHeight / liveHeightPerWidth;
  const renderedPixelsPerPct = styledPct ? left / styledPct : layout / 100;
  return Math.min(
    WIDE_LEFT_RESIZE_MAX,
    Math.max(currentPct, boundaryLeftWidth / renderedPixelsPerPct),
  );
}

export function resolveWideInitialWidthPct({
  configuredWidth,
  layoutWidth,
  handleWidth = 0,
  maximumWidthPct = WIDE_LEFT_RESIZE_FALLBACK_MAX,
  inBetweenWidthPct = 0,
} = {}) {
  const requestedPct = normalizeWideViewWidth(configuredWidth);
  if (requestedPct === WIDE_LEFT_RESIZE_MIN) return WIDE_LEFT_RESIZE_MIN;

  const layout = positiveNumber(layoutWidth);
  const handle = Math.max(0, Number(handleWidth) || 0);
  const columnSpace = Math.max(0, layout - handle);
  const rightColumnLimit = columnSpace
    ? ((columnSpace - WIDE_VIEW_RIGHT_COLUMN_MIN_PX) / columnSpace) * 100
    : WIDE_LEFT_RESIZE_FALLBACK_MAX;
  const initialLimit = Math.max(
    WIDE_LEFT_RESIZE_MIN,
    Math.min(
      WIDE_LEFT_RESIZE_MAX,
      positiveNumber(maximumWidthPct) || WIDE_LEFT_RESIZE_FALLBACK_MAX,
      rightColumnLimit,
    ),
  );
  if (requestedPct === WIDE_VIEW_WIDTH_IN_BETWEEN) {
    const measuredInBetween = positiveNumber(inBetweenWidthPct);
    const target =
      measuredInBetween || (WIDE_LEFT_RESIZE_MIN + initialLimit) / 2;
    return Math.max(
      WIDE_LEFT_RESIZE_MIN,
      Math.min(initialLimit, target),
    );
  }
  return initialLimit;
}

export function resolveWideOneRowLayout({
  cameraCount,
  columnSpaceWidth,
  columnHeight,
  maximumWidthPct,
  baseLeftWidth,
  liveWidth,
  liveHeight,
  gridWidth,
  gridHeight,
  expansionMax,
  metadataHeight = WIDE_COMPANION_META_HEIGHT_PX,
} = {}) {
  const count = Math.max(0, Math.floor(Number(cameraCount) || 0));
  const slotCount = count === 1 ? 2 : count;
  const columnSpace = positiveNumber(columnSpaceWidth);
  const availableColumnHeight = positiveNumber(columnHeight);
  const maximumPct = positiveNumber(maximumWidthPct);
  const baseLeft = positiveNumber(baseLeftWidth);
  const baseLiveWidth = positiveNumber(liveWidth);
  const baseLiveHeight = positiveNumber(liveHeight);
  const baseGridWidth = positiveNumber(gridWidth);
  const baseGridHeight = positiveNumber(gridHeight);
  const baseExpansionMax = Math.max(0, Number(expansionMax) || 0);
  const resolvedMetadataHeight = Math.max(
    0,
    Number(metadataHeight) || WIDE_COMPANION_META_HEIGHT_PX,
  );
  if (
    count === 0 ||
    !columnSpace ||
    !availableColumnHeight ||
    !maximumPct ||
    !baseLeft ||
    !baseLiveWidth ||
    !baseLiveHeight ||
    !baseGridWidth ||
    !baseGridHeight
  ) {
    return { widthPct: 0, columns: 0 };
  }

  const renderedPixelsPerPct = baseLeft / WIDE_LEFT_RESIZE_MIN;
  const minimumLeftWidth = renderedPixelsPerPct * WIDE_LEFT_RESIZE_MIN;
  const maximumLeftWidth = Math.min(
    columnSpace,
    renderedPixelsPerPct * maximumPct,
  );
  const liveWidthPerLeftWidth = baseLiveWidth / baseLeft;
  const liveHeightPerWidth = baseLiveHeight / baseLiveWidth;
  const gridHorizontalInset = Math.max(0, baseLeft - baseGridWidth);
  const fixedExpansionHeight = Math.max(
    0,
    baseExpansionMax -
      baseLiveHeight * WIDE_COMPANION_LIVE_OVERLAP_RATIO,
  );

  const preferredColumns = Math.min(
    slotCount,
    Math.max(
      slotCount > 1 ? 2 : 1,
      Math.ceil((columnSpace / availableColumnHeight) * 2),
    ),
  );

  for (let columns = preferredColumns; columns <= slotCount; columns += 1) {
    for (
      let candidateLeftWidth = Math.floor(maximumLeftWidth);
      candidateLeftWidth >= Math.ceil(minimumLeftWidth);
      candidateLeftWidth -= 1
    ) {
      const candidateLiveWidth = candidateLeftWidth * liveWidthPerLeftWidth;
      const candidateLiveHeight = candidateLiveWidth * liveHeightPerWidth;
      const candidateGridWidth = Math.max(
        1,
        candidateLeftWidth - gridHorizontalInset,
      );
      const candidateGridHeight =
        baseGridHeight - (candidateLiveHeight - baseLiveHeight);
      if (candidateGridHeight <= 0) continue;

      const candidateCellWidth =
        (candidateGridWidth -
          WIDE_COMPANION_GRID_GAP_PX * Math.max(0, columns - 1)) /
        columns;
      if (candidateCellWidth < WIDE_COMPANION_MIN_CELL_WIDTH_PX) continue;

      const firstRowHeight =
        candidateCellWidth * (9 / 16) + resolvedMetadataHeight;
      if (firstRowHeight > candidateGridHeight + 0.5) continue;

      const rows = Math.ceil(slotCount / columns);
      const contentHeight =
        rows * firstRowHeight +
        WIDE_COMPANION_GRID_GAP_PX * Math.max(0, rows - 1);
      const candidateExpansionMax =
        fixedExpansionHeight +
        candidateLiveHeight * WIDE_COMPANION_LIVE_OVERLAP_RATIO;
      if (
        contentHeight >
        candidateGridHeight + candidateExpansionMax + 0.5
      ) {
        continue;
      }

      return {
        widthPct: candidateLeftWidth / renderedPixelsPerPct,
        columns,
      };
    }
  }

  return {
    widthPct: WIDE_LEFT_RESIZE_MIN,
    columns: preferredColumns,
  };
}

export function resolveWideOneRowWidthPct(options = {}) {
  return resolveWideOneRowLayout(options).widthPct;
}

export class WideViewPageController {
  constructor(host, constants, options = {}) {
    this._host = host;
    this._constants = constants;
    this._companionController = options.companionController || null;
    this._timelineController = options.timelineController || null;
    this._documentTarget = options.documentTarget ?? globalThis.document ?? null;
    this._windowTarget = options.windowTarget ?? globalThis.window ?? null;
    this._requestFrame =
      options.requestFrame ||
      ((callback) => {
        if (typeof globalThis.requestAnimationFrame !== "function") {
          callback();
          return null;
        }
        return globalThis.requestAnimationFrame(callback);
      });
    this._supportsDeferredLayout =
      typeof options.requestFrame === "function" ||
      typeof globalThis.requestAnimationFrame === "function";
    this._cancelFrame =
      options.cancelFrame ||
      ((frameId) => globalThis.cancelAnimationFrame?.(frameId));
    this._ResizeObserver = options.resizeObserverCtor;
    this._resizeHandleCleanup = null;
    this._resizeDragCleanup = null;
    this._resizeDragState = null;
    this._syncColHeightFrame = null;
    this._settledLayoutFrame = null;
    this._columnResizeObserver = null;
    this._columnResizeTarget = null;
    this._startModeApplied = false;
    this._awaitingInitialCompanionLayout = false;
  }

  activateWideViewPageRoute(context = {}) {
    this._startModeApplied = false;
    this._awaitingInitialCompanionLayout = true;
    const routeContext = {
      ...context,
      startInGrid:
        context.startInGrid === true ||
        (normalizePageStartMode(
          this._host._config?.wide_view_start_mode,
        ) === PAGE_START_MODES.grid &&
          this._host._isGridModeAvailable?.() === true),
    };
    activateStandardPageRouteLifecycle({
      host: this._host,
      context: routeContext,
      previewPageId: this._constants.PAGE_IDS.preview,
      applyRouteFrame: () => this._applyWideViewRouteFrame(),
    });
    this.applyConfiguredStartMode({
      mode: routeContext.startInGrid ? PAGE_START_MODES.grid : null,
      gridAvailable: routeContext.startInGrid,
    });
    this.startWideViewMode();
    this.scheduleSettledLayoutReflow();
  }

  applyConfiguredStartMode({
    force = false,
    mode = null,
    gridAvailable = null,
  } = {}) {
    if (!this.isWideViewPageActive()) return false;
    if (this._startModeApplied && !force) return false;
    this._startModeApplied = true;

    const configuredMode = normalizePageStartMode(
      mode ?? this._host._config?.wide_view_start_mode,
    );
    const startGrid =
      configuredMode === PAGE_START_MODES.grid &&
      (gridAvailable ?? this._host._isGridModeAvailable?.() === true);
    const startSlideshow =
      configuredMode === PAGE_START_MODES.slideshow &&
      this._host._slideshowPageController?.available?.() === true;

    if (startGrid) {
      if (this._host._slideshowActive === true) {
        this._host._slideshowPageController?.stop?.(
          "wide-view-start-grid",
          false,
        );
      }
      if (this._host._viewMode !== "grid") {
        this._host._setViewMode?.("grid");
      }
      return true;
    }

    if (this._host._viewMode === "grid") {
      this._host._setViewMode?.("single");
    }
    if (startSlideshow) {
      if (this._host._slideshowActive !== true) {
        this._host._slideshowPageController?.start?.("wide-view-start");
      }
      return true;
    }
    if (this._host._slideshowActive === true) {
      this._host._slideshowPageController?.stop?.("wide-view-start-live");
    }
    return true;
  }

  applyPageConfigUpdate({ startModeChanged = false } = {}) {
    if (!startModeChanged || !this.isWideViewPageActive()) return;
    this._startModeApplied = false;
    this.applyConfiguredStartMode({ force: true });
  }

  buildCompanionRegionMarkup() {
    return this._companionController?.buildRegionMarkup?.() || "";
  }

  renderCompanionCameras() {
    this._companionController?.render?.();
  }

  buildTimelineRegionMarkup() {
    return this._timelineController?.buildRegionMarkup?.() || "";
  }

  bindTimeline() {
    if (!this.isWideViewPageActive()) return;
    this._timelineController?.bind?.();
  }

  renderTimeline(options = {}) {
    if (!this.isWideViewPageActive()) return;
    if (typeof this._timelineController?.scheduleRender === "function") {
      this._timelineController.scheduleRender(options);
      return;
    }
    this._timelineController?.render?.(options);
  }

  teardownTimeline(options = {}) {
    this._timelineController?.teardown?.(options);
  }

  handleTimelineClick(event, target) {
    if (!this.isWideViewPageActive()) return false;
    return this._timelineController?.handleClick?.(event, target) === true;
  }

  applyTimelineConfigUpdate(options = {}) {
    this._timelineController?.applyConfigUpdate?.(options);
  }

  teardownCompanionMedia() {
    this._companionController?.teardownMedia?.();
  }

  startCompanionMode() {
    this._companionController?.start?.();
    void this._host._browseWindowLoaderController?.warmVisibleCameraReviews?.();
  }

  startWideViewMode() {
    this.startCompanionMode();
    this.bindTimeline();
  }

  resumeCompanionMedia() {
    this._companionController?.resumeVisible?.();
  }

  stopCompanionMode() {
    this._companionController?.stop?.();
  }

  stopWideViewMode() {
    this._awaitingInitialCompanionLayout = false;
    this._cancelSettledLayoutReflow();
    this._cancelResizeDrag();
    this._disconnectColumnResizeObserver();
    this.stopCompanionMode();
    this.teardownTimeline({ preserveScroll: true });
  }

  dispose() {
    this.stopWideViewMode();
    this.disconnectResizeHandle();
  }

  disconnectResizeHandle() {
    this._disposeResizeHandle();
    this._cancelSettledLayoutReflow();
    this._cancelSyncColHeight();
    this._disconnectColumnResizeObserver();
  }

  handleCompanionRealtimeMessage(msg) {
    this._companionController?.handleRealtimeMessage?.(msg);
  }

  handleCompanionHaReviewStatus(entity, severity) {
    return (
      this._companionController?.handleHaReviewStatus?.(entity, severity) ===
      true
    );
  }

  handleCompanionHassUpdate() {
    this._companionController?.handleHassUpdate?.();
  }

  applyCompanionConfigUpdate(options = {}) {
    this._companionController?.applyConfigUpdate?.(options);
  }

  companionLiveCamerasEnabled() {
    return this._companionController?.liveCamerasEnabled?.() === true;
  }

  companionAlertTakeoverEnabled() {
    return this._companionController?.alertTakeoverEnabled?.() === true;
  }

  toggleCompanionAlertTakeover() {
    return this._companionController?.toggleAlertTakeover?.() === true;
  }

  selectCompanionCamera(index) {
    this._companionController?.selectCamera?.(index);
  }

  _applyWideViewRouteFrame() {
    this._host._applyPreviewShellVisibility();
    this.applyStyleLayoutAndWideSyncForCard();
  }

  applyStyleLayoutForCard() {
    this._host._applyCardStyle();
    this.applyLayoutModeForCard();
  }

  applyLayoutAndWideSyncForCard() {
    this.applyLayoutModeForCard();
    this.syncColHeightIfWideView();
  }

  applyStyleLayoutAndWideSyncForCard() {
    this.applyStyleLayoutForCard();
    this.syncColHeightIfWideView();
  }

  applyLayoutModeForCard() {
    const layout = this._host.shadowRoot?.querySelector("#layout");
    if (!layout) return;
    this.applyWideLayoutMode(layout, this._host._config?.wide_view_width);
  }

  reflowColumnsForResize() {
    if (!this.isWideViewPageActive()) return false;
    this.applyLayoutModeForCard();
    return true;
  }

  scheduleSettledLayoutReflow() {
    if (!this.isWideViewPageActive() || !this._supportsDeferredLayout) {
      return false;
    }
    this._cancelSettledLayoutReflow();

    const requestFrame = (callback) => {
      this._settledLayoutFrame = true;
      const frameId = this._requestFrame(() => {
        this._settledLayoutFrame = null;
        callback();
      });
      if (this._settledLayoutFrame !== null) {
        this._settledLayoutFrame = frameId;
      }
    };

    requestFrame(() => {
      if (!this.isWideViewPageActive()) return;
      requestFrame(() => {
        if (!this.isWideViewPageActive()) return;
        // HA can finish sizing Sidebar and Panel wrappers after the route
        // first paints. Re-measure once that layout has settled.
        this.applyStyleLayoutAndWideSyncForCard();
      });
    });
    return true;
  }

  notifyCompanionLayoutReady() {
    if (
      !this._awaitingInitialCompanionLayout ||
      !this.isWideViewPageActive()
    ) {
      return false;
    }
    this._awaitingInitialCompanionLayout = false;
    return this.scheduleSettledLayoutReflow();
  }

  syncColHeightIfWideView() {
    if (!this.isWideViewPageActive()) return;
    this.syncColHeight();
  }

  syncColHeight() {
    this.syncToolbarPanelPlacement();
    const l = this._host.shadowRoot?.querySelector(".col-left");
    const r = this._host.shadowRoot?.querySelector(".col-right");
    if (!l || !r) return;

    const ResizeObserverCtor =
      this._ResizeObserver !== undefined
        ? this._ResizeObserver
        : l.ownerDocument?.defaultView?.ResizeObserver ||
          globalThis.ResizeObserver;
    if (typeof ResizeObserverCtor === "function") {
      if (l !== this._columnResizeTarget) {
        this._disconnectColumnResizeObserver();
        this._columnResizeTarget = l;
        this._columnResizeObserver = new ResizeObserverCtor((entries) => {
          const entry =
            entries.find?.(({ target }) => target === l) || entries[0];
          const borderBox = Array.isArray(entry?.borderBoxSize)
            ? entry.borderBoxSize[0]
            : entry?.borderBoxSize;
          const height = Number(
            borderBox?.blockSize ?? entry?.contentRect?.height ?? 0,
          );
          const currentRight =
            this._host.shadowRoot?.querySelector(".col-right");
          if (height > 0 && currentRight) {
            currentRight.style.maxHeight = `${height}px`;
          }
        });
        this._columnResizeObserver.observe(l);
      }
      return;
    }

    if (this._syncColHeightFrame !== null) return;
    this._syncColHeightFrame = true;
    const frameId = this._requestFrame(() => {
      this._syncColHeightFrame = null;
      this._companionController?.updateLayout?.();
      const h = l.offsetHeight;
      if (h > 0) r.style.maxHeight = h + "px";
    });
    if (this._syncColHeightFrame !== null) {
      this._syncColHeightFrame = frameId;
    }
  }

  scheduleToolbarPanelPlacement() {
    if (!this.isWideViewPageActive()) return false;
    this._requestFrame(() => this.syncToolbarPanelPlacement());
    return true;
  }

  syncToolbarPanelPlacement() {
    const panels = [
      this._host._pageShellRegion?.("filterPanel"),
      this._host._pageShellRegion?.("calendarPanel"),
    ].filter(Boolean);
    for (const panel of panels) {
      panel.classList.remove("wide-toolbar-panel--above");
      panel.style.removeProperty("--wide-toolbar-panel-space");
    }
    if (!this.isWideViewPageActive()) return false;

    const layout = this._host._$?.("#layout");
    const layoutRect = layout?.getBoundingClientRect?.();
    if (!layoutRect) return false;

    const viewportHeight = Number(
      layout.ownerDocument?.defaultView?.innerHeight ??
        this._windowTarget?.innerHeight,
    );
    const visibleTop = Math.max(0, layoutRect.top);
    const visibleBottom = Math.min(
      layoutRect.bottom,
      Number.isFinite(viewportHeight) && viewportHeight > 0
        ? viewportHeight
        : layoutRect.bottom,
    );
    let positioned = false;

    for (const panel of panels) {
      if (panel.hidden || panel.style.display === "none") continue;
      const panelRect = panel.getBoundingClientRect();
      const anchorRect = panel.parentElement?.getBoundingClientRect?.();
      if (!anchorRect) continue;
      const belowSpace = Math.max(0, visibleBottom - panelRect.top);
      const aboveSpace = Math.max(0, anchorRect.top - visibleTop - 4);
      const opensAbove =
        panelRect.height > belowSpace + 0.5 && aboveSpace > belowSpace;
      panel.classList.toggle("wide-toolbar-panel--above", opensAbove);
      panel.style.setProperty(
        "--wide-toolbar-panel-space",
        `${Math.floor(opensAbove ? aboveSpace : belowSpace)}px`,
      );
      positioned = true;
    }
    return positioned;
  }

  isWideViewPageActive() {
    return this._host._pageId === this._constants.PAGE_IDS.wideView;
  }

  wideViewLayoutState(wideViewWidth) {
    if (!this.isWideViewPageActive()) {
      return { isWide: false, leftWidth: "", rightWidth: "" };
    }

    const pct = normalizeWideViewWidth(wideViewWidth);
    return {
      isWide: true,
      leftWidth: `${pct}%`,
      rightWidth: `${100 - pct}%`,
    };
  }

  _setColumnWidths(colL, colR, pct) {
    colL.style.width = `${pct}%`;
    colR.style.width = `${100 - pct}%`;
  }

  _measureWideLeftResizeMaxPct(layout, colL, leftStylePct) {
    const columns = layout.querySelector?.(".wide-view-columns") || layout;
    const handle = layout.querySelector?.("#resize-handle");
    const layoutWidth = Number(columns.getBoundingClientRect?.().width) || 0;
    const handleWidth = Number(handle?.getBoundingClientRect?.().width) || 0;
    const columnSpaceWidth = Math.max(0, layoutWidth - handleWidth);
    const leftRect = colL.getBoundingClientRect?.() || null;
    const leftWidth = Number(leftRect?.width) || 0;
    const companionPanel = colL.querySelector?.("#wide-companion-panel");
    const companionHeader = companionPanel?.querySelector?.(
      ".wide-companion-header",
    );
    const companionGrid = companionPanel?.querySelector?.(
      "#wide-companion-grid",
    );
    const companionMeta = companionGrid?.querySelector?.(
      ".wide-companion-meta",
    );
    const liveWrap = colL.querySelector?.("#eng-wrap");
    const companionPanelRect =
      companionPanel?.getBoundingClientRect?.() || null;
    const companionGridRect =
      companionGrid?.getBoundingClientRect?.() || null;
    const liveRect = liveWrap?.getBoundingClientRect?.() || null;
    return {
      layoutWidth,
      handleWidth,
      columnSpaceWidth,
      leftWidth,
      columnHeight: Number(leftRect?.height) || 0,
      liveWidth: liveRect?.width || 0,
      liveHeight: liveRect?.height || 0,
      companionGridWidth: companionGridRect?.width || 0,
      companionGridHeight: companionGridRect?.height || 0,
      companionMetaHeight:
        companionMeta?.getBoundingClientRect?.().height ||
        companionMeta?.offsetHeight ||
        WIDE_COMPANION_META_HEIGHT_PX,
      companionExpansionMax: resolveWideCompanionExpansionMax({
        panelTop: companionPanelRect?.top,
        liveBottom: liveRect?.bottom,
        liveHeight: liveRect?.height,
      }),
      maximumWidthPct: resolveWideLeftResizeMaxPct({
        layoutWidth: columnSpaceWidth,
        leftWidth,
        leftStylePct,
        companionHeight: companionPanelRect?.height,
        companionHeaderHeight:
          companionHeader?.getBoundingClientRect?.().height,
        liveWidth: liveRect?.width,
        liveHeight: liveRect?.height,
      }),
    };
  }

  applyWideLayoutMode(layout, wideViewWidth) {
    if (!layout) return;

    const wideLayout = this.wideViewLayoutState(wideViewWidth);
    layout.classList.toggle("wide-view", wideLayout.isWide);

    const colL = layout.querySelector(".col-left");
    const colR = layout.querySelector(".col-right");
    if (colL && colR) {
      if (wideLayout.isWide) {
        const configuredWidth = normalizeWideViewWidth(wideViewWidth);
        this._setColumnWidths(
          colL,
          colR,
          Math.min(configuredWidth, WIDE_LEFT_RESIZE_MIN),
        );
        const measurements = this._measureWideLeftResizeMaxPct(
          layout,
          colL,
          WIDE_LEFT_RESIZE_MIN,
        );
        const maximumInitialWidthPct = resolveWideInitialWidthPct({
          configuredWidth: 100,
          layoutWidth: measurements.layoutWidth,
          handleWidth: measurements.handleWidth,
          maximumWidthPct: measurements.maximumWidthPct,
        });
        const usesManagedWideLayout =
          this._host._cardStyleController?.isPanelView?.() === true ||
          this._host._cardStyleController?.isSidebarView?.() === true;
        const companionGrid = colL.querySelector?.("#wide-companion-grid");
        const oneRowLayout =
          usesManagedWideLayout &&
          configuredWidth === WIDE_VIEW_WIDTH_IN_BETWEEN
            ? resolveWideOneRowLayout({
                cameraCount: flattenCameraMembers(
                  this._host._config?.cameras,
                ).length,
                columnSpaceWidth: measurements.columnSpaceWidth,
                columnHeight: measurements.columnHeight,
                maximumWidthPct: maximumInitialWidthPct,
                baseLeftWidth: measurements.leftWidth,
                liveWidth: measurements.liveWidth,
                liveHeight: measurements.liveHeight,
                gridWidth: measurements.companionGridWidth,
                gridHeight: measurements.companionGridHeight,
                expansionMax: measurements.companionExpansionMax,
                metadataHeight: measurements.companionMetaHeight,
              })
            : { widthPct: 0, columns: 0 };
        if (companionGrid?.dataset) {
          if (oneRowLayout.columns > 0) {
            companionGrid.dataset.wideCompanionPreferredColumns = String(
              oneRowLayout.columns,
            );
          } else {
            delete companionGrid.dataset.wideCompanionPreferredColumns;
          }
        }
        const initialWidthPct = resolveWideInitialWidthPct({
          configuredWidth,
          layoutWidth: measurements.layoutWidth,
          handleWidth: measurements.handleWidth,
          maximumWidthPct: measurements.maximumWidthPct,
          inBetweenWidthPct: oneRowLayout.widthPct,
        });
        this._setColumnWidths(colL, colR, initialWidthPct);
        this._companionController?.updateLayout?.();
      } else {
        colL.style.width = "";
        colR.style.width = "";
      }
    }
  }

  initResizeHandle() {
    this._disposeResizeHandle();
    const handle = this._host._$("#resize-handle");
    if (!handle) return;
    const cleanup = new CleanupController();
    this._resizeHandleCleanup = cleanup;
    cleanup.addEventListener(handle, "mousedown", (event) => {
      event.preventDefault();
      this._startResizeDrag(event, handle);
    });
  }

  _startResizeDrag(event, handle) {
    this._cancelResizeDrag();
    const layout = this._host._$("#layout");
    const colL = this._host._$(".col-left");
    const colR = this._host._$(".col-right");
    if (!layout || !colL || !colR) return;
    const columns = layout.querySelector?.(".wide-view-columns") || layout;
    const layoutWidth = Number(columns.getBoundingClientRect?.().width) || 0;
    const handleWidth = Number(handle.getBoundingClientRect?.().width) || 0;
    const columnSpaceWidth = Math.max(0, layoutWidth - handleWidth);
    const startLeftWidth = Number(colL.getBoundingClientRect?.().width) || 0;
    if (columnSpaceWidth <= 0) return;

    const { maximumWidthPct: maxPct } = this._measureWideLeftResizeMaxPct(
      layout,
      colL,
      Number.parseFloat(colL.style?.width),
    );

    const documentTarget = handle.ownerDocument || this._documentTarget;
    const windowTarget = documentTarget?.defaultView || this._windowTarget;
    const cleanup = new CleanupController();
    this._resizeDragCleanup = cleanup;
    this._resizeDragState = {
      startX: Number(event.clientX) || 0,
      startLeftWidth,
      columnSpaceWidth,
      maxPct,
      colL,
      colR,
      handle,
    };
    handle.classList.add("active");

    cleanup.addEventListener(documentTarget, "mousemove", (moveEvent) => {
      const state = this._resizeDragState;
      if (!state) return;
      const minPct = WIDE_LEFT_RESIZE_MIN;
      const dx = (Number(moveEvent.clientX) || 0) - state.startX;
      const newLeftWidth = state.startLeftWidth + dx;
      let pct = (newLeftWidth / state.columnSpaceWidth) * 100;
      pct = Math.max(minPct, Math.min(state.maxPct, pct));
      state.colL.style.width = pct + "%";
      state.colR.style.width = 100 - pct + "%";
      this.syncColHeight();
    });
    const cancelDrag = () => this._cancelResizeDrag();
    cleanup.addEventListener(documentTarget, "mouseup", cancelDrag);
    cleanup.addEventListener(documentTarget, "mouseleave", cancelDrag);
    cleanup.addEventListener(documentTarget, "pointercancel", cancelDrag);
    cleanup.addEventListener(windowTarget, "blur", cancelDrag);
  }

  _cancelResizeDrag() {
    const state = this._resizeDragState;
    const cleanup = this._resizeDragCleanup;
    this._resizeDragState = null;
    this._resizeDragCleanup = null;
    state?.handle?.classList?.remove?.("active");
    cleanup?.dispose();
  }

  _disposeResizeHandle() {
    this._cancelResizeDrag();
    this._resizeHandleCleanup?.dispose();
    this._resizeHandleCleanup = null;
  }

  _cancelSyncColHeight() {
    const frameId = this._syncColHeightFrame;
    this._syncColHeightFrame = null;
    if (frameId === null || frameId === true || frameId === undefined) return;
    this._cancelFrame(frameId);
  }

  _cancelSettledLayoutReflow() {
    const frameId = this._settledLayoutFrame;
    this._settledLayoutFrame = null;
    if (frameId === null || frameId === true || frameId === undefined) return;
    this._cancelFrame(frameId);
  }

  _disconnectColumnResizeObserver() {
    this._columnResizeObserver?.disconnect?.();
    this._columnResizeObserver = null;
    this._columnResizeTarget = null;
  }
}
