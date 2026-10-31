import { CleanupController } from "../../shared/cleanup.js";

export class LiveFullscreenLifecycleController {
  constructor({
    getCurrentVideo = () => null,
    scheduleResumeLive = () => {},
    onFullscreenExit = () => {},
    resumeRetainedPlayback = (video) => video?.play?.(),
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
    setTimer = (callback, delay) => globalThis.setTimeout?.(callback, delay),
    clearTimer = (timer) => globalThis.clearTimeout?.(timer),
    nativeExitRecoveryMs = 1500,
  } = {}) {
    this._getCurrentVideo = getCurrentVideo;
    this._scheduleResumeLive = scheduleResumeLive;
    this._onFullscreenExit = onFullscreenExit;
    this._resumeRetainedPlayback = resumeRetainedPlayback;
    this._requestFrame = requestFrame;
    this._cancelFrame = cancelFrame;
    this._setTimer = setTimer;
    this._clearTimer = clearTimer;
    this._nativeExitRecoveryMs = nativeExitRecoveryMs;
    this._sessionVideo = null;
    this._usesDocumentFullscreen = false;
    this._enteredDocumentFullscreen = false;
    this._nativeCleanup = new CleanupController();
    this._exitCleanup = new CleanupController();
    this._resumeFrames = [];
    this._exitRecoveryTimer = null;
    this._pauseRecoveryTimer = null;
    this._exitRecoveryVideo = null;
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
    // A previous native exit can leave the retained element paused. Wake it
    // inside this fullscreen-button gesture before WebKit opens its player.
    this._resumeVideo(video);
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
    this._stopExitRecovery();
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

  _stopExitRecovery() {
    this._exitCleanup.dispose();
    this._exitCleanup = new CleanupController();
    if (this._exitRecoveryTimer != null) {
      this._clearTimer?.(this._exitRecoveryTimer);
    }
    if (this._pauseRecoveryTimer != null) {
      this._clearTimer?.(this._pauseRecoveryTimer);
    }
    this._exitRecoveryTimer = null;
    this._pauseRecoveryTimer = null;
    this._exitRecoveryVideo = null;
  }

  _resumeVideo(video) {
    if (!video?.play) return;
    try {
      const playResult = this._resumeRetainedPlayback?.(video);
      playResult?.catch?.(() => {});
    } catch (_) {}
  }

  _onNativeExitPause = () => {
    const video = this._exitRecoveryVideo;
    if (!video || this._pauseRecoveryTimer != null) return;
    // WebKit dispatches its final pause while native fullscreen is still
    // unwinding. Resume in the next task, after that native action completes.
    this._pauseRecoveryTimer = this._setTimer?.(() => {
      this._pauseRecoveryTimer = null;
      if (video !== this._exitRecoveryVideo) return;
      this._resumeVideo(video);
    }, 0);
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
      this._exitRecoveryVideo = video;
      this._exitCleanup.addEventListener(video, "pause", this._onNativeExitPause);
      this._exitRecoveryTimer = this._setTimer?.(
        () => this._stopExitRecovery(),
        this._nativeExitRecoveryMs,
      );
    }

    // WebKit reports fullscreen exit before inline presentation is completely
    // restored. Resume the exact retained player after that transition instead
    // of sending it through the general remount recovery path.
    const resume = () => {
      this._resumeFrames = [];
      this._resumeVideo(video);
    };
    const secondFrame = () => {
      const frame = this._requestFrame?.(resume);
      if (frame != null) this._resumeFrames.push(frame);
    };
    const frame = this._requestFrame?.(secondFrame);
    if (frame != null) this._resumeFrames.push(frame);
  }
}
