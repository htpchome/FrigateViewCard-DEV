import { AutoUnmuteHandler } from "./auto-unmute-handler.js";
import { MuteHandler } from "./mute-handler.js";
import { MuteStateManager } from "./mute-state-manager.js";

export { cameraStartsUnmuted } from "./auto-unmute-handler.js";

export class LiveAudioController {
  constructor(host, options = {}) {
    const muteStateManager = options.muteStateManager || new MuteStateManager();
    const resolveEntity = (camera = host?._activeCam) =>
      host?._activeGroupMemberOverride || camera?.entity || "";
    this._autoUnmute = new AutoUnmuteHandler(host, {
      interactionTarget: options.interactionTarget,
      isMobilePhone: options.isMobilePhone,
      muteStateManager,
      resolveEntity,
    });
    this._mute = new MuteHandler(host, {
      icons: options.icons,
      setTimer: options.setTimer,
      cancelAutoUnmute: () => this._autoUnmute.cancel(),
      muteStateManager,
      resolveEntity,
    });
  }

  resolveMuted() {
    return this._mute.resolveMuted();
  }

  prepareCameraStart(camera) {
    this._autoUnmute.prepare(camera);
  }

  cancelCameraStartPreference() {
    this._autoUnmute.cancel();
  }

  resolveStartupMuted(entity) {
    return this._autoUnmute.resolveStartupMuted(entity);
  }

  prepareSelectedPlayback(video, options = {}) {
    return this._autoUnmute.prepareCandidate(video, options);
  }

  notifySelectedPlaybackReady(video) {
    return this._autoUnmute.notifyCandidateReady(video);
  }

  releasePreparedPlayback(video) {
    return this._autoUnmute.releaseCandidate(video);
  }

  applyCameraStartPreference(options = {}) {
    return this._autoUnmute.applySelected(options);
  }

  buildControlMarkup(options = {}) {
    return this._mute.buildControlMarkup(options);
  }

  buildMobileTalkMuteControlMarkup() {
    return this._mute.buildMobileTalkControlMarkup();
  }

  setMuted(muted, options = {}) {
    this._mute.setMuted(muted, options);
  }

  syncMuteButtons() {
    this._mute.syncButtons();
  }

  applyMuteChange(nextMuted, options = {}) {
    this._mute.applyChange(nextMuted, options);
  }

  toggleMute() {
    this._mute.toggle();
  }

  dispose() {
    this._autoUnmute.dispose();
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
