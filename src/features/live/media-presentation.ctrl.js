import { attachVideoZoom } from "../../shared/media/video-zoom.ctrl.js";
import { applyContainedVideoFit } from "../../shared/media/video-fit.js";

export class LiveMediaPresentationController {
  constructor(host) {
    this._host = host;
    this._playbackActivation = null;
  }

  assignEngine(engine, options = {}) {
    const host = this._host;
    if (host._engine === engine) {
      if (engine) this.attachVideoZoom(engine);
      host._syncPictureInPictureButtons();
      return;
    }
    this.clearSelectedPlaybackActivation();
    if (options.retainPrevious !== true) {
      if (host._engine?.catalystHls === true) {
        host._catalystHlsMounter?.release?.(host._engine);
      } else {
        host._haDirectMounter?.release?.(host._engine);
      }
    }
    this.clearVideoZoom();
    host._clearPictureInPictureButtonController("live");
    host._liveViewResizeController?.attachMedia(null);
    host._engine = engine;
    if (engine) {
      this.attachVideoZoom(engine);
    } else {
      host._syncPictureInPictureButtons();
    }
  }

  attachVideoZoom(engine, readyVideo = null, attachmentOptions = {}) {
    const hostCard = this._host;
    if (!engine || hostCard._engine !== engine) return;
    const video =
      readyVideo ||
      engine.video ||
      hostCard._findFullscreenVideo(engine) ||
      hostCard._findVideoDeep(engine);
    if (!video) return;

    applyContainedVideoFit(video);
    hostCard._liveViewResizeController?.attachMedia(video);
    this.activateSelectedPlayback(engine, video);
    const currentZoomController = hostCard._liveVideoZoomController;
    const sameVideo = currentZoomController?.video === video;
    const zoomHost =
      attachmentOptions.host ||
      (sameVideo ? currentZoomController?.host : null) ||
      video.parentElement ||
      null;
    const interactionTarget =
      attachmentOptions.interactionTarget ||
      (sameVideo ? currentZoomController?.interactionTarget : null) ||
      video;
    if (!zoomHost) {
      this.clearVideoZoom();
      hostCard._syncPictureInPictureButtons();
      return;
    }
    if (
      sameVideo &&
      currentZoomController?.host === zoomHost &&
      currentZoomController?.interactionTarget === interactionTarget
    ) {
      currentZoomController.refresh();
      hostCard._syncPictureInPictureButtons();
      return;
    }

    this.clearVideoZoom();
    const enablePresentationRefresh =
      attachmentOptions.enablePresentationRefresh ??
      !(
        engine?.type === "ha_direct" &&
        engine?.streamType === "hls"
      );
    hostCard._liveVideoZoomController = attachVideoZoom(video, {
      host: zoomHost,
      interactionTarget,
      enablePresentationRefresh,
      enablePointerEvents: engine.haDirectProvider === true,
      onInteractionStart: () => hostCard._dismissLinkedLightDimmers(),
      onZoomStateChange: (zoomed) => {
        hostCard._$("#card")?.classList?.toggle?.(
          "card-view-video-zoomed",
          zoomed,
        );
      },
    });
    this.syncRotateZoomPresentation();
    hostCard._syncPictureInPictureButtons();
  }

  activateSelectedPlayback(engine = this._host._engine, readyVideo = null) {
    const video = readyVideo || this._resolvePlaybackVideo(engine);
    if (!engine || !video) return false;

    let activation = this._playbackActivation;
    if (activation?.engine !== engine || activation?.video !== video) {
      this.clearSelectedPlaybackActivation();
      activation = {
        engine,
        video,
        playPending: false,
        playQueued: false,
        retryRequested: false,
        listeners: [],
      };
      this._playbackActivation = activation;

      const retry = () => this._queueSelectedPlayback(activation);
      for (const eventName of ["loadeddata", "canplay", "pause"]) {
        video.addEventListener?.(eventName, retry);
        activation.listeners.push([eventName, retry]);
      }
    }

    this._queueSelectedPlayback(activation);
    return true;
  }

  clearSelectedPlaybackActivation() {
    const activation = this._playbackActivation;
    if (!activation) return;
    this._playbackActivation = null;
    for (const [eventName, listener] of activation.listeners) {
      activation.video.removeEventListener?.(eventName, listener);
    }
  }

  _resolvePlaybackVideo(engine) {
    if (!engine) return null;
    return engine.video ||
      (engine.tagName?.toLowerCase?.() === "video" ? engine : null) ||
      this._host._findFullscreenVideo?.(engine) ||
      this._host._findVideoDeep?.(engine) ||
      null;
  }

  _playbackEligible(activation) {
    const host = this._host;
    const { engine, video } = activation;
    if (this._playbackActivation !== activation || host._engine !== engine) return false;
    if (video.isConnected === false || host._started === false) return false;
    const documentRef = video.ownerDocument || globalThis.document;
    if (documentRef?.hidden === true || documentRef?.visibilityState === "hidden") return false;
    if (host._viewMode === "grid" || host._isPreviewPageActive?.() === true) return false;
    if (host._isCardVisible?.() === false) return false;
    if (host._$?.("#myPopup")?.classList?.contains?.("is-open")) return false;
    const entity = String(
      engine.entity || engine.haDirectEntity || "",
    ).trim();
    const selectedEntity = String(
      host._activeGroupMemberOverride || host._activeCam?.entity || "",
    ).trim();
    if (entity && selectedEntity && entity !== selectedEntity) return false;
    if (entity && host._isCameraRuntimeSuspended?.(entity) === true) return false;
    return true;
  }

  _queueSelectedPlayback(activation) {
    if (activation.playQueued || !this._playbackEligible(activation)) return;
    if (activation.playPending) {
      activation.retryRequested = true;
      return;
    }
    activation.playQueued = true;
    queueMicrotask(() => {
      activation.playQueued = false;
      this._requestSelectedPlayback(activation);
    });
  }

  _requestSelectedPlayback(activation) {
    if (!this._playbackEligible(activation) || activation.playPending) return;
    const { video } = activation;
    if (video.paused === false && video.ended !== true) return;
    if (typeof video.play !== "function") return;

    let result;
    try {
      result = video.play();
    } catch (_) {
      return;
    }
    if (!result || typeof result.then !== "function") return;
    activation.playPending = true;
    Promise.resolve(result)
      .catch(() => {})
      .finally(() => {
        if (this._playbackActivation !== activation) return;
        activation.playPending = false;
        if (!activation.retryRequested) return;
        activation.retryRequested = false;
        this._queueSelectedPlayback(activation);
      });
  }

  clearVideoZoom() {
    this._host._liveVideoZoomController?.dispose?.();
    this._host._liveVideoZoomController = null;
  }

  syncRotateZoomPresentation(card = this._host._$("#card")) {
    const suspend = Boolean(
      card?.classList?.contains("mobile-rotate-live") ||
        card?.classList?.contains("mobile-rotate-live-exit"),
    );
    this._host._liveVideoZoomController?.setPresentationSuspended?.(suspend);
  }
}

export function getLiveMediaPresentationController(host) {
  if (
    host._liveMediaPresentationController instanceof
    LiveMediaPresentationController
  ) {
    return host._liveMediaPresentationController;
  }
  const controller = new LiveMediaPresentationController(host);
  host._liveMediaPresentationController = controller;
  return controller;
}
