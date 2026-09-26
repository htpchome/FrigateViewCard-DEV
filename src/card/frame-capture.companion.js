import { captureCameraGroupDisplayedFrame } from "../features/camera-groups/frame-capture.js";
import { DisplayedFrameCaptureController } from "../shared/media/frame-capture.js";

export { captureCameraGroupDisplayedFrame };

export const createDisplayedFrameCaptureController = (card) =>
  new DisplayedFrameCaptureController({
    resolveButton: (scope) =>
      card._$(
        scope === "popup"
          ? "#popup-take-snapshot-btn"
          : "#live-take-snapshot-btn",
      ),
    resolveSurface: (scope) =>
      card._$(scope === "popup" ? "#viewer" : "#live-stage"),
    resolveMedia: (scope) => {
      if (scope === "popup") {
        const viewer = card._$("#viewer");
        return (
          viewer?.querySelector?.("video") ||
          viewer?.querySelector?.("img.snap") ||
          null
        );
      }
      const fallback = card._$("#stream-fallback");
      if (fallback && !fallback.hidden) {
        const fallbackImage = fallback.querySelector?.(
          "#stream-fallback-img, img",
        );
        if (fallbackImage) return fallbackImage;
      }
      return card._livePictureInPictureVideo();
    },
    resolveZoomController: (scope) =>
      scope === "popup"
        ? card._popupMediaPresentationController?.zoomController?.()
        : card._liveVideoZoomController,
    captureGroupedFrame: (scope) =>
      scope === "live"
        ? captureCameraGroupDisplayedFrame(card._cameraGroupLiveController)
        : null,
    resolveCamera: (scope) =>
      scope === "popup"
        ? card._popupLifecycleController.mediaCamera() || card._cc().cam
        : card._cc().cam,
    isSafari: () => card._isSafari(),
    resolveResultLabel: (success) => {
      const localizationKey = success
        ? "runtime.live.snapshotTaken"
        : "runtime.live.snapshotFailed";
      return {
        localizationKey,
        text: card._localization.t(localizationKey),
      };
    },
    warn: (error) =>
      console.warn("[Frigate] Displayed frame snapshot failed", error),
    onShowControls: (scope) => {
      if (scope === "popup") {
        card._popupMediaControlsController.showTemporarily();
      } else {
        card._showLiveControlsTemporarily();
      }
    },
  });
