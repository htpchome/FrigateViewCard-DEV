import { ICONS } from "../../icons.js";
import { normalizePageRoute, PAGE_IDS } from "../navigation/router.js";
import { buildLiveMuteControlMarkup } from "./view.tmpl.js";
import { synchronizeHaCameraAudio } from "../../integrations/home-assistant/camera-audio.js";
import { findActiveHaCameraStreamVideo } from "../../integrations/home-assistant/playback.js";

export const cameraStartsUnmuted = (camera) =>
  camera?.start_unmuted === true;

export class LiveAudioController {
  constructor(host, {
    icons = ICONS,
    setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    interactionTarget = globalThis.document,
  } = {}) {
    this._host = host;
    this._icons = icons;
    this._setTimer = (callback, delay) => setTimer(callback, delay);
    this._interactionTarget = interactionTarget;
    this._cameraStartUnmuteCamera = null;
    this._autoUnmuteVideo = null;
    this._onAutoUnmuteLoaded = null;
  }

  resolveMuted() {
    return this._host._streamMuted;
  }

  prepareCameraStart(camera) {
    this._clearAutoUnmuteLoadedListener();
    this._host._cameraStartUnmutePending = cameraStartsUnmuted(camera);
    this._cameraStartUnmuteCamera = this._host._cameraStartUnmutePending
      ? camera
      : null;
    // Every transport starts safely muted. Only the selected visible player
    // may receive the configured unmute action.
    this._host._streamMuted = true;
  }

  cancelCameraStartPreference() {
    this._host._cameraStartUnmutePending = false;
    this._cameraStartUnmuteCamera = null;
    this._clearAutoUnmuteLoadedListener();
  }

  resolveStartupMuted(entity) {
    return !(
      cameraStartsUnmuted(this._cameraStartUnmuteCamera) &&
      entity ===
        (this._host._activeGroupMemberOverride || this._host._activeCam?.entity) &&
      this._interactionTarget?.visibilityState !== "hidden"
    );
  }

  prepareSelectedPlayback(video, { entity, isCurrent = () => true } = {}) {
    if (!video || this.resolveStartupMuted(entity)) return false;
    if (this._autoUnmuteVideo) return this._autoUnmuteVideo === video;
    this._autoUnmuteVideo = video;
    this._installAutoUnmuteLoadedListener(video, () =>
      this._applyCandidateUnmute(video, entity, isCurrent));
    this._applyCandidateUnmute(video, entity, isCurrent);
    return true;
  }

  releasePreparedPlayback(video) {
    if (video !== this._autoUnmuteVideo) return false;
    this._clearAutoUnmuteLoadedListener();
    return true;
  }

  applyCameraStartPreference() {
    const host = this._host;
    if (!cameraStartsUnmuted(this._cameraStartUnmuteCamera) || !host._engine) {
      return false;
    }
    const engine = host._engine;
    const video = this._resolveEngineVideo(engine);
    if (!video || this._interactionTarget?.visibilityState === "hidden") {
      return false;
    }
    if (this._autoUnmuteVideo === video && video.muted === false) {
      this._setAutomaticOutputMuted(engine, video, false);
      return true;
    }
    this._clearAutoUnmuteLoadedListener();
    this._autoUnmuteVideo = video;
    this._installAutoUnmuteLoadedListener(video, () => {
      if (video !== this._resolveEngineVideo(host._engine)) return;
      this._applySelectedUnmute(host._engine, video);
    });
    return this._applySelectedUnmute(engine, video);
  }

  _installAutoUnmuteLoadedListener(video, apply) {
    if (Number(video.readyState) >= 2) return;
    this._onAutoUnmuteLoaded = () => {
      this._onAutoUnmuteLoaded = null;
      apply();
    };
    video.addEventListener?.("loadeddata", this._onAutoUnmuteLoaded, { once: true });
  }

  _resolveEngineVideo(engine) {
    if (engine?.haDirectProvider === true) {
      return findActiveHaCameraStreamVideo(engine);
    }
    return engine?.video ||
      (engine?.tagName?.toLowerCase() === "video" ? engine : null) ||
      this._host._findVideoDeep?.(engine);
  }

  _applySelectedUnmute(engine, video) {
    const host = this._host;
    const camera = this._cameraStartUnmuteCamera;
    if (
      engine !== host._engine ||
      video !== this._resolveEngineVideo(engine) ||
      !cameraStartsUnmuted(this._cameraStartUnmuteCamera) ||
      this._interactionTarget?.visibilityState === "hidden"
    ) return false;

    // Match ACC's selected-media action: unmute before requesting playback.
    // If the browser denies audible autoplay, resume muted without installing
    // a page-wide interaction retry.
    this._setAutomaticOutputMuted(engine, video, false);
    try {
      const playback = video.play?.();
      playback?.catch?.((error) => {
        if (
          error?.name !== "NotAllowedError" ||
          camera !== this._cameraStartUnmuteCamera ||
          engine !== host._engine ||
          video !== this._resolveEngineVideo(engine) ||
          video.muted === true
        ) return;
        this._setAutomaticOutputMuted(engine, video, true);
        host._renderMuteButton?.();
        try {
          void video.play?.()?.catch?.(() => {});
        } catch (_) {}
      });
    } catch (_) {}
    host._cameraStartUnmutePending = false;
    host._engineMountedMuted = false;
    host._renderMuteButton?.();
    return true;
  }

  _applyCandidateUnmute(video, entity, isCurrent) {
    const host = this._host;
    const camera = this._cameraStartUnmuteCamera;
    if (
      video !== this._autoUnmuteVideo ||
      !isCurrent() ||
      this.resolveStartupMuted(entity) ||
      this._interactionTarget?.visibilityState === "hidden"
    ) return false;

    video.muted = false;
    if (typeof video.volume === "number") video.volume = 1;
    host._streamMuted = false;
    host._cameraStartUnmutePending = false;
    host._engineMountedMuted = false;
    host._renderMuteButton?.();
    try {
      const playback = video.play?.();
      playback?.catch?.((error) => {
        if (
          error?.name !== "NotAllowedError" ||
          camera !== this._cameraStartUnmuteCamera ||
          video !== this._autoUnmuteVideo ||
          !isCurrent() ||
          video.muted === true
        ) return;
        video.muted = true;
        host._streamMuted = true;
        host._renderMuteButton?.();
        try {
          void video.play?.()?.catch?.(() => {});
        } catch (_) {}
      });
    } catch (_) {}
    return true;
  }

  _setAutomaticOutputMuted(engine, video, muted) {
    const host = this._host;
    host._streamMuted = Boolean(muted);
    host._twoWayTalkSession?.engine?.setIncomingAudioMuted?.(host._streamMuted);
    if (engine?.haDirectProvider === true) {
      synchronizeHaCameraAudio(engine, host._streamMuted);
    } else if (video && typeof video.muted === "boolean") {
      video.muted = host._streamMuted;
      if (!host._streamMuted && typeof video.volume === "number") video.volume = 1;
    }
  }

  _clearAutoUnmuteLoadedListener() {
    if (this._autoUnmuteVideo && this._onAutoUnmuteLoaded) {
      this._autoUnmuteVideo.removeEventListener?.("loadeddata", this._onAutoUnmuteLoaded);
    }
    this._onAutoUnmuteLoaded = null;
    this._autoUnmuteVideo = null;
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
    ) return "";
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

  setMuted(muted, { startPlayback = true, synchronizeLater = true } = {}) {
    const host = this._host;
    host._streamMuted = !!muted;
    host._twoWayTalkSession?.engine?.setIncomingAudioMuted?.(host._streamMuted);
    const engine = host._engine;
    if (!engine) return;

    const applyToVideo = (video) => {
      if (!video) return false;
      if (typeof video.muted === "boolean") video.muted = host._streamMuted;
      if (typeof video.defaultMuted === "boolean") video.defaultMuted = host._streamMuted;
      if (!host._streamMuted) {
        if (typeof video.volume === "number") video.volume = 1;
        if (startPlayback) video.play?.().catch(() => {});
      }
      return true;
    };

    if (engine.haDirectProvider === true) {
      const synchronize = () => {
        if (engine !== host._engine) return;
        applyToVideo(synchronizeHaCameraAudio(engine, host._streamMuted));
      };
      synchronize();
      if (synchronizeLater) {
        [120, 400, 900].forEach((delay) => this._setTimer(synchronize, delay));
      }
      return;
    }

    if (typeof engine.muted === "boolean") engine.muted = host._streamMuted;
    if (typeof engine.defaultMuted === "boolean") engine.defaultMuted = host._streamMuted;
    if (engine.video && typeof engine.video.muted === "boolean") {
      engine.video.muted = host._streamMuted;
    }
    if (engine.video && typeof engine.video.defaultMuted === "boolean") {
      engine.video.defaultMuted = host._streamMuted;
    }
    if (!host._streamMuted && engine.video) {
      if (typeof engine.video.volume === "number") engine.video.volume = 1;
      if (startPlayback) engine.video.play?.().catch(() => {});
    }

    let video = engine.tagName?.toLowerCase() === "video"
      ? engine
      : engine.querySelector?.("video") || engine.shadowRoot?.querySelector?.("video");
    if (!video) video = host._findVideoDeep(engine);
    applyToVideo(video);
    if (!synchronizeLater) return;
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
      ? muted ? "runtime.live.unmuteIncoming" : "runtime.live.muteIncoming"
      : muted ? "runtime.live.unmute" : "runtime.live.mute";
    const fallbackLabel = talkActive
      ? muted ? "Unmute incoming audio" : "Mute incoming audio"
      : muted ? "Unmute live view" : "Mute live view";
    const label = host._localization?.t?.(labelKey) || fallbackLabel;
    buttons.forEach((button) => {
      const mobileTalkMute = button.id === "mobile-view-mute-btn";
      const inlineTalkMute = button.id === "two-way-talk-mute-btn";
      const hideMute = host._viewMode === "grid" ||
        ((mobileTalkMute || inlineTalkMute) && !talkActive);
      if (mobileTalkMute || inlineTalkMute) {
        const audioEnabled = !muted;
        button.classList.toggle("active", audioEnabled);
        button.classList.toggle("talk-audio-active", talkActive && audioEnabled);
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
    host._applyLiveMuteChange(!host._resolveLiveMuteControlMuted(), { source: "button" });
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
