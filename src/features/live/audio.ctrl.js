import { ICONS } from "../../icons.js";
import { normalizePageRoute, PAGE_IDS } from "../navigation/router.js";
import { buildLiveMuteControlMarkup } from "./view.tmpl.js";

export const cameraStartsUnmuted = (camera) =>
  camera?.start_unmuted === true;

export class LiveAudioController {
  constructor(
    host,
    {
      icons = ICONS,
      setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
      interactionTarget = globalThis.document,
    } = {},
  ) {
    this._host = host;
    this._icons = icons;
    this._setTimer = (callback, delay) => setTimer(callback, delay);
    this._interactionTarget = interactionTarget;
    this._cameraStartUnmuteCamera = null;
    this._startUnmuteInteractionObserved = false;
    this._onStartUnmuteInteraction = null;
    this._deferredStartUnmuteEngine = null;
    this._onDeferredStartUnmuteInteraction = null;
  }

  resolveMuted() {
    return this._host._streamMuted;
  }

  prepareCameraStart(camera) {
    const host = this._host;
    this._clearDeferredStartUnmute();
    this._clearStartUnmuteInteractionObserver();
    this._startUnmuteInteractionObserved = false;
    host._cameraStartUnmutePending = cameraStartsUnmuted(camera);
    this._cameraStartUnmuteCamera = host._cameraStartUnmutePending
      ? camera
      : null;
    if (host._cameraStartUnmutePending) {
      this._observeStartUnmuteInteraction();
    }
    // Establish media muted so browser autoplay policy cannot stall startup.
    host._streamMuted = true;
  }

  cancelCameraStartPreference() {
    this._host._cameraStartUnmutePending = false;
    this._cameraStartUnmuteCamera = null;
    this._clearStartUnmuteInteractionObserver();
    this._clearDeferredStartUnmute();
  }

  applyCameraStartPreference() {
    const host = this._host;
    if (host._cameraStartUnmutePending !== true || !host._engine) return false;
    host._cameraStartUnmutePending = false;
    const engine = host._engine;
    const video = this._resolveEngineVideo(engine);

    if (this._shouldDeferCameraStartUnmute()) {
      this._clearStartUnmuteInteractionObserver();
      this._scheduleDeferredStartUnmute(engine);
      return true;
    }

    this._clearStartUnmuteInteractionObserver();
    this._attemptCameraStartUnmute(engine, video);
    return true;
  }

  _resolveEngineVideo(engine) {
    return (
      engine?.video ||
      (engine?.tagName?.toLowerCase() === "video" ? engine : null) ||
      this._host._findVideoDeep?.(engine)
    );
  }

  _shouldDeferCameraStartUnmute() {
    const streamType = String(
      this._host._currentLiveStreamHint?.() || "",
    ).toLowerCase();
    return (
      this._host._isFirefox?.() === true &&
      streamType === "mse" &&
      this._startUnmuteInteractionObserved !== true
    );
  }

  _observeStartUnmuteInteraction() {
    const target = this._interactionTarget;
    if (!target?.addEventListener || this._onStartUnmuteInteraction) return;
    this._onStartUnmuteInteraction = () => {
      this._startUnmuteInteractionObserved = true;
    };
    target.addEventListener("click", this._onStartUnmuteInteraction);
    target.addEventListener("keydown", this._onStartUnmuteInteraction);
  }

  _clearStartUnmuteInteractionObserver() {
    const target = this._interactionTarget;
    const handler = this._onStartUnmuteInteraction;
    if (handler && target?.removeEventListener) {
      target.removeEventListener("click", handler);
      target.removeEventListener("keydown", handler);
    }
    this._onStartUnmuteInteraction = null;
  }

  _attemptCameraStartUnmute(engine, resolvedVideo = null) {
    const host = this._host;

    this.setMuted(false);
    host._cameraGroupLiveController?.syncAudio?.();
    host._renderMuteButton?.();
    host._engineMountedMuted = false;

    const video = resolvedVideo || this._resolveEngineVideo(engine);
    let playback = null;
    try {
      playback = video?.play?.();
    } catch (_) {
      this._handleCameraStartUnmuteFailure(engine);
      return;
    }
    if (!playback?.then) {
      this._cameraStartUnmuteCamera = null;
      return;
    }
    playback.then(
      () => {
        if (engine === host._engine && host._streamMuted === false) {
          this._cameraStartUnmuteCamera = null;
          this._clearDeferredStartUnmute();
        }
      },
      () => this._handleCameraStartUnmuteFailure(engine),
    );
  }

  _handleCameraStartUnmuteFailure(engine) {
    const host = this._host;
    if (engine !== host._engine || host._streamMuted) return;
    this.setMuted(true);
    host._cameraGroupLiveController?.syncAudio?.();
    host._renderMuteButton?.();
    const video = this._resolveEngineVideo(engine);
    try {
      video?.play?.()?.catch?.(() => {});
    } catch (_) {}
    this._scheduleDeferredStartUnmute(engine);
  }

  _scheduleDeferredStartUnmute(engine) {
    const target = this._interactionTarget;
    if (
      !this._cameraStartUnmuteCamera ||
      !target?.addEventListener ||
      this._onDeferredStartUnmuteInteraction
    ) {
      return;
    }
    this._deferredStartUnmuteEngine = engine;
    this._onDeferredStartUnmuteInteraction = () => {
      const deferredEngine = this._deferredStartUnmuteEngine;
      const configuredCamera = this._cameraStartUnmuteCamera;
      this._clearDeferredStartUnmute();
      this._startUnmuteInteractionObserved = true;
      if (
        !configuredCamera ||
        !cameraStartsUnmuted(configuredCamera) ||
        deferredEngine !== this._host._engine
      ) {
        return;
      }
      this._attemptCameraStartUnmute(deferredEngine);
    };
    target.addEventListener("click", this._onDeferredStartUnmuteInteraction);
    target.addEventListener(
      "keydown",
      this._onDeferredStartUnmuteInteraction,
    );
  }

  _clearDeferredStartUnmute() {
    const target = this._interactionTarget;
    const handler = this._onDeferredStartUnmuteInteraction;
    if (handler && target?.removeEventListener) {
      target.removeEventListener("click", handler);
      target.removeEventListener("keydown", handler);
    }
    this._deferredStartUnmuteEngine = null;
    this._onDeferredStartUnmuteInteraction = null;
  }

  dispose() {
    this.cancelCameraStartPreference();
  }

  buildControlMarkup({ buttonClass = "square-btn" } = {}) {
    return buildLiveMuteControlMarkup({
      icons: this._icons,
      streamMuted: this.resolveMuted(),
      buttonClass,
    });
  }

  buildMobileTalkMuteControlMarkup() {
    const host = this._host;
    if (
      normalizePageRoute(host._pageId) !== PAGE_IDS.mobileView ||
      host._isLikelyMobileClient?.() !== true
    ) {
      return "";
    }
    const talkActive = host._twoWayTalkActiveForCurrentCamera();
    const muted = this.resolveMuted();
    return buildLiveMuteControlMarkup({
      icons: this._icons,
      streamMuted: muted,
      buttonClass: "icon-btn",
      buttonId: "mobile-view-mute-btn",
      region: "",
      extraClass: `mobile-view-talk-mute-btn${talkActive && !muted ? " talk-audio-active" : ""}`,
      pressed: !muted,
      hidden: !talkActive,
    });
  }

  setMuted(muted) {
    const host = this._host;
    host._streamMuted = !!muted;
    host._twoWayTalkSession?.engine?.setIncomingAudioMuted?.(
      host._streamMuted,
    );
    const engine = host._engine;
    if (!engine) return;

    const applyToVideo = (video) => {
      if (!video) return false;
      if (typeof video.muted === "boolean") video.muted = host._streamMuted;
      if (typeof video.defaultMuted === "boolean") {
        video.defaultMuted = host._streamMuted;
      }
      if (!host._streamMuted) {
        if (typeof video.volume === "number") video.volume = 1;
        video.play?.().catch(() => {});
      }
      return true;
    };

    if (typeof engine.muted === "boolean") engine.muted = host._streamMuted;
    if (typeof engine.defaultMuted === "boolean") {
      engine.defaultMuted = host._streamMuted;
    }
    if (engine.video && typeof engine.video.muted === "boolean") {
      engine.video.muted = host._streamMuted;
    }
    if (engine.video && typeof engine.video.defaultMuted === "boolean") {
      engine.video.defaultMuted = host._streamMuted;
    }
    if (!host._streamMuted && engine.video) {
      if (typeof engine.video.volume === "number") engine.video.volume = 1;
      engine.video.play?.().catch(() => {});
    }

    let video =
      engine.tagName?.toLowerCase() === "video"
        ? engine
        : engine.querySelector?.("video") ||
          engine.shadowRoot?.querySelector?.("video");
    if (!video) video = host._findVideoDeep(engine);
    applyToVideo(video);

    // Legacy live players can attach or replace their nested video shortly
    // after their host is running, so synchronize the replacement as well.
    [120, 400, 900].forEach((delay) => {
      this._setTimer(() => {
        if (engine !== host._engine) return;
        applyToVideo(host._findVideoDeep(engine));
      }, delay);
    });
  }

  syncMuteButtons() {
    const host = this._host;
    const buttons = [
      host._$("#mute-btn"),
      host._$("#mobile-view-mute-btn"),
      host._$("#two-way-talk-mute-btn"),
    ].filter(Boolean);
    if (!buttons.length) return;
    const talkActive = host._twoWayTalkActiveForCurrentCamera();
    const muted = host._resolveLiveMuteControlMuted();
    const labelKey = talkActive
      ? muted
        ? "runtime.live.unmuteIncoming"
        : "runtime.live.muteIncoming"
      : muted
        ? "runtime.live.unmute"
        : "runtime.live.mute";
    const fallbackLabel = talkActive
      ? muted
        ? "Unmute incoming audio"
        : "Mute incoming audio"
      : muted
        ? "Unmute live view"
        : "Mute live view";
    const label = host._localization?.t?.(labelKey) || fallbackLabel;
    buttons.forEach((button) => {
      const mobileTalkMute = button.id === "mobile-view-mute-btn";
      const inlineTalkMute = button.id === "two-way-talk-mute-btn";
      const hideMute =
        host._viewMode === "grid" ||
        ((mobileTalkMute || inlineTalkMute) && !talkActive);
      if (mobileTalkMute || inlineTalkMute) {
        const audioEnabled = !muted;
        button.classList.toggle("active", audioEnabled);
        button.classList.toggle(
          "talk-audio-active",
          talkActive && audioEnabled,
        );
        button.setAttribute("aria-pressed", audioEnabled ? "true" : "false");
      }
      button.hidden = hideMute;
      button.style.display = hideMute ? "none" : "";
      if (hideMute) return;
      button.setAttribute("data-fvc-i18n-title", labelKey);
      button.setAttribute("data-fvc-i18n-aria-label", labelKey);
      button.title = label;
      button.setAttribute("aria-label", label);
      button.innerHTML = muted ? this._icons.volOff : this._icons.volOn;
    });
  }

  applyMuteChange(nextMuted) {
    const host = this._host;
    this.cancelCameraStartPreference();
    host._setLiveMuted(nextMuted);
    host._cameraGroupLiveController?.syncAudio?.();
    host._renderMuteButton();
    if (!nextMuted) host._engineMountedMuted = false;
  }

  toggleMute() {
    const host = this._host;
    host._applyLiveMuteChange(!host._resolveLiveMuteControlMuted(), {
      source: "button",
    });
  }
}

export function getLiveAudioController(host) {
  if (host._liveAudioController instanceof LiveAudioController) {
    return host._liveAudioController;
  }
  const controller = new LiveAudioController(host);
  host._liveAudioController = controller;
  return controller;
}
