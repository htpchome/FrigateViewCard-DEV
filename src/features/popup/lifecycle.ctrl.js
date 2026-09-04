import { PopupDragController } from "./drag.ctrl.js";
import {
  isCardViewDrawerPopupPresentation,
  POPUP_PRESENTATION_CARD_VIEW_DRAWER,
} from "./media.js";

const POPUP_SHELL_MIN_ANCHOR_WIDTH = 16;

const readRect = (element) => {
  const rect = element?.getBoundingClientRect?.();
  if (!rect) return null;
  const left = Number(rect.left);
  const right = Number(rect.right);
  const width = Number(rect.width);
  if (![left, right, width].every(Number.isFinite) || width <= 0) return null;
  return { left, right, width };
};

export const resolvePopupShellGeometry = ({ card = null, anchor = null } = {}) => {
  const cardRect = readRect(card);
  const anchorRect = readRect(anchor);
  if (!cardRect || !anchorRect || cardRect.width <= 0) return null;

  const clientLeft = Math.max(0, Number(card?.clientLeft) || 0);
  const clientWidth = Number(card?.clientWidth);
  const containingLeft = cardRect.left + clientLeft;
  const containingWidth =
    Number.isFinite(clientWidth) && clientWidth > 0
      ? clientWidth
      : cardRect.width;
  const cardRight = containingLeft + containingWidth;
  const visibleLeft = Math.max(containingLeft, anchorRect.left);
  const visibleRight = Math.min(cardRight, anchorRect.right);
  const width = visibleRight - visibleLeft;
  if (width < POPUP_SHELL_MIN_ANCHOR_WIDTH) return null;

  return {
    left: visibleLeft - containingLeft,
    width,
  };
};

export const resolvePopupStageGeometry = ({ card = null, stage = null } = {}) => {
  const horizontal = resolvePopupShellGeometry({ card, anchor: stage });
  const cardRect = card?.getBoundingClientRect?.();
  const stageRect = stage?.getBoundingClientRect?.();
  if (!horizontal || !cardRect || !stageRect) return null;

  const cardTop = Number(cardRect.top);
  const cardHeight = Number(cardRect.height);
  const stageTop = Number(stageRect.top);
  const stageBottom = Number(stageRect.bottom);
  const stageHeight = Number(stageRect.height);
  if (
    ![cardTop, cardHeight, stageTop, stageBottom, stageHeight].every(
      Number.isFinite,
    ) ||
    cardHeight <= 0 ||
    stageHeight <= 0
  ) {
    return null;
  }

  const clientTop = Math.max(0, Number(card?.clientTop) || 0);
  const clientHeight = Number(card?.clientHeight);
  const containingTop = cardTop + clientTop;
  const containingHeight =
    Number.isFinite(clientHeight) && clientHeight > 0
      ? clientHeight
      : cardHeight;
  const cardBottom = containingTop + containingHeight;
  const visibleTop = Math.max(containingTop, stageTop);
  const visibleBottom = Math.min(cardBottom, stageBottom);
  const height = visibleBottom - visibleTop;
  if (height <= 0) return null;

  return {
    ...horizontal,
    top: visibleTop - containingTop,
    height,
  };
};

export class PopupLifecycleController {
  constructor({
    query,
    isFirefox = () => false,
    onPauseSlideshow = () => {},
    onResumeSlideshow = () => {},
    onSetLiveCovered = () => {},
    onMuteLive = () => {},
    onSyncFullscreen = () => {},
    onSyncPictureInPicture = () => {},
    onScheduleOverlay = () => {},
    onReleasePlaybackTarget = () => {},
    onClearPictureInPicture = () => {},
    onClearVideoZoom = () => {},
    onDisposeCarousel = () => {},
    onClearCarousel = () => {},
    onDisposeMediaControls = () => {},
    onHideInfo = () => {},
    onClearMediaTransport = () => {},
    eventTarget = globalThis.document,
    createDragController = (options) => new PopupDragController(options),
    setTimer = globalThis.setTimeout?.bind(globalThis),
    clearTimer = globalThis.clearTimeout?.bind(globalThis),
    sourceDropDelayMs = 1200,
  } = {}) {
    this._query = query;
    this._isFirefox = isFirefox;
    this._onPauseSlideshow = onPauseSlideshow;
    this._onResumeSlideshow = onResumeSlideshow;
    this._onSetLiveCovered = onSetLiveCovered;
    this._onMuteLive = onMuteLive;
    this._onSyncFullscreen = onSyncFullscreen;
    this._onSyncPictureInPicture = onSyncPictureInPicture;
    this._onScheduleOverlay = onScheduleOverlay;
    this._onReleasePlaybackTarget = onReleasePlaybackTarget;
    this._onClearPictureInPicture = onClearPictureInPicture;
    this._onClearVideoZoom = onClearVideoZoom;
    this._onDisposeCarousel = onDisposeCarousel;
    this._onClearCarousel = onClearCarousel;
    this._onDisposeMediaControls = onDisposeMediaControls;
    this._onHideInfo = onHideInfo;
    this._onClearMediaTransport = onClearMediaTransport;
    this._eventTarget = eventTarget;
    this._createDragController = createDragController;
    this._setTimer = setTimer;
    this._clearTimer = clearTimer;
    this._sourceDropDelayMs = Math.max(0, Number(sourceDropDelayMs) || 0);
    this._dragController = null;
    this._mediaCleanup = null;
    this._mediaStopTimer = null;
    this._mediaType = "";
    this._playing = null;
    this._mediaCamera = "";
    this._compact = false;
    this._presentation = "";
  }

  setMediaState({ mediaType = "", playing = null } = {}) {
    this._mediaType = String(mediaType || "");
    this._playing = playing;
  }

  mediaType() {
    return this._mediaType;
  }

  playing() {
    return this._playing;
  }

  setMediaCamera(camera = "") {
    this._mediaCamera = String(camera || "");
  }

  mediaCamera() {
    return this._mediaCamera;
  }

  setCompact(compact = false) {
    this._compact = compact === true;
    this._query?.("#myPopup")?.classList?.toggle?.(
      "popup-content--compact",
      this._compact,
    );
  }

  isCompact() {
    return this._compact;
  }

  setPresentation(presentation = "") {
    const nextPresentation = isCardViewDrawerPopupPresentation(presentation)
      ? POPUP_PRESENTATION_CARD_VIEW_DRAWER
      : "";
    if (!nextPresentation) this.resetCardViewDrawerMediaHeight();
    this._presentation = nextPresentation;
    const popup = this._query?.("#myPopup");
    popup?.classList?.toggle?.(
      "popup-content--card-view-drawer",
      this._presentation === POPUP_PRESENTATION_CARD_VIEW_DRAWER,
    );
    const resizeHost = this._query?.("#popup-card-view-resize-host");
    if (resizeHost) resizeHost.hidden = !this._presentation;
    this._syncShellGeometry(popup);
  }

  presentation() {
    return this._presentation;
  }

  setCardViewDrawerMediaHeight(height = 0) {
    const livePanel = this._query?.(".card-view-live-panel");
    if (!livePanel?.style) return false;
    const nextHeight = Number(height);
    if (
      !isCardViewDrawerPopupPresentation(this._presentation) ||
      !Number.isFinite(nextHeight) ||
      nextHeight <= 0
    ) {
      livePanel.style.removeProperty?.(
        "--popup-card-view-media-height",
      );
      return false;
    }
    livePanel.style.setProperty?.(
      "--popup-card-view-media-height",
      `${Math.ceil(nextHeight)}px`,
    );
    return true;
  }

  resetCardViewDrawerMediaHeight() {
    this._query?.(".card-view-live-panel")?.style?.removeProperty?.(
      "--popup-card-view-media-height",
    );
  }

  syncShellGeometry() {
    const popup = this._query?.("#myPopup");
    if (!popup) return false;
    this._syncShellGeometry(popup);
    return true;
  }

  enter() {
    const viewer = this._query?.("#viewer");
    if (viewer) viewer.style.display = "flex";
    return this.open();
  }

  open() {
    const popup = this._query?.("#myPopup");
    if (!popup) return false;
    this._syncShellGeometry(popup);
    this._onPauseSlideshow();
    popup.classList.add("is-open");
    popup.style.transform = this._compact
      ? "translate(-50%, 0)"
      : "translateY(0)";
    const body = popup.querySelector?.(".popup-body");
    if (body) body.scrollTop = 0;
    this._onSetLiveCovered(true);
    this._onMuteLive(true, { source: "popup-open" });
    this._syncGlobalUi();
    return true;
  }

  close() {
    this._onReleasePlaybackTarget("popup");
    this.resetCardViewDrawerMediaHeight();
    const popup = this._query?.("#myPopup");
    if (!popup) return false;
    popup.classList.remove("is-open");
    popup.style.transform = this._compact
      ? "translate(-50%, 100%)"
      : "translateY(100%)";
    this._onSetLiveCovered(false);
    this._onMuteLive(true, { source: "popup-close" });
    this._syncGlobalUi();
    this.stopMedia();
    this._onResumeSlideshow();
    return true;
  }

  bindInteractions() {
    const popup = this._query?.("#myPopup");
    if (!popup) return null;
    this._disposeDrag();
    this._dragController = this._createDragController({
      popup,
      eventTarget: this._eventTarget,
      closeThreshold: 100,
      closePopup: () => this.close(),
      isPopupOpen: () => popup.classList.contains("is-open"),
    });
    this._dragController.bind();
    return this._dragController;
  }

  setMediaCleanup(cleanup) {
    this._mediaCleanup = typeof cleanup === "function" ? cleanup : null;
  }

  clearMediaCleanup({ preserveCarousel = true } = {}) {
    this._onClearPictureInPicture("popup");
    this._onClearVideoZoom();
    if (!preserveCarousel) this._onDisposeCarousel();
    this._onDisposeMediaControls();
    this._clearStopTimer();

    const cleanup = this._mediaCleanup;
    this._mediaCleanup = null;
    if (cleanup) {
      try {
        cleanup();
      } catch (_) {}
    }
    this._onClearMediaTransport();
  }

  stopMedia({ forceSourceDrop = false } = {}) {
    this.clearMediaCleanup({ preserveCarousel: false });
    const viewer = this._query?.("#viewer");
    if (!viewer) return;

    const mediaType = this._mediaType;
    const deferSourceDrop =
      !forceSourceDrop &&
      this._isFirefox?.() &&
      mediaType &&
      mediaType !== "recording";
    if (deferSourceDrop) {
      this._cleanupVideos(viewer, false);
      this._mediaStopTimer = this._setTimer?.(() => {
        this._mediaStopTimer = null;
        this._cleanupVideos(viewer, true);
      }, this._sourceDropDelayMs);
    } else {
      this._cleanupVideos(viewer, true);
    }

    this._resetSurface(viewer);
  }

  dispose() {
    this.resetCardViewDrawerMediaHeight();
    this.stopMedia({ forceSourceDrop: true });
    this._disposeDrag();
  }

  _syncGlobalUi() {
    this._onSyncFullscreen();
    this._onSyncPictureInPicture();
    this._onScheduleOverlay();
  }

  _syncShellGeometry(popup) {
    if (!popup?.style || this._compact) return;
    const card = this._query?.("#card");
    if (isCardViewDrawerPopupPresentation(this._presentation)) {
      const geometry = resolvePopupStageGeometry({
        card,
        stage: this._query?.("#live-stage"),
      });
      if (!geometry) return;
      popup.style.setProperty?.("--popup-shell-left", `${geometry.left}px`);
      popup.style.setProperty?.("--popup-shell-width", `${geometry.width}px`);
      popup.style.setProperty?.("--popup-shell-top", `${geometry.top}px`);
      popup.style.setProperty?.(
        "--popup-shell-stage-height",
        `${geometry.height}px`,
      );
      popup.style.setProperty?.(
        "--popup-card-view-stage-aspect-ratio",
        `${geometry.width} / ${geometry.height}`,
      );
      return;
    }
    popup.style.removeProperty?.("--popup-shell-top");
    popup.style.removeProperty?.("--popup-shell-stage-height");
    popup.style.removeProperty?.("--popup-card-view-stage-aspect-ratio");
    const anchors = ["#col-left", "#live-stage", "#layout"];
    const geometry = anchors.reduce((resolved, selector) => {
      if (resolved) return resolved;
      return resolvePopupShellGeometry({
        card,
        anchor: this._query?.(selector),
      });
    }, null);
    if (!geometry) {
      popup.style.removeProperty?.("--popup-shell-left");
      popup.style.removeProperty?.("--popup-shell-width");
      return;
    }
    popup.style.setProperty?.("--popup-shell-left", `${geometry.left}px`);
    popup.style.setProperty?.("--popup-shell-width", `${geometry.width}px`);
  }

  _cleanupVideos(viewer, dropSources) {
    viewer.querySelectorAll?.("video").forEach((video) => {
      try {
        video.pause();
        if (dropSources) {
          if ("srcObject" in video) video.srcObject = null;
          video.removeAttribute("src");
          video
            .querySelectorAll?.("source")
            .forEach((source) => source.remove());
        }
      } catch (_) {}
    });
    if (dropSources) viewer.innerHTML = "";
  }

  _resetSurface(viewer) {
    this.resetCardViewDrawerMediaHeight();
    viewer.style.display = "none";
    const controls = this._query?.("#popup-media-controls");
    if (controls) {
      controls.hidden = true;
      controls.classList.remove("is-hidden");
    }
    this._onClearCarousel();
    this._onHideInfo();
    this._mediaType = "";
    this._playing = null;
    this._mediaCamera = "";
    this.setCompact(false);
  }

  _clearStopTimer() {
    if (!this._mediaStopTimer) return;
    this._clearTimer?.(this._mediaStopTimer);
    this._mediaStopTimer = null;
  }

  _disposeDrag() {
    this._dragController?.dispose?.();
    this._dragController = null;
  }
}
