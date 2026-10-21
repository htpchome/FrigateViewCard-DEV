import { ICONS } from "../../icons.js";
import { normalizePageRoute, PAGE_IDS } from "../navigation/router.js";
import { buildLiveMuteControlMarkup } from "./view.tmpl.js";

export const cameraStartsUnmuted = (camera) =>
  camera?.start_unmuted === true;

const LIVE_MUTE_CONTROL_IDS = new Set([
  "mute-btn",
  "mobile-view-mute-btn",
  "two-way-talk-mute-btn",
]);

const isLiveMuteControlInteraction = (event) => {
  const path =
    typeof event?.composedPath === "function"
      ? event.composedPath()
      : [event?.target];
  return path.some((element) => LIVE_MUTE_CONTROL_IDS.has(element?.id));
};

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
    this._deferredStartUnmuteEngine = null;
    this._onDeferredStartUnmuteInteraction = null;
    this._deferredStartUnmuteTargets = [];
  }

  resolveMuted() {
    return this._host._streamMuted;
  }

  prepareCameraStart(camera) {
    const host = this._host;
    this._clearDeferredStartUnmute();
    host._cameraStartUnmutePending = cameraStartsUnmuted(camera);
    this._cameraStartUnmuteCamera = host._cameraStartUnmutePending
      ? camera
      : null;
    // Establish media muted so browser autoplay policy cannot stall startup.
    host._streamMuted = true;
  }

  cancelCameraStartPreference() {
    this._host._cameraStartUnmutePending = false;
    this._cameraStartUnmuteCamera = null;
    this._clearDeferredStartUnmute();
  }

  applyCameraStartPreference() {
    const host = this._host;
    if (host._cameraStartUnmutePending !== true || !host._engine) return false;
    host._cameraStartUnmutePending = false;
    const engine = host._engine;
    const video = this._resolveEngineVideo(engine);

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
    const targets = [
      this._interactionTarget,
      this._host?.shadowRoot,
      this._host,
    ].filter(
      (target, index, candidates) =>
        Boolean(target?.addEventListener) && candidates.indexOf(target) === index,
    );
    if (
      !this._cameraStartUnmuteCamera ||
      !targets.length ||
      this._onDeferredStartUnmuteInteraction
    ) {
      return;
    }
    this._deferredStartUnmuteEngine = engine;
    this._deferredStartUnmuteTargets = targets;
    this._onDeferredStartUnmuteInteraction = (event) => {
      // Let the mute control's own click handler own its state transition.
      if (isLiveMuteControlInteraction(event)) return;
      const deferredEngine = this._deferredStartUnmuteEngine;
      const configuredCamera = this._cameraStartUnmuteCamera;
      if (
        !configuredCamera ||
        !cameraStartsUnmuted(configuredCamera) ||
        deferredEngine !== this._host._engine
      ) {
        this._clearDeferredStartUnmute();
        return;
      }
      // A trusted touch is the user's playback decision. Apply it through the
      // same path as the mute button instead of rerunning the autoplay probe,
      // whose rejected promise can otherwise remute an already unlocked video
      // on iOS WebKit.
      this.applyMuteChange(false);
    };
    for (const target of targets) {
      target.addEventListener(
        "pointerdown",
        this._onDeferredStartUnmuteInteraction,
        {
          capture: true,
          passive: true,
        },
      );
      target.addEventListener(
        "touchstart",
        this._onDeferredStartUnmuteInteraction,
        {
          capture: true,
          passive: true,
        },
      );
      target.addEventListener(
        "pointerup",
        this._onDeferredStartUnmuteInteraction,
        {
          capture: true,
          passive: true,
        },
      );
      target.addEventListener(
        "touchend",
        this._onDeferredStartUnmuteInteraction,
        {
          capture: true,
          passive: true,
        },
      );
      target.addEventListener("click", this._onDeferredStartUnmuteInteraction);
      target.addEventListener("keydown", this._onDeferredStartUnmuteInteraction);
    }
  }

  _clearDeferredStartUnmute() {
    const handler = this._onDeferredStartUnmuteInteraction;
    if (handler) {
      for (const target of this._deferredStartUnmuteTargets) {
        target.removeEventListener?.("pointerdown", handler, true);
        target.removeEventListener?.("touchstart", handler, true);
        target.removeEventListener?.("pointerup", handler, true);
        target.removeEventListener?.("touchend", handler, true);
        target.removeEventListener?.("click", handler);
        target.removeEventListener?.("keydown", handler);
      }
    }
    this._deferredStartUnmuteEngine = null;
    this._onDeferredStartUnmuteInteraction = null;
    this._deferredStartUnmuteTargets = [];
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
