import { test } from "node:test";
import assert from "node:assert/strict";

import { LiveAudioController } from "../src/features/live/audio.ctrl.js";

const createTakeoverAudioHarness = ({ connectionType, mobile = true } = {}) => {
  const createTarget = () => {
    const listeners = new Map();
    return {
      addEventListener(type, handler) { listeners.set(type, handler); },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) listeners.delete(type);
      },
      dispatchEvent(event) { listeners.get(event.type)?.(event); },
    };
  };
  const interactionTarget = createTarget();
  const timers = [];
  const createVideo = () => Object.assign(createTarget(), {
    muted: true,
    defaultMuted: true,
    volume: 1,
    allowAudio: true,
    playCalls: 0,
    play() {
      this.playCalls += 1;
      return this.muted || this.allowAudio
        ? Promise.resolve()
        : Promise.reject(new DOMException("Blocked", "NotAllowedError"));
    },
  });
  const firstVideo = createVideo();
  const nextVideo = createVideo();
  const firstEngine = { type: connectionType, video: firstVideo };
  const nextEngine = connectionType === "ha_direct"
    ? firstEngine
    : { type: connectionType, video: nextVideo };
  const host = {
    _engine: firstEngine,
    _streamMuted: true,
    _isLikelyMobileClient: () => mobile,
    _findVideoDeep: (engine) => engine.video,
    _renderMuteButton() {},
  };
  const controller = new LiveAudioController(host, {
    interactionTarget,
    setTimer: (callback) => timers.push(callback),
  });
  host._setLiveMuted = (muted) => controller.setMuted(muted);
  const start = () => {
    controller.prepareCameraStart({ start_unmuted: true });
    return controller.applyCameraStartPreference();
  };
  const takeOver = () => {
    nextEngine.video = nextVideo;
    host._engine = nextEngine;
    return controller.applyCameraStartPreference();
  };
  return {
    controller, host, firstVideo, nextVideo, interactionTarget, timers, start, takeOver,
  };
};

for (const connectionType of ["frigate_go2rtc", "ha_direct"]) {
  for (const manualMute of [false, true]) {
    test(`${connectionType} late audio retries once and respects manual mute (${manualMute})`, async () => {
      const h = createTakeoverAudioHarness({ connectionType });
      const tracks = [];
      const peer = Object.assign(new EventTarget(), { getReceivers: () => tracks.map((track) => ({ track })) });
      h.host._engine.pc = peer;
      h.firstVideo.allowAudio = false;
      h.start();
      await Promise.resolve();
      assert.equal(h.firstVideo.muted, true);
      if (manualMute) h.controller.applyMuteChange(true);
      const beforeAudio = h.firstVideo.playCalls;
      h.firstVideo.allowAudio = true;
      const track = Object.assign(new EventTarget(), { kind: "audio", readyState: "live", muted: true });
      tracks.push(track);
      peer.dispatchEvent(new Event("track"));
      track.muted = false;
      track.dispatchEvent(new Event("unmute"));
      await Promise.resolve();
      assert.equal(h.firstVideo.muted, manualMute);
      assert.equal(h.firstVideo.playCalls, beforeAudio + (manualMute ? 0 : 1));
      track.dispatchEvent(new Event("unmute"));
      assert.equal(h.firstVideo.playCalls, beforeAudio + (manualMute ? 0 : 1));
      h.controller.dispose();
    });
  }
  test(`${connectionType} startup sets audio before one playback request without delayed plays`, async () => {
    const h = createTakeoverAudioHarness({ connectionType });
    const states = [];
    h.firstVideo.play = () => {
      states.push({ muted: h.firstVideo.muted, defaultMuted: h.firstVideo.defaultMuted });
      return Promise.resolve();
    };
    h.start();
    await Promise.resolve();
    assert.deepEqual(states, [{ muted: false, defaultMuted: false }]);
    assert.equal(h.timers.length, 0);
    h.controller.dispose();
  });

  for (const errorName of ["AbortError", "NotSupportedError"]) {
    test(`${connectionType} ${errorName} retries on readiness without forcing muted playback`, async () => {
      const h = createTakeoverAudioHarness({ connectionType });
      let plays = 0;
      h.firstVideo.play = () => ++plays === 1
        ? Promise.reject(new DOMException("Starting", errorName))
        : Promise.resolve();
      h.start();
      await Promise.resolve();
      assert.equal(h.firstVideo.muted, false);
      assert.equal(h.host._streamMuted, false);
      assert.equal(plays, 1, "no immediate retry loop");
      h.firstVideo.dispatchEvent(new Event("canplay"));
      await Promise.resolve();
      assert.equal(plays, 2);
      h.firstVideo.dispatchEvent(new Event("canplay"));
      assert.equal(plays, 2, "successful playback is not repeatedly started");
      h.controller.dispose();
    });
  }

  test(`${connectionType} readiness retries are bounded and blocked autoplay waits for interaction`, async () => {
    const h = createTakeoverAudioHarness({ connectionType });
    let plays = 0;
    h.firstVideo.play = () => {
      plays += 1;
      throw new DOMException("Interrupted", "AbortError");
    };
    h.start();
    for (let index = 0; index < 10; index += 1) {
      h.firstVideo.dispatchEvent(new Event("canplay"));
      h.controller.applyCameraStartPreference();
    }
    assert.equal(plays, 3, "initial attempt plus at most two readiness retries");
    h.controller.dispose();

    const blocked = createTakeoverAudioHarness({ connectionType });
    blocked.firstVideo.allowAudio = false;
    blocked.start();
    await Promise.resolve();
    assert.equal(blocked.firstVideo.playCalls, 2, "audible request then muted fallback");
    blocked.firstVideo.dispatchEvent(new Event("canplay"));
    blocked.controller.applyCameraStartPreference();
    assert.equal(blocked.firstVideo.playCalls, 2, "muted recovery cannot trigger an autoplay loop");
    blocked.controller.dispose();
  });

  test(`${connectionType} readiness during pending play is coalesced and hidden/manual states are protected`, async () => {
    const h = createTakeoverAudioHarness({ connectionType });
    let rejectStart;
    let plays = 0;
    h.firstVideo.play = () => {
      plays += 1;
      return plays === 1 ? new Promise((resolve, reject) => { rejectStart = reject; }) : Promise.resolve();
    };
    h.start();
    h.firstVideo.dispatchEvent(new Event("loadeddata"));
    h.firstVideo.dispatchEvent(new Event("canplay"));
    assert.equal(plays, 1);
    rejectStart(new DOMException("Interrupted", "AbortError"));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(plays, 2);
    h.firstVideo.muted = true;
    h.interactionTarget.visibilityState = "hidden";
    h.firstVideo.dispatchEvent(new Event("canplay"));
    assert.equal(h.firstVideo.muted, true);
    h.interactionTarget.visibilityState = "visible";
    h.controller.applyMuteChange(true);
    h.firstVideo.dispatchEvent(new Event("canplay"));
    assert.equal(h.firstVideo.muted, true);
    assert.equal(plays, 2);
    h.controller.dispose();
  });

  for (const mobile of [true, false]) {
    test(`${connectionType} startup unmute follows replacement media (mobile=${mobile})`, async () => {
      const h = createTakeoverAudioHarness({ connectionType, mobile });
      assert.equal(h.start(), true);
      await Promise.resolve();
      assert.equal(h.firstVideo.muted, false);

      assert.equal(h.takeOver(), true);
      await Promise.resolve();
      assert.equal(h.nextVideo.muted, false);
      assert.equal(h.host._streamMuted, false);
      const playCalls = h.nextVideo.playCalls;
      assert.equal(h.controller.applyCameraStartPreference(), false);
      assert.equal(h.nextVideo.playCalls, playCalls, "same-player status updates do not retry audio");
      h.controller.dispose();
    });
  }

  test(`${connectionType} blocked replacement playback retries on the new video's touchend`, async () => {
    const h = createTakeoverAudioHarness({ connectionType });
    h.firstVideo.allowAudio = false;
    h.nextVideo.allowAudio = false;
    h.start();
    await Promise.resolve();
    assert.equal(h.host._streamMuted, true);
    h.takeOver();
    await Promise.resolve();
    assert.equal(h.nextVideo.muted, true);

    h.nextVideo.allowAudio = true;
    h.firstVideo.dispatchEvent(new Event("touchend"));
    assert.equal(h.nextVideo.muted, true, "old video no longer owns the retry");
    h.nextVideo.dispatchEvent(new Event("touchend"));
    assert.equal(h.nextVideo.muted, false);
    assert.equal(h.host._streamMuted, false);
    h.controller.dispose();
  });

  test(`${connectionType} stale autoplay rejection cannot remute replacement media`, async () => {
    const h = createTakeoverAudioHarness({ connectionType });
    const rejections = [];
    h.firstVideo.play = () => new Promise((resolve, reject) => rejections.push(reject));
    h.start();
    h.takeOver();
    await Promise.resolve();
    rejections.forEach((reject) => reject(new DOMException("Blocked", "NotAllowedError")));
    await Promise.resolve();
    assert.equal(h.nextVideo.muted, false);
    assert.equal(h.host._streamMuted, false);
    h.controller.dispose();
  });

  test(`${connectionType} manual mute cancels startup audio through takeover`, async () => {
    const h = createTakeoverAudioHarness({ connectionType });
    h.start();
    await Promise.resolve();
    h.controller.applyMuteChange(true);
    assert.equal(h.takeOver(), false);
    h.interactionTarget.dispatchEvent(new Event("touchend"));
    h.nextVideo.dispatchEvent(new Event("touchend"));
    h.timers.forEach((callback) => callback());
    assert.equal(h.nextVideo.muted, true);
    assert.equal(h.host._streamMuted, true);
    h.controller.dispose();
  });

  test(`${connectionType} camera switch cancels the previous startup preference`, async () => {
    const h = createTakeoverAudioHarness({ connectionType });
    h.start();
    h.controller.prepareCameraStart({ start_unmuted: false });
    assert.equal(h.takeOver(), false);
    await Promise.resolve();
    h.interactionTarget.dispatchEvent(new Event("touchend"));
    assert.equal(h.nextVideo.muted, true);
    assert.equal(h.host._streamMuted, true);
    h.controller.dispose();
  });
}

const createMuteChangeHost = ({ haDirect, talkActive = false }) => {
  const calls = [];
  const host = {
    _streamMuted: true,
    _engineMountedMuted: true,
    _rotateOverlayActive: false,
    _setLiveMuted(muted) {
      this._streamMuted = muted;
      calls.push(["set-muted", muted]);
    },
    _cameraGroupLiveController: {
      syncAudio() {
        calls.push(["sync-group-audio"]);
      },
    },
    _renderMuteButton() {
      calls.push(["render-mute"]);
    },
    _useHaDirectStreamPath: () => haDirect,
    _twoWayTalkActiveForCurrentCamera: () => talkActive,
    _mountEngine(event, options) {
      calls.push(["mount", event, options]);
    },
  };
  return { calls, host };
};

test("live audio changes do not remount either live transport", () => {
  const haDirect = createMuteChangeHost({ haDirect: true });
  new LiveAudioController(haDirect.host).applyMuteChange(false);

  assert.deepEqual(haDirect.calls, [
    ["set-muted", false],
    ["sync-group-audio"],
    ["render-mute"],
  ]);
  assert.equal(haDirect.host._engineMountedMuted, false);

  const frigateGo2rtc = createMuteChangeHost({ haDirect: false });
  new LiveAudioController(frigateGo2rtc.host).applyMuteChange(false);

  assert.deepEqual(frigateGo2rtc.calls, [
    ["set-muted", false],
    ["sync-group-audio"],
    ["render-mute"],
  ]);
  assert.equal(frigateGo2rtc.host._engineMountedMuted, false);
});

test("camera start audio remains muted until ready, then applies the opt-in", async () => {
  const calls = [];
  const video = {
    muted: true,
    defaultMuted: true,
    volume: 0,
    play: () => Promise.resolve(),
  };
  const engine = { video, tagName: "DIV", querySelector: () => video };
  const host = {
    _streamMuted: false,
    _cameraStartUnmutePending: false,
    _engineMountedMuted: true,
    _engine: engine,
    _findVideoDeep: () => video,
    _cameraGroupLiveController: {
      syncAudio: () => calls.push("sync"),
    },
    _renderMuteButton: () => calls.push("render"),
  };
  const controller = new LiveAudioController(host, {
    setTimer: () => {},
  });

  controller.prepareCameraStart({ start_unmuted: true });
  assert.equal(host._streamMuted, true);
  assert.equal(host._cameraStartUnmutePending, true);

  assert.equal(controller.applyCameraStartPreference(), true);
  await Promise.resolve();

  assert.equal(host._streamMuted, false);
  assert.equal(video.muted, false);
  assert.equal(host._engineMountedMuted, false);
  assert.deepEqual(calls, ["sync", "render"]);

  controller.prepareCameraStart({ start_unmuted: false });
  assert.equal(host._streamMuted, true);
  assert.equal(host._cameraStartUnmutePending, false);
  assert.equal(controller.applyCameraStartPreference(), false);
});

test("camera start audio falls back to muted when audible autoplay is rejected", async () => {
  const calls = [];
  const listeners = new Map();
  let allowPlayback = false;
  const listenerOptions = new Map();
  const interactionTarget = {
    addEventListener(type, handler, options) {
      listeners.set(type, handler);
      listenerOptions.set(type, options);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    dispatch(type, event = {}) {
      listeners.get(type)?.(event);
    },
  };
  const video = {
    muted: true,
    defaultMuted: true,
    volume: 0,
    play: () =>
      allowPlayback
        ? Promise.resolve()
        : Promise.reject(new DOMException("Blocked", "NotAllowedError")),
  };
  const engine = { video, tagName: "DIV", querySelector: () => video };
  const host = {
    _streamMuted: true,
    _cameraStartUnmutePending: false,
    _engine: engine,
    _findVideoDeep: () => video,
    _cameraGroupLiveController: {
      syncAudio: () => calls.push("sync"),
    },
    _renderMuteButton: () => calls.push("render"),
  };
  const controller = new LiveAudioController(host, {
    setTimer: () => {},
    interactionTarget,
  });
  host._setLiveMuted = (muted) => controller.setMuted(muted);

  controller.prepareCameraStart({ start_unmuted: true });
  controller.applyCameraStartPreference();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(host._streamMuted, true);
  assert.equal(video.muted, true);
  assert.deepEqual([...listeners.keys()], [
    "touchend",
    "click",
    "keydown",
  ]);
  assert.deepEqual(listenerOptions.get("touchend"), {
    capture: true,
    passive: true,
  });
  assert.deepEqual(calls, ["sync", "render", "sync", "render"]);

  allowPlayback = true;
  interactionTarget.dispatch("pointerdown");
  interactionTarget.dispatch("touchstart");
  interactionTarget.dispatch("pointerup");
  assert.equal(host._streamMuted, true);
  assert.equal(video.muted, true);
  assert.equal(listeners.has("touchend"), true);
  interactionTarget.dispatch("touchend");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(host._streamMuted, false);
  assert.equal(video.muted, false);
  assert.equal(video.defaultMuted, false);
  assert.equal(video.volume, 1);
  assert.equal(listeners.size, 0);
  assert.deepEqual(calls, [
    "sync",
    "render",
    "sync",
    "render",
    "sync",
    "render",
  ]);
});

test("mobile startup audio keeps first-touch unmute armed after play resolves", async () => {
  const listeners = new Map();
  const interactionTarget = {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    dispatch(type, event = {}) {
      listeners.get(type)?.(event);
    },
  };
  const video = {
    muted: true,
    defaultMuted: true,
    volume: 0,
    play: () => Promise.resolve(),
  };
  const engine = {
    type: "frigate_go2rtc",
    streamType: "webrtc",
    video,
  };
  const host = {
    _streamMuted: true,
    _cameraStartUnmutePending: false,
    _engine: engine,
    _isLikelyMobileClient: () => true,
    _findVideoDeep: () => video,
    _cameraGroupLiveController: { syncAudio: () => {} },
    _renderMuteButton: () => {},
  };
  const controller = new LiveAudioController(host, { interactionTarget });
  host._setLiveMuted = (muted) => controller.setMuted(muted);

  controller.prepareCameraStart({ start_unmuted: true });
  controller.applyCameraStartPreference();
  assert.equal(listeners.has("touchend"), true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(host._streamMuted, false);
  assert.equal(listeners.has("touchend"), true);

  interactionTarget.dispatch("touchend");

  assert.equal(host._streamMuted, false);
  assert.equal(video.muted, false);
  assert.equal(listeners.size, 0);
});

test("a late mobile autoplay rejection cannot undo first-touch unmute", async () => {
  const listeners = new Map();
  const interactionTarget = {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    dispatch(type, event = {}) {
      listeners.get(type)?.(event);
    },
  };
  const video = {
    muted: true,
    defaultMuted: true,
    volume: 0,
    play: () => Promise.reject(new DOMException("Blocked", "NotAllowedError")),
  };
  const engine = {
    type: "frigate_go2rtc",
    streamType: "webrtc",
    video,
  };
  const host = {
    _streamMuted: true,
    _cameraStartUnmutePending: false,
    _engine: engine,
    _isLikelyMobileClient: () => true,
    _findVideoDeep: () => video,
    _cameraGroupLiveController: { syncAudio: () => {} },
    _renderMuteButton: () => {},
  };
  const controller = new LiveAudioController(host, { interactionTarget });
  host._setLiveMuted = (muted) => controller.setMuted(muted);

  controller.prepareCameraStart({ start_unmuted: true });
  controller.applyCameraStartPreference();
  interactionTarget.dispatch("touchend");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(host._streamMuted, false);
  assert.equal(video.muted, false);
  assert.equal(listeners.size, 0);
});

test("deferred startup audio leaves the live mute control transition alone", async () => {
  const listeners = new Map();
  let allowPlayback = false;
  const interactionTarget = {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    dispatch(type, event = {}) {
      listeners.get(type)?.(event);
    },
  };
  const video = {
    muted: true,
    defaultMuted: true,
    volume: 0,
    play: () =>
      allowPlayback
        ? Promise.resolve()
        : Promise.reject(new DOMException("Blocked", "NotAllowedError")),
  };
  const engine = { video, tagName: "DIV", querySelector: () => video };
  const host = {
    _streamMuted: true,
    _cameraStartUnmutePending: false,
    _engine: engine,
    _findVideoDeep: () => video,
    _cameraGroupLiveController: { syncAudio: () => {} },
    _renderMuteButton: () => {},
  };
  const controller = new LiveAudioController(host, { interactionTarget });

  controller.prepareCameraStart({ start_unmuted: true });
  controller.applyCameraStartPreference();
  await new Promise((resolve) => setImmediate(resolve));

  allowPlayback = true;
  const muteButton = { id: "mute-btn" };
  interactionTarget.dispatch("touchend", {
    composedPath: () => [muteButton],
  });

  assert.equal(host._streamMuted, true);
  assert.equal(listeners.has("click"), true);

  controller.cancelCameraStartPreference();
  controller.setMuted(false);
  assert.equal(host._streamMuted, false);
  assert.equal(listeners.size, 0);
});

test("deferred startup audio observes the active HA Direct media element", async () => {
  const createTarget = () => {
    const listeners = new Map();
    return {
      listeners,
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) listeners.delete(type);
      },
      dispatch(type, event = {}) {
        listeners.get(type)?.(event);
      },
    };
  };
  const documentTarget = createTarget();
  const shadowTarget = createTarget();
  const videoTarget = createTarget();
  const video = {
    ...videoTarget,
    muted: true,
    defaultMuted: true,
    volume: 0,
    play: () => Promise.reject(new DOMException("Blocked", "NotAllowedError")),
  };
  const engine = { tagName: "HA-CAMERA-STREAM" };
  const host = {
    shadowRoot: shadowTarget,
    _streamMuted: true,
    _cameraStartUnmutePending: false,
    _engine: engine,
    _findVideoDeep: () => video,
    _cameraGroupLiveController: { syncAudio: () => {} },
    _renderMuteButton: () => {},
  };
  const controller = new LiveAudioController(host, {
    interactionTarget: documentTarget,
  });
  host._setLiveMuted = (muted) => controller.setMuted(muted);

  controller.prepareCameraStart({ start_unmuted: true });
  controller.applyCameraStartPreference();
  await new Promise((resolve) => setImmediate(resolve));

  video.dispatch("touchend");

  assert.equal(host._streamMuted, false);
  assert.equal(video.muted, false);
  assert.equal(video.listeners.size, 0);
  assert.equal(documentTarget.listeners.size, 0);
  assert.equal(shadowTarget.listeners.size, 0);
});

test("Firefox MSE attempts startup audio immediately when autoplay is allowed", async () => {
  const listeners = new Map();
  const interactionTarget = {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    dispatch(type) {
      listeners.get(type)?.();
    },
  };
  const video = {
    muted: true,
    defaultMuted: true,
    volume: 0,
    playCalls: 0,
    play() {
      this.playCalls += 1;
      return Promise.resolve();
    },
  };
  const host = {
    _streamMuted: true,
    _cameraStartUnmutePending: false,
    _engine: { video, tagName: "DIV", querySelector: () => video },
    _findVideoDeep: () => video,
    _isFirefox: () => true,
    _currentLiveStreamHint: () => "mse",
    _cameraGroupLiveController: { syncAudio: () => {} },
    _renderMuteButton: () => {},
  };
  const controller = new LiveAudioController(host, {
    setTimer: () => {},
    interactionTarget,
  });

  controller.prepareCameraStart({ start_unmuted: true });
  assert.equal(controller.applyCameraStartPreference(), true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(host._streamMuted, false);
  assert.equal(video.muted, false);
  assert.equal(video.playCalls > 0, true);
  assert.equal(listeners.size, 0);
});

test("rejected startup audio explicitly resumes the retained player muted", async () => {
  let allowPlayback = false;
  let mutedResumeCalls = 0;
  const video = {
    muted: true,
    defaultMuted: true,
    volume: 0,
    play() {
      if (allowPlayback) {
        if (this.muted) mutedResumeCalls += 1;
        return Promise.resolve();
      }
      return Promise.reject(new DOMException("Blocked", "NotAllowedError"));
    },
  };
  const host = {
    _streamMuted: true,
    _cameraStartUnmutePending: false,
    _engine: { video, tagName: "DIV", querySelector: () => video },
    _findVideoDeep: () => video,
    _cameraGroupLiveController: { syncAudio: () => {} },
    _renderMuteButton: () => {},
  };
  const controller = new LiveAudioController(host, {
    setTimer: () => {},
    interactionTarget: null,
  });

  controller.prepareCameraStart({ start_unmuted: true });
  controller.applyCameraStartPreference();
  allowPlayback = true;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(host._streamMuted, true);
  assert.equal(video.muted, true);
  assert.equal(mutedResumeCalls, 1);
});

test("changing cameras cancels a deferred startup unmute", async () => {
  const listeners = new Map();
  const interactionTarget = {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
  };
  const video = {
    muted: true,
    defaultMuted: true,
    volume: 0,
    play: () => Promise.reject(new DOMException("Blocked", "NotAllowedError")),
  };
  const host = {
    _streamMuted: true,
    _cameraStartUnmutePending: false,
    _engine: { video, tagName: "DIV", querySelector: () => video },
    _findVideoDeep: () => video,
    _cameraGroupLiveController: { syncAudio: () => {} },
    _renderMuteButton: () => {},
  };
  const controller = new LiveAudioController(host, {
    setTimer: () => {},
    interactionTarget,
  });

  controller.prepareCameraStart({ start_unmuted: true });
  controller.applyCameraStartPreference();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(listeners.size, 3);

  controller.prepareCameraStart({ start_unmuted: false });

  assert.equal(listeners.size, 0);
  assert.equal(host._cameraStartUnmutePending, false);
  assert.equal(host._streamMuted, true);
});

test("active HA Direct two-way talk preserves its isolated peer on unmute", () => {
  const haDirectTalk = createMuteChangeHost({
    haDirect: true,
    talkActive: true,
  });

  new LiveAudioController(haDirectTalk.host).applyMuteChange(false, {
    source: "two-way-talk",
  });

  assert.equal(haDirectTalk.calls.some(([name]) => name === "mount"), false);
  assert.equal(haDirectTalk.host._engineMountedMuted, false);
});

test("live audio synchronizes current and delayed replacement video elements", () => {
  const scheduled = [];
  const incomingMuteStates = [];
  const createVideo = () => ({
    muted: true,
    defaultMuted: true,
    volume: 0,
    playCalls: 0,
    play() {
      this.playCalls += 1;
      return Promise.resolve();
    },
  });
  const currentVideo = createVideo();
  const replacementVideo = createVideo();
  const engine = {
    tagName: "DIV",
    muted: true,
    defaultMuted: true,
    querySelector: () => currentVideo,
    shadowRoot: null,
  };
  let deepVideo = currentVideo;
  const host = {
    _streamMuted: true,
    _engine: engine,
    _twoWayTalkSession: {
      engine: {
        setIncomingAudioMuted(muted) {
          incomingMuteStates.push(muted);
        },
      },
    },
    _findVideoDeep: () => deepVideo,
  };
  const controller = new LiveAudioController(host, {
    setTimer(callback, delay) {
      scheduled.push({ callback, delay });
    },
  });

  controller.setMuted(false);

  assert.deepEqual(incomingMuteStates, [false]);
  assert.equal(engine.muted, false);
  assert.equal(engine.defaultMuted, false);
  assert.equal(currentVideo.muted, false);
  assert.equal(currentVideo.defaultMuted, false);
  assert.equal(currentVideo.volume, 1);
  assert.equal(currentVideo.playCalls, 1);
  assert.deepEqual(
    scheduled.map(({ delay }) => delay),
    [120, 400, 900],
  );

  deepVideo = replacementVideo;
  scheduled.forEach(({ callback }) => callback());

  assert.equal(replacementVideo.muted, false);
  assert.equal(replacementVideo.defaultMuted, false);
  assert.equal(replacementVideo.volume, 1);
  assert.equal(replacementVideo.playCalls, 3);
});

test("live audio invokes injected timers without a controller receiver", () => {
  const receivers = [];
  const host = {
    _streamMuted: false,
    _engine: {
      tagName: "VIDEO",
      muted: false,
      defaultMuted: false,
    },
    _findVideoDeep: () => null,
  };
  const controller = new LiveAudioController(host, {
    setTimer(callback, delay) {
      receivers.push({ receiver: this, callback, delay });
    },
  });

  controller.setMuted(true);

  assert.deepEqual(
    receivers.map(({ receiver, delay }) => ({ receiver, delay })),
    [
      { receiver: undefined, delay: 120 },
      { receiver: undefined, delay: 400 },
      { receiver: undefined, delay: 900 },
    ],
  );
});

test("live audio preserves the shared mute button class contract", () => {
  const controller = new LiveAudioController({ _streamMuted: true });

  assert.match(controller.buildControlMarkup(), /class="square-btn mute-btn"/);
  assert.match(controller.buildControlMarkup(), /id="mute-btn"/);
});

test("mobile talk mute markup exists only on mobile Mobile View and waits for connection", () => {
  let talkActive = false;
  const host = {
    _pageId: "mobile-view",
    _streamMuted: true,
    _isLikelyMobileClient: () => true,
    _twoWayTalkActiveForCurrentCamera: () => talkActive,
  };
  const controller = new LiveAudioController(host, {
    icons: { volOff: "muted", volOn: "audible" },
  });

  const disconnected = controller.buildMobileTalkMuteControlMarkup();
  assert.match(disconnected, /id="mobile-view-mute-btn"/);
  assert.match(disconnected, /mobile-view-talk-mute-btn/);
  assert.match(disconnected, / hidden/);

  talkActive = true;
  const connected = controller.buildMobileTalkMuteControlMarkup();
  assert.doesNotMatch(
    connected.match(/<button[^>]*id="mobile-view-mute-btn"[^>]*>/)?.[0] || "",
    / hidden/,
  );

  host._pageId = "single-view";
  assert.equal(controller.buildMobileTalkMuteControlMarkup(), "");
  host._pageId = "mobile-view";
  host._isLikelyMobileClient = () => false;
  assert.equal(controller.buildMobileTalkMuteControlMarkup(), "");
});

test("mobile talk mute follows the connected two-way-talk state", () => {
  let talkActive = false;
  let muted = true;
  const classes = new Set();
  const button = {
    id: "mobile-view-mute-btn",
    hidden: false,
    style: {},
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    attributes: new Map(),
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
  };
  const host = {
    _viewMode: "single",
    _$: (selector) =>
      selector === "#mobile-view-mute-btn" ? button : null,
    _twoWayTalkActiveForCurrentCamera: () => talkActive,
    _resolveLiveMuteControlMuted: () => muted,
  };
  const controller = new LiveAudioController(host, {
    icons: { volOff: "muted", volOn: "audible" },
  });

  controller.syncMuteButtons();
  assert.equal(button.hidden, true);
  assert.equal(button.style.display, "none");

  talkActive = true;
  muted = false;
  controller.syncMuteButtons();
  assert.equal(button.hidden, false);
  assert.equal(button.style.display, "");
  assert.equal(classes.has("active"), true);
  assert.equal(classes.has("talk-audio-active"), true);
  assert.equal(button.attributes.get("aria-pressed"), "true");
  assert.equal(button.innerHTML, "audible");
});
