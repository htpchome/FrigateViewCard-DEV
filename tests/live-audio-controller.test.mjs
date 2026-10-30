import { test } from "node:test";
import assert from "node:assert/strict";

import { LiveAudioController } from "../src/features/live/audio.ctrl.js";

const createHarness = ({
  readyState = 2,
  playError = null,
  isMobilePhone = false,
} = {}) => {
  const video = Object.assign(new EventTarget(), {
    muted: true,
    defaultMuted: true,
    volume: 0,
    readyState,
    playStates: [],
    play() {
      this.playStates.push({ muted: this.muted, readyState: this.readyState });
      return playError ? Promise.reject(playError) : Promise.resolve();
    },
  });
  const engine = { type: "frigate_go2rtc", video };
  const timers = [];
  const interactionTarget = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  });
  const host = {
    _activeCam: { entity: "camera.front", start_unmuted: true },
    _isLikelyPhoneClient: () => isMobilePhone,
    _engine: engine,
    _streamMuted: true,
    _engineMountedMuted: true,
    _findVideoDeep: () => video,
    _renderMuteButton() {},
  };
  const controller = new LiveAudioController(host, {
    interactionTarget,
    setTimer: (callback) => timers.push(callback),
  });
  host._setLiveMuted = (muted) => controller.setMuted(muted);
  return { controller, engine, host, interactionTarget, timers, video };
};

test("selected live media receives one direct unmute/play action", async () => {
  const h = createHarness();
  h.controller.prepareCameraStart(h.host._activeCam);
  assert.equal(h.controller.applyCameraStartPreference(), true);
  await Promise.resolve();
  assert.deepEqual(h.video.playStates, [{ muted: false, readyState: 2 }]);
  assert.equal(h.video.muted, false);
  assert.equal(h.video.defaultMuted, true);
  assert.equal(h.video.volume, 1);
  assert.equal(h.host._streamMuted, false);
  assert.equal(h.timers.length, 0);
});

test("selected action runs on assignment and repeats when media loads", async () => {
  const h = createHarness({ readyState: 0 });
  h.controller.prepareCameraStart(h.host._activeCam);
  assert.equal(h.controller.applyCameraStartPreference(), true);
  await Promise.resolve();
  assert.deepEqual(h.video.playStates, [{ muted: false, readyState: 0 }]);
  assert.equal(h.video.muted, false);
  h.video.readyState = 2;
  h.video.dispatchEvent(new Event("loadeddata"));
  await Promise.resolve();
  assert.deepEqual(h.video.playStates, [
    { muted: false, readyState: 0 },
    { muted: false, readyState: 2 },
  ]);
  assert.equal(h.video.muted, false);
});

test("only one connected startup candidate owns selected audio", async () => {
  const h = createHarness({ readyState: 0 });
  const second = Object.assign(new EventTarget(), {
    muted: true,
    volume: 0,
    readyState: 0,
    playStates: [],
    play() {
      this.playStates.push(this.muted);
      return Promise.resolve();
    },
  });
  h.controller.prepareCameraStart(h.host._activeCam);
  assert.equal(h.controller.prepareSelectedPlayback(h.video, {
    entity: "camera.front",
  }), true);
  assert.equal(h.controller.prepareSelectedPlayback(second, {
    entity: "camera.front",
  }), false);
  assert.equal(h.video.muted, false);
  assert.equal(second.muted, true);
  assert.equal(h.controller.releasePreparedPlayback(h.video), true);
  assert.equal(h.controller.prepareSelectedPlayback(second, {
    entity: "camera.front",
  }), true);
  assert.equal(second.muted, false);
});

test("a denied audible play resumes muted without adding a tap fallback", async () => {
  const h = createHarness({
    playError: new DOMException("Blocked", "NotAllowedError"),
  });
  let pageInteractions = 0;
  h.interactionTarget.addEventListener = () => { pageInteractions += 1; };
  h.controller.prepareCameraStart(h.host._activeCam);
  h.controller.applyCameraStartPreference();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.video.muted, true);
  assert.equal(h.host._streamMuted, true);
  assert.deepEqual(h.video.playStates, [
    { muted: false, readyState: 2 },
    { muted: true, readyState: 2 },
  ]);
  assert.equal(pageInteractions, 0);
});

test("manual mute cancels a pending configured unmute", async () => {
  const h = createHarness({ readyState: 0 });
  h.controller.prepareCameraStart(h.host._activeCam);
  h.controller.applyCameraStartPreference();
  h.controller.applyMuteChange(true);
  h.video.readyState = 2;
  h.video.dispatchEvent(new Event("loadeddata"));
  await Promise.resolve();
  assert.equal(h.video.muted, true);
  assert.equal(h.host._streamMuted, true);
  assert.deepEqual(h.video.playStates, []);
});

test("a loaded race candidate receives the source-ready action before adoption", async () => {
  const h = createHarness({ readyState: 0 });
  h.host._engine = null;
  h.controller.prepareCameraStart(h.host._activeCam);
  assert.equal(h.controller.prepareSelectedPlayback(h.video, {
    entity: "camera.front",
  }), true);
  await Promise.resolve();
  assert.deepEqual(h.video.playStates, [
    { muted: false, readyState: 0 },
  ]);

  h.video.readyState = 2;
  h.video.dispatchEvent(new Event("loadeddata"));
  await Promise.resolve();
  assert.deepEqual(h.video.playStates, [
    { muted: false, readyState: 0 },
    { muted: false, readyState: 2 },
  ]);

  h.host._engine = h.engine;
  assert.equal(h.controller.applyCameraStartPreference(), true);
  await Promise.resolve();
  assert.deepEqual(h.video.playStates, [
    { muted: false, readyState: 0 },
    { muted: false, readyState: 2 },
  ]);
});

test("an offscreen-ready stream re-applies selected audio before visible load", async () => {
  const h = createHarness({ readyState: 0 });
  h.host._engine = null;
  h.controller.prepareCameraStart(h.host._activeCam);
  assert.equal(h.controller.prepareSelectedPlayback(h.video, {
    entity: "camera.front",
  }), true);
  await Promise.resolve();

  h.video.muted = true;
  assert.equal(h.controller.notifySelectedPlaybackReady(h.video), true);
  await Promise.resolve();
  assert.deepEqual(h.video.playStates, [
    { muted: false, readyState: 0 },
    { muted: false, readyState: 0 },
  ]);
  assert.equal(h.video.muted, false);
});

test("camera without the option remains muted", () => {
  const h = createHarness();
  h.controller.prepareCameraStart({ entity: "camera.front", start_unmuted: false });
  assert.equal(h.controller.applyCameraStartPreference(), false);
  assert.equal(h.video.muted, true);
  assert.deepEqual(h.video.playStates, []);
});

test("PC/tablet startup audio ignores the mobile-phone preference", () => {
  const h = createHarness();
  h.controller.prepareCameraStart({
    entity: "camera.front",
    start_unmuted_mobile: true,
  });
  assert.equal(h.controller.applyCameraStartPreference(), false);
  assert.equal(h.video.muted, true);
});

test("mobile-phone startup audio uses only the mobile-phone preference", async () => {
  const h = createHarness({ isMobilePhone: true });
  h.controller.prepareCameraStart({
    entity: "camera.front",
    start_unmuted: true,
  });
  assert.equal(h.controller.applyCameraStartPreference(), false);

  h.controller.prepareCameraStart({
    entity: "camera.front",
    start_unmuted_mobile: true,
  });
  assert.equal(h.controller.applyCameraStartPreference(), true);
  await Promise.resolve();
  assert.equal(h.video.muted, false);
  assert.deepEqual(h.video.playStates, [{ muted: false, readyState: 2 }]);
});

test("hidden documents do not apply configured audio", () => {
  const h = createHarness();
  h.interactionTarget.visibilityState = "hidden";
  h.controller.prepareCameraStart(h.host._activeCam);
  assert.equal(h.controller.applyCameraStartPreference(), false);
  assert.equal(h.video.muted, true);
});

test("manual audio changes do not remount the live transport", () => {
  const h = createHarness();
  const originalEngine = h.host._engine;
  h.controller.applyMuteChange(false);
  h.controller.applyMuteChange(true);
  assert.equal(h.host._engine, originalEngine);
});
