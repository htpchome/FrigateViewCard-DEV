import { AutoUnmuteHandler } from "./auto-unmute-handler.js";
import { MuteHandler } from "./mute-handler.js";

export { cameraStartsUnmuted } from "./auto-unmute-handler.js";

export class LiveAudioController {
  constructor(host, options = {}) {
    this._autoUnmute = new AutoUnmuteHandler(host, {
      interactionTarget: options.interactionTarget,
    });
    this._mute = new MuteHandler(host, {
      icons: options.icons,
      setTimer: options.setTimer,
      cancelAutoUnmute: () => this._autoUnmute.cancel(),
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

  applyMuteChange(nextMuted) {
    this._mute.applyChange(nextMuted);
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
