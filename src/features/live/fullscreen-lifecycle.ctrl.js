import { CleanupController } from "../../shared/cleanup.js";

export class LiveFullscreenLifecycleController {
  constructor({
    getCurrentVideo = () => null,
    scheduleResumeLive = () => {},
    onFullscreenExit = () => {},
    requestFrame = (callback) =>
      typeof globalThis.requestAnimationFrame === "function"
        ? globalThis.requestAnimationFrame(callback)
        : globalThis.setTimeout?.(callback, 0),
    cancelFrame = (frame) => {
      if (typeof globalThis.cancelAnimationFrame === "function") {
        globalThis.cancelAnimationFrame(frame);
        return;
      }
      globalThis.clearTimeout?.(frame);
    },
  } = {}) {
    this._getCurrentVideo = getCurrentVideo;
    this._scheduleResumeLive = scheduleResumeLive;
    this._onFullscreenExit = onFullscreenExit;
    this._requestFrame = requestFrame;
    this._cancelFrame = cancelFrame;
    this._sessionVideo = null;
    this._usesDocumentFullscreen = false;
    this._enteredDocumentFullscreen = false;
    this._nativeCleanup = new CleanupController();
    this._resumeFrames = [];
  }

  get active() {
    return Boolean(
      this._sessionVideo ||
        this._usesDocumentFullscreen ||
        this._enteredDocumentFullscreen,
    );
  }

  beginDocumentFullscreen(video = null) {
    this.cancel();
    this._sessionVideo = video;
    this._usesDocumentFullscreen = true;
  }

  beginNativeVideoFullscreen(video = null) {
    this.cancel();
    this._sessionVideo = video;
    this._nativeCleanup.addEventListener(
      video,
      "webkitendfullscreen",
      this._onNativeVideoFullscreenEnd,
      { once: true },
    );
    this._nativeCleanup.addEventListener(
      video,
      "webkitpresentationmodechanged",
      this._onNativeVideoPresentationModeChange,
    );
  }

  handleDocumentFullscreenChange(fullscreenElement = null) {
    if (!this._usesDocumentFullscreen) return;
    if (fullscreenElement) {
      this._enteredDocumentFullscreen = true;
      return;
    }
    if (!this._enteredDocumentFullscreen) return;
    this._recoverAfterExit();
  }

  cancel() {
    for (const frame of this._resumeFrames) this._cancelFrame?.(frame);
    this._resumeFrames = [];
    this._nativeCleanup.dispose();
    this._nativeCleanup = new CleanupController();
    this._sessionVideo = null;
    this._usesDocumentFullscreen = false;
    this._enteredDocumentFullscreen = false;
  }

  dispose() {
    this.cancel();
  }

  _onNativeVideoFullscreenEnd = () => {
    this._recoverAfterExit();
  };

  _onNativeVideoPresentationModeChange = () => {
    if (this._sessionVideo?.webkitPresentationMode === "fullscreen") return;
    this._recoverAfterExit();
  };

  _recoverAfterExit() {
    const sessionVideo = this._sessionVideo;
    const nativeVideoFullscreen = !this._usesDocumentFullscreen;
    this.cancel();
    this._onFullscreenExit?.();

    const currentVideo = this._getCurrentVideo?.();
    const video = sessionVideo?.isConnected !== false
      ? sessionVideo
      : currentVideo;
    if (!video?.play) {
      this._scheduleResumeLive?.("live-fullscreen-media-missing");
      return;
    }

    if (nativeVideoFullscreen) {
      // iOS can report the retained video as playing while its native
      // fullscreen presentation has actually left inline playback suspended.
      // Restart the same media element while the exit gesture is still active;
      // this does not recreate its WebRTC, MSE, or HA Direct transport.
      try {
        video.pause?.();
        const playResult = video.play();
        playResult?.catch?.(() => {});
      } catch (_) {}
    }

    // WebKit reports fullscreen exit before inline presentation is completely
    // restored. Resume the exact retained player after that transition instead
    // of sending it through the general remount recovery path.
    const resume = () => {
      this._resumeFrames = [];
      try {
        const playResult = video.play();
        playResult?.catch?.(() => {});
      } catch (_) {}
    };
    const secondFrame = () => {
      const frame = this._requestFrame?.(resume);
      if (frame != null) this._resumeFrames.push(frame);
    };
    const frame = this._requestFrame?.(secondFrame);
    if (frame != null) this._resumeFrames.push(frame);
  }
}
