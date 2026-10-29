import { ICONS } from "../../icons.js";
import { normalizePageRoute, PAGE_IDS } from "../navigation/router.js";
import { buildLiveMuteControlMarkup } from "./view.tmpl.js";
import { getHaCameraAudioPeer, synchronizeHaCameraAudio } from "../../integrations/home-assistant/camera-audio.js";
import { findActiveHaCameraStreamVideo } from "../../integrations/home-assistant/playback.js";
import { createInitialPlayback } from "../../shared/media/initial-playback.js";
import { watchAudioAvailability } from "../../shared/media/audio-availability.js";

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
    this._cameraStartUnmuteAttempt = null;
    this._deferredStartUnmuteEngine = null;
    this._onDeferredStartUnmuteInteraction = null;
    this._deferredStartUnmuteTargets = [];
    this._initialPlaybackVideos = new Map();
    this._initialAudioOwner = null;
  }

  resolveMuted() {
    return this._host._streamMuted;
  }

  prepareCameraStart(camera) {
    const host = this._host;
    this._mutePendingStartUnmuteOutput();
    this._clearDeferredStartUnmute();
    this._clearStartUnmuteReadiness();
    this._clearInitialPlayback();
    this._cameraStartUnmuteAttempt = null;
    host._cameraStartUnmutePending = cameraStartsUnmuted(camera);
    this._cameraStartUnmuteCamera = host._cameraStartUnmutePending
      ? camera
      : null;
    // Dormant players stay muted; the startup owner applies selected audio
    // before its first play, with a muted fallback if permission is denied.
    host._streamMuted = true;
  }

  cancelCameraStartPreference() {
    this._mutePendingStartUnmuteOutput();
    this._host._cameraStartUnmutePending = false;
    this._cameraStartUnmuteCamera = null;
    this._clearStartUnmuteReadiness();
    this._cameraStartUnmuteAttempt = null;
    this._clearDeferredStartUnmute();
    this._clearInitialPlayback();
  }

  resolveStartupMuted(entity) {
    return !(
      cameraStartsUnmuted(this._cameraStartUnmuteCamera) &&
      !this._initialPlaybackVideos.get(this._initialAudioOwner)?.state.blocked &&
      !this._cameraStartUnmuteAttempt?.blocked &&
      entity === (this._host._activeGroupMemberOverride || this._host._activeCam?.entity) &&
      this._interactionTarget?.visibilityState !== "hidden"
    );
  }

  createInitialPlayback(video, { entity, isCurrent = () => true, onMuted = () => {}, onDispose = () => {}, replaceExisting = false } = {}) {
    if (this.resolveStartupMuted(entity)) return null;
    const camera = this._cameraStartUnmuteCamera;
    if (replaceExisting) this._clearInitialPlayback(video);
    // Only one racing candidate may request audio before a winner is selected.
    this._initialAudioOwner ??= video;
    if (this._initialAudioOwner === video) {
      // Match ACC's selected-media action: let the candidate load while muted,
      // but leave its first play request to the visible committed owner.
      video.preload = "auto";
      video.muted = true;
    }
    const playback = createInitialPlayback(video, {
      deferUntilCommit: true,
      onDispose,
      getMuted: () => {
        const muted = this._initialAudioOwner !== video || this.resolveStartupMuted(entity);
        if (this._initialAudioOwner === video) {
          this._host._streamMuted = muted;
          if (this._resolveEngineVideo(this._host._engine) === video) {
            this._setAutomaticOutputMuted(this._host._engine, video, muted);
          }
          this._host._renderMuteButton?.();
        }
        return muted;
      },
      isCurrent: () =>
        camera === this._cameraStartUnmuteCamera &&
        this._interactionTarget?.visibilityState !== "hidden" &&
        isCurrent(),
      onMuted: () => {
        onMuted();
        if (this._initialAudioOwner === video) {
          this._host._streamMuted = true;
          this._host._renderMuteButton?.();
          if (this._resolveEngineVideo(this._host._engine) === video) {
            this._scheduleDeferredStartUnmute(this._host._engine);
          }
        }
      },
    });
    this._initialPlaybackVideos.set(video, playback);
    return {
      state: playback.state,
      play: playback.play,
      dispose: () => {
        playback.dispose();
        if (this._initialPlaybackVideos.get(video) !== playback) return;
        this._initialPlaybackVideos.delete(video);
        if (this._initialAudioOwner === video) this._initialAudioOwner = null;
      },
    };
  }

  _clearInitialPlayback(keepVideo = null) {
    for (const [video, playback] of this._initialPlaybackVideos) {
      if (video === keepVideo) continue;
      video.muted = true;
      playback.dispose();
      this._initialPlaybackVideos.delete(video);
    }
    this._initialAudioOwner = keepVideo;
  }

  applyCameraStartPreference() {
    const host = this._host;
    if (!cameraStartsUnmuted(this._cameraStartUnmuteCamera) || !host._engine) {
      return false;
    }
    const engine = host._engine;
    const video = this._resolveEngineVideo(engine);
    const previous = this._cameraStartUnmuteAttempt;
    if (!video || this._interactionTarget?.visibilityState === "hidden") {
      return false;
    }
    if (previous?.engine === engine && previous.video === video) {
      return previous.retryNeeded ? this._retryCameraStartUnmute(previous) : false;
    }
    host._cameraStartUnmutePending = false;
    // A takeover gets its own attempt and interaction targets, not the old player's.
    this._clearDeferredStartUnmute();
    this._clearStartUnmuteReadiness();
    this._clearInitialPlayback(video);
    const initial = this._initialPlaybackVideos.get(video);
    const initialCompletedAudible = Boolean(
      initial?.state.completed &&
      initial.state.requestedUnmuted &&
      initial.state.loadedReapplied &&
      initial.state.blocked !== true &&
      video.muted === false,
    );
    const attempt = {
      engine,
      video,
      inFlight: false,
      retries: 0,
      blocked: initial?.state.blocked === true,
      loadedReapplied: initialCompletedAudible,
      awaitingLoaded: Number(video.readyState) < 2,
      startupPlayback: initial || null,
    };
    this._cameraStartUnmuteAttempt = attempt;
    // Keep the deferred startup owner until this visible player's first play
    // resolves so a hidden candidate cannot independently start playback.
    if (engine.catalystHls !== true) {
      attempt.stopAudioWatch = watchAudioAvailability(video,
        getHaCameraAudioPeer(engine) || engine.pc,
        () => this._retryCameraStartUnmuteForAudio(attempt));
    }
    attempt.onLoaded = () => this._reapplyCameraStartUnmuteOnLoad(attempt);
    attempt.onReady = () => this._retryCameraStartUnmute(attempt);
    video.addEventListener?.("loadeddata", attempt.onLoaded);
    video.addEventListener?.("canplay", attempt.onReady);
    // ACC's early selected action has no player to operate on until media is
    // loaded. Our raw video exists sooner, so explicitly preserve that same
    // boundary instead of making an audible request against an unready video.
    if (!attempt.awaitingLoaded && !initialCompletedAudible) {
      this._attemptCameraStartUnmute(attempt);
    }
    return true;
  }

  _clearStartUnmuteReadiness({ keepAudioWatch = false } = {}) {
    const attempt = this._cameraStartUnmuteAttempt;
    if (!keepAudioWatch) {
      attempt?.stopAudioWatch?.();
      if (attempt) attempt.stopAudioWatch = null;
    }
    if (!attempt) return;
    if (attempt.onLoaded) {
      attempt.video.removeEventListener?.("loadeddata", attempt.onLoaded);
      attempt.onLoaded = null;
    }
    if (!attempt.onReady) return;
    attempt.video.removeEventListener?.("canplay", attempt.onReady);
    attempt.onReady = null;
  }

  _mutePendingStartUnmuteOutput() {
    const attempt = this._cameraStartUnmuteAttempt;
    if (!attempt?.video || (!attempt.awaitingLoaded && !attempt.inFlight)) return;
    this._setAutomaticOutputMuted(attempt.engine, attempt.video, true);
  }

  _reapplyCameraStartUnmuteOnLoad(attempt) {
    if (
      this._isCurrentStartUnmuteAttempt(attempt) &&
      this._interactionTarget?.visibilityState === "hidden"
    ) {
      this._setAutomaticOutputMuted(attempt.engine, attempt.video, true);
      return false;
    }
    if (
      !this._isCurrentStartUnmuteAttempt(attempt) ||
      attempt.loadedReapplied ||
      !cameraStartsUnmuted(this._cameraStartUnmuteCamera) ||
      this._interactionTarget?.visibilityState === "hidden"
    ) {
      return false;
    }
    attempt.loadedReapplied = true;
    if (attempt.onLoaded) {
      attempt.video.removeEventListener?.("loadeddata", attempt.onLoaded);
      attempt.onLoaded = null;
    }
    attempt.blocked = false;
    attempt.retries = 0;
    if (attempt.inFlight) {
      attempt.loadedWhilePending = true;
      return false;
    }
    this._attemptCameraStartUnmute(attempt);
    return true;
  }

  _retryCameraStartUnmuteForAudio(attempt) {
    if (!this._isCurrentStartUnmuteAttempt(attempt) ||
        !cameraStartsUnmuted(this._cameraStartUnmuteCamera) ||
        this._interactionTarget?.visibilityState === "hidden") return;
    if (attempt.inFlight) {
      attempt.audioReadyWhilePending = true;
      return;
    }
    attempt.audioReadyWhilePending = false;
    attempt.blocked = false;
    attempt.retries = 0;
    this._attemptCameraStartUnmute(attempt);
  }

  _retryCameraStartUnmute(attempt) {
    if (
      !this._isCurrentStartUnmuteAttempt(attempt) || attempt.blocked ||
      attempt.retries >= 2 || this._interactionTarget?.visibilityState === "hidden"
    ) return false;
    if (attempt.inFlight) {
      attempt.readyWhilePending = true;
      return false;
    }
    if (attempt.awaitingLoaded) {
      if (Number(attempt.video.readyState) < 2) return false;
    } else {
      if (!attempt.retryNeeded && !attempt.video.muted) return false;
      attempt.retries += 1;
    }
    this._attemptCameraStartUnmute(attempt);
    return true;
  }

  _resolveEngineVideo(engine) {
    if (engine?.haDirectProvider === true) {
      return findActiveHaCameraStreamVideo(engine);
    }
    return (
      engine?.video ||
      (engine?.tagName?.toLowerCase() === "video" ? engine : null) ||
      this._host._findVideoDeep?.(engine)
    );
  }

  _isCurrentStartUnmuteAttempt(attempt) {
    return (
      this._cameraStartUnmuteAttempt === attempt &&
      attempt.engine === this._host._engine &&
      attempt.video === this._resolveEngineVideo(attempt.engine)
    );
  }

  _releaseStartupPlayback(attempt) {
    attempt?.engine?.fvcReleaseStartupAutoplay?.();
    const playback = attempt?.startupPlayback;
    if (!playback) return;
    attempt.startupPlayback = null;
    playback.dispose();
    if (this._initialPlaybackVideos.get(attempt.video) === playback) {
      this._initialPlaybackVideos.delete(attempt.video);
    }
    if (this._initialAudioOwner === attempt.video) {
      this._initialAudioOwner = null;
    }
  }

  _attemptCameraStartUnmute(attempt) {
    const host = this._host;
    const { engine, video } = attempt;
    attempt.inFlight = true;
    attempt.retryNeeded = false;
    attempt.readyWhilePending = false;

    if (
      host._isLikelyMobileClient?.() === true &&
      cameraStartsUnmuted(this._cameraStartUnmuteCamera)
    ) {
      this._scheduleDeferredStartUnmute(engine);
    }
    // Match ACC's selected-media action: change only the committed output,
    // then ask that already-started media element to play. Do not rewrite
    // defaultMuted or synchronize dormant/racing players during auto-unmute.
    this._setAutomaticOutputMuted(engine, video, false);
    host._renderMuteButton?.();
    host._engineMountedMuted = false;

    let playback = null;
    try {
      playback = video?.play?.();
    } catch (error) {
      this._handleCameraStartUnmuteFailure(attempt, error);
      return;
    }
    if (!playback?.then) {
      this._handleCameraStartUnmuteSuccess(attempt);
      return;
    }
    playback.then(
      () => this._handleCameraStartUnmuteSuccess(attempt),
      (error) => this._handleCameraStartUnmuteFailure(attempt, error),
    );
  }

  _handleCameraStartUnmuteSuccess(attempt) {
    attempt.inFlight = false;
    this._releaseStartupPlayback(attempt);
    const host = this._host;
    if (!this._isCurrentStartUnmuteAttempt(attempt) || host._streamMuted !== false) return;
    if (attempt.loadedWhilePending) {
      attempt.loadedWhilePending = false;
      this._attemptCameraStartUnmute(attempt);
      return;
    }
    if (attempt.audioReadyWhilePending) {
      this._retryCameraStartUnmuteForAudio(attempt);
      return;
    }
    // iOS can resolve play() for muted autoplay without granting audible
    // playback. Keep one real interaction armed even after apparent success.
    if (
      host._isLikelyMobileClient?.() === true &&
      cameraStartsUnmuted(this._cameraStartUnmuteCamera)
    ) {
      this._scheduleDeferredStartUnmute(attempt.engine);
      return;
    }
    // Retain the preference for a later player takeover until the user overrides it.
    this._clearDeferredStartUnmute();
  }

  _handleCameraStartUnmuteFailure(attempt, error) {
    attempt.inFlight = false;
    const host = this._host;
    if (
      !cameraStartsUnmuted(this._cameraStartUnmuteCamera) ||
      !this._isCurrentStartUnmuteAttempt(attempt) ||
      host._streamMuted
    ) {
      return;
    }
    // An interrupted or not-yet-supported source is not an autoplay denial.
    // Retry only on readiness, never on a timer or an immediate rejection loop.
    if (error?.name !== "NotAllowedError") {
      attempt.retryNeeded = true;
      if (attempt.loadedWhilePending) {
        attempt.loadedWhilePending = false;
        attempt.retryNeeded = false;
        this._attemptCameraStartUnmute(attempt);
      } else if (attempt.audioReadyWhilePending) this._retryCameraStartUnmuteForAudio(attempt);
      else if (attempt.readyWhilePending) this._retryCameraStartUnmute(attempt);
      return;
    }
    attempt.blocked = true;
    this._setAutomaticOutputMuted(attempt.engine, attempt.video, true);
    this._releaseStartupPlayback(attempt);
    host._renderMuteButton?.();
    const { engine, video } = attempt;
    try {
      video?.play?.()?.catch?.(() => {});
    } catch (_) {}
    this._scheduleDeferredStartUnmute(engine);
    if (attempt.loadedWhilePending) {
      attempt.loadedWhilePending = false;
      attempt.blocked = false;
      this._attemptCameraStartUnmute(attempt);
    } else if (attempt.audioReadyWhilePending) {
      this._retryCameraStartUnmuteForAudio(attempt);
    }
  }

  _setAutomaticOutputMuted(engine, video, muted) {
    const host = this._host;
    host._streamMuted = Boolean(muted);
    host._twoWayTalkSession?.engine?.setIncomingAudioMuted?.(
      host._streamMuted,
    );
    if (engine?.haDirectProvider === true) {
      synchronizeHaCameraAudio(engine, host._streamMuted);
    } else if (video && typeof video.muted === "boolean") {
      video.muted = host._streamMuted;
      if (!host._streamMuted && typeof video.volume === "number") {
        video.volume = 1;
      }
    }
  }

  _scheduleDeferredStartUnmute(engine) {
    const engineVideo = this._resolveEngineVideo(engine);
    const targets = [
      engineVideo,
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
      // Wait for touchend so an earlier event cannot consume the pending retry.
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

  setMuted(muted, { startPlayback = true, synchronizeLater = true } = {}) {
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
      // Follow HA's selected child, never the first (possibly hidden) video.
      if (synchronizeLater) {
        [120, 400, 900].forEach((delay) => this._setTimer(synchronize, delay));
      }
      return;
    }

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
      if (startPlayback) engine.video.play?.().catch(() => {});
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
