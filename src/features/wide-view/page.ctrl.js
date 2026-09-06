import { CleanupController } from "../../shared/cleanup.js";
import { activateStandardPageRouteLifecycle } from "../navigation/route-lifecycle.js";

import {
  WIDE_LEFT_WIDTH_MAX,
  WIDE_LEFT_WIDTH_MIN,
  normalizeWideLeftWidth,
} from "./config.js";

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
    this._cancelFrame =
      options.cancelFrame ||
      ((frameId) => globalThis.cancelAnimationFrame?.(frameId));
    this._resizeHandleCleanup = null;
    this._resizeDragCleanup = null;
    this._resizeDragState = null;
    this._syncColHeightFrame = null;
  }

  activateWideViewPageRoute(context = {}) {
    activateStandardPageRouteLifecycle({
      host: this._host,
      context,
      previewPageId: this._constants.PAGE_IDS.preview,
      applyRouteFrame: () => this._applyWideViewRouteFrame(),
    });
    this.startWideViewMode();
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
    this._cancelResizeDrag();
    this.stopCompanionMode();
    this.teardownTimeline({ preserveScroll: true });
  }

  dispose() {
    this.stopWideViewMode();
    this.disconnectResizeHandle();
  }

  disconnectResizeHandle() {
    this._disposeResizeHandle();
    this._cancelSyncColHeight();
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
    this.applyWideLayoutMode(layout, this._host._config?.col_left_width_pct);
  }

  syncColHeightIfWideView() {
    if (!this.isWideViewPageActive()) return;
    this.syncColHeight();
  }

  syncColHeight() {
    if (this._syncColHeightFrame !== null) return;
    this._syncColHeightFrame = true;
    const frameId = this._requestFrame(() => {
      this._syncColHeightFrame = null;
      this._companionController?.updateLayout?.();
      const l = this._host.shadowRoot?.querySelector(".col-left");
      const r = this._host.shadowRoot?.querySelector(".col-right");
      if (!l || !r) return;
      const h = l.offsetHeight;
      if (h > 0) r.style.maxHeight = h + "px";
    });
    if (this._syncColHeightFrame !== null) {
      this._syncColHeightFrame = frameId;
    }
  }

  isWideViewPageActive() {
    return this._host._pageId === this._constants.PAGE_IDS.wideView;
  }

  wideViewLayoutState(leftWidthPct) {
    if (!this.isWideViewPageActive()) {
      return { isWide: false, leftWidth: "", rightWidth: "" };
    }

    const pct = normalizeWideLeftWidth(leftWidthPct);
    return {
      isWide: true,
      leftWidth: `${pct}%`,
      rightWidth: `${100 - pct}%`,
    };
  }

  applyWideLayoutMode(layout, leftWidthPct) {
    if (!layout) return;

    const wideLayout = this.wideViewLayoutState(leftWidthPct);
    layout.classList.toggle("wide-view", wideLayout.isWide);

    const colL = layout.querySelector(".col-left");
    const colR = layout.querySelector(".col-right");
    if (colL && colR) {
      if (wideLayout.isWide) {
        colL.style.width = wideLayout.leftWidth;
        colR.style.width = wideLayout.rightWidth;
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
    const layoutWidth = Number(layout.getBoundingClientRect?.().width) || 0;
    const startLeftWidth = Number(colL.getBoundingClientRect?.().width) || 0;
    if (layoutWidth <= 0) return;

    const documentTarget = handle.ownerDocument || this._documentTarget;
    const windowTarget = documentTarget?.defaultView || this._windowTarget;
    const cleanup = new CleanupController();
    this._resizeDragCleanup = cleanup;
    this._resizeDragState = {
      startX: Number(event.clientX) || 0,
      startLeftWidth,
      layoutWidth,
      colL,
      colR,
      handle,
    };
    handle.classList.add("active");

    cleanup.addEventListener(documentTarget, "mousemove", (moveEvent) => {
      const state = this._resizeDragState;
      if (!state) return;
      const minPct = WIDE_LEFT_WIDTH_MIN;
      const maxPct = WIDE_LEFT_WIDTH_MAX;
      const dx = (Number(moveEvent.clientX) || 0) - state.startX;
      const newLeftWidth = state.startLeftWidth + dx;
      let pct = (newLeftWidth / state.layoutWidth) * 100;
      pct = Math.max(minPct, Math.min(maxPct, pct));
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
}
