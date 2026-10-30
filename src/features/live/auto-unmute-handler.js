import { synchronizeHaCameraAudio } from "../../integrations/home-assistant/camera-audio.js";
import { findActiveHaCameraStreamVideo } from "../../integrations/home-assistant/playback.js";

export const cameraStartsUnmuted = (camera, isMobilePhone = false) =>
  isMobilePhone
    ? camera?.start_unmuted_mobile === true
    : camera?.start_unmuted === true;

export class AutoUnmuteHandler {
  constructor(host, {
    interactionTarget = globalThis.document,
    isMobilePhone = () => host?._isLikelyPhoneClient?.() === true,
  } = {}) {
    this._host = host;
    this._interactionTarget = interactionTarget;
    this._isMobilePhone = isMobilePhone;
    this._camera = null;
    this._target = null;
  }

  prepare(camera) {
    this._clearTarget();
    this._camera = this._cameraStartsUnmuted(camera) ? camera : null;
    this._host._cameraStartUnmutePending = Boolean(this._camera);
    this._host._streamMuted = true;
  }

  cancel() {
    this._host._cameraStartUnmutePending = false;
    this._camera = null;
    this._clearTarget();
  }

  resolveStartupMuted(entity) {
    return !(
      this._cameraStartsUnmuted(this._camera) &&
      entity === this._selectedEntity() &&
      this._isVisible()
    );
  }

  prepareCandidate(video, { entity, isCurrent = () => true } = {}) {
    if (!video || this.resolveStartupMuted(entity)) return false;
    if (this._target) return this._target.video === video;
    this._setTarget(video, { entity, isCurrent });
    this._applyCandidate(video, entity, isCurrent);
    return true;
  }

  notifyCandidateReady(video) {
    const target = this._target;
    if (!target || target.video !== video) return false;
    target.loaded = true;
    target.loadedActionApplied = false;
    const applied = this._applyCandidate(
      video,
      target.entity,
      target.isCurrent,
    );
    if (applied) target.loadedActionApplied = true;
    return applied;
  }

  releaseCandidate(video) {
    if (video !== this._target?.video) return false;
    this._clearTarget();
    return true;
  }

  applySelected({ mediaLoaded = false } = {}) {
    const engine = this._host._engine;
    if (!this._cameraStartsUnmuted(this._camera) || !engine) return false;
    const video = this._resolveVideo(engine);
    if (!video || !this._isVisible()) return false;

    let target = this._target;
    if (target?.video !== video) {
      this._clearTarget();
      target = this._setTarget(video, { entity: this._selectedEntity() });
      const applied = this._applySelected(engine, video);
      if (mediaLoaded) {
        target.loaded = true;
      }
      if (target.loaded) target.loadedActionApplied = applied;
      return applied;
    }

    if (mediaLoaded) target.loaded = true;
    if (target.loaded && !target.loadedActionApplied) {
      const applied = this._applySelected(engine, video);
      if (applied) target.loadedActionApplied = true;
      return applied;
    }
    return true;
  }

  _setTarget(video, { entity = "", isCurrent = () => true } = {}) {
    const target = {
      video,
      entity,
      isCurrent,
      loaded: Number(video.readyState) >= 2,
      loadedActionApplied: false,
      onLoaded: null,
    };
    target.onLoaded = () => {
      target.onLoaded = null;
      if (target !== this._target) return;
      const engine = this._host._engine;
      if (target.loadedActionApplied) return;
      // A go2rtc race candidate reports loadeddata before it becomes the
      // committed engine. ACC's experimental provider applies its selected
      // unmute/play action at this source-ready boundary, so do not discard the
      // event merely because the candidate has not won the race yet.
      const applied = engine && video === this._resolveVideo(engine)
        ? this._applySelected(engine, video)
        : this.notifyCandidateReady(video);
      if (applied) target.loadedActionApplied = true;
    };
    this._target = target;
    video.addEventListener?.("loadeddata", target.onLoaded, { once: true });
    return target;
  }

  _resolveVideo(engine) {
    if (!engine) return null;
    if (engine.haDirectProvider === true) {
      return findActiveHaCameraStreamVideo(engine);
    }
    return engine.video ||
      (engine.tagName?.toLowerCase() === "video" ? engine : null) ||
      this._host._findVideoDeep?.(engine) ||
      null;
  }

  _applySelected(engine, video) {
    if (
      engine !== this._host._engine ||
      video !== this._resolveVideo(engine) ||
      !this._cameraStartsUnmuted(this._camera) ||
      !this._isVisible()
    ) return false;

    this._setOutputMuted(engine, video, false);
    void this._requestPlayback({
      camera: this._camera,
      engine,
      video,
    });
    this._markApplied();
    return true;
  }

  _applyCandidate(video, entity, isCurrent) {
    if (
      video !== this._target?.video ||
      !isCurrent() ||
      this.resolveStartupMuted(entity) ||
      !this._isVisible()
    ) return false;

    video.muted = false;
    if (typeof video.volume === "number") video.volume = 1;
    this._host._streamMuted = false;
    void this._requestPlayback({
      camera: this._camera,
      engine: null,
      video,
      isCurrent,
    });
    if (this._target?.loaded) this._target.loadedActionApplied = true;
    this._markApplied();
    return true;
  }

  async _requestPlayback({ camera, engine, video, isCurrent } = {}) {
    await Promise.resolve();
    const current = engine
      ? engine === this._host._engine && video === this._resolveVideo(engine)
      : video === this._target?.video && isCurrent?.();
    if (
      !current ||
      camera !== this._camera ||
      video.muted === true ||
      !this._isVisible()
    ) return;

    try {
      await video.play?.();
    } catch (error) {
      if (
        error?.name !== "NotAllowedError" ||
        camera !== this._camera ||
        video.muted === true
      ) return;
      this._setOutputMuted(engine, video, true);
      this._host._renderMuteButton?.();
      try {
        await video.play?.();
      } catch (_) {}
    }
  }

  _setOutputMuted(engine, video, muted) {
    this._host._streamMuted = Boolean(muted);
    this._host._twoWayTalkSession?.engine?.setIncomingAudioMuted?.(
      this._host._streamMuted,
    );
    if (engine?.haDirectProvider === true) {
      synchronizeHaCameraAudio(engine, this._host._streamMuted);
    } else if (video && typeof video.muted === "boolean") {
      video.muted = this._host._streamMuted;
      if (!this._host._streamMuted && typeof video.volume === "number") {
        video.volume = 1;
      }
    }
  }

  _markApplied() {
    this._host._cameraStartUnmutePending = false;
    this._host._engineMountedMuted = false;
    this._host._renderMuteButton?.();
  }

  _selectedEntity() {
    return this._host._activeGroupMemberOverride ||
      this._host._activeCam?.entity ||
      "";
  }

  _cameraStartsUnmuted(camera) {
    return cameraStartsUnmuted(camera, this._isMobilePhone());
  }

  _isVisible() {
    return this._interactionTarget?.visibilityState !== "hidden";
  }

  _clearTarget() {
    const target = this._target;
    if (target?.video && target.onLoaded) {
      target.video.removeEventListener?.("loadeddata", target.onLoaded);
    }
    this._target = null;
  }

  dispose() {
    this.cancel();
  }
}
