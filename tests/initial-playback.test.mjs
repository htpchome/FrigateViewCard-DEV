import { test } from "node:test";
import assert from "node:assert/strict";
import { createInitialPlayback } from "../src/shared/media/initial-playback.js";
import { LiveAudioController } from "../src/features/live/audio.ctrl.js";

const makeVideo = (denied = false) => Object.assign(new EventTarget(), {
  muted: true, defaultMuted: true, readyState: 2, calls: [],
  play() {
    this.calls.push(this.muted);
    return denied && !this.muted
      ? Promise.reject(new DOMException("Denied", "NotAllowedError")) : Promise.resolve();
  },
});

for (const denied of [false, true]) {
  test(`data-gated initial playback waits without consuming attempts (denied=${denied})`, async () => {
    const video = Object.assign(makeVideo(denied), { readyState: 0 });
    const playback = createInitialPlayback(video, { getMuted: () => false, waitForData: true });
    for (let i = 0; i < 5; i += 1) {
      await playback.play();
      video.dispatchEvent(new Event("loadedmetadata"));
    }
    assert.deepEqual(video.calls, []);
    assert.equal(playback.state.started, false);
    video.readyState = 2;
    video.dispatchEvent(new Event("loadeddata"));
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(video.calls, denied ? [false, true] : [false]);
    video.dispatchEvent(new Event("canplay"));
    assert.deepEqual(video.calls, denied ? [false, true] : [false]);
    playback.dispose();
  });
}

test("disposing a data-gated initial request prevents later loaded audio", async () => {
  const video = Object.assign(makeVideo(), { readyState: 0 });
  const playback = createInitialPlayback(video, { getMuted: () => false, waitForData: true });
  await playback.play();
  playback.dispose();
  video.readyState = 2;
  video.dispatchEvent(new Event("loadeddata"));
  await playback.play();
  assert.deepEqual(video.calls, []);
});

for (const action of ["manual-mute", "camera-change", "dispose"]) {
  test(`startup cancellation releases provider playback ownership once: ${action}`, () => {
    const camera = { entity: "camera.one", start_unmuted: true };
    const host = { _activeCam: camera, _engine: null, _renderMuteButton() {}, _setLiveMuted() {} };
    const controller = new LiveAudioController(host, { interactionTarget: new EventTarget() });
    controller.prepareCameraStart(camera);
    let releases = 0;
    const playback = controller.createInitialPlayback(makeVideo(), {
      entity: camera.entity, onDispose: () => { releases += 1; }, waitForData: true,
    });
    if (action === "manual-mute") controller.applyMuteChange(true);
    if (action === "camera-change") controller.prepareCameraStart({ entity: "camera.two" });
    if (action === "dispose") controller.dispose();
    assert.equal(releases, 1);
    playback.dispose();
    controller.dispose();
    assert.equal(releases, 1);
  });
}

test("live startup loads muted then unmutes immediately before its first loadeddata play", async () => {
  const camera = { entity: "camera.one", start_unmuted: true };
  const video = Object.assign(makeVideo(), { readyState: 0 });
  const host = {
    _activeCam: camera,
    _engine: null,
    _renderMuteButton() {},
  };
  const controller = new LiveAudioController(host, {
    interactionTarget: new EventTarget(),
  });
  controller.prepareCameraStart(camera);

  const playback = controller.createInitialPlayback(video, {
    entity: camera.entity,
  });
  assert.equal(video.preload, "auto", "holding autoplay must not defer source loading");
  assert.equal(video.muted, true, "selected output remains muted while media loads");
  await playback.play();

  assert.deepEqual(video.calls, [], "cold startup does not create a muted autoplay session");
  video.readyState = 2;
  video.dispatchEvent(new Event("loadeddata"));
  await Promise.resolve();
  assert.deepEqual(video.calls, [false], "loaded media is unmuted immediately before first play");
  controller.dispose();
});

for (const action of ["loaded", "manual-mute", "camera-change", "hidden", "dispose"]) {
  test(`transport adoption before loadeddata preserves the loaded audio attempt: ${action}`, async () => {
    const camera = { entity: "camera.one", start_unmuted: true };
    const video = Object.assign(makeVideo(), { readyState: 0 });
    video.play = function () {
      this.calls.push({ muted: this.muted, readyState: this.readyState });
      return !this.muted && this.readyState < 2
        ? Promise.reject(new DOMException("Early audible playback denied", "NotAllowedError"))
        : Promise.resolve();
    };
    const target = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const host = { _activeCam: camera, _engine: null, _renderMuteButton() {}, _findVideoDeep: engine => engine?.video };
    const controller = new LiveAudioController(host, { interactionTarget: target });
    host._setLiveMuted = muted => controller.setMuted(muted, { startPlayback: false, synchronizeLater: false });
    controller.prepareCameraStart(camera);
    await controller.createInitialPlayback(video, { entity: camera.entity }).play();
    host._engine = { video };
    controller.applyCameraStartPreference();
    controller.applyCameraStartPreference();
    video.dispatchEvent(new Event("canplay"));
    assert.deepEqual(video.calls, [], "adoption before loadeddata must not play early");
    if (action === "manual-mute") controller.applyMuteChange(true);
    if (action === "camera-change") controller.prepareCameraStart({ entity: "camera.two" });
    if (action === "hidden") target.visibilityState = "hidden";
    if (action === "dispose") controller.dispose();
    video.readyState = 2;
    video.dispatchEvent(new Event("loadeddata"));
    await Promise.resolve();
    assert.equal(video.muted, action !== "loaded");
    assert.equal(video.calls.length, action === "loaded" ? 1 : 0);
    if (action === "loaded") assert.deepEqual(video.calls.at(-1), { muted: false, readyState: 2 });
    controller.dispose();
  });
}

for (const denied of [false, true]) {
  test(`initial playback requests audio before first play and handles denial (${denied})`, async () => {
    const video = makeVideo(denied);
    const playback = createInitialPlayback(video, { getMuted: () => false });
    await playback.play();
    assert.deepEqual(video.calls, denied ? [false, true] : [false]);
    assert.equal(video.muted, denied);
    video.dispatchEvent(new Event("canplay"));
    assert.equal(video.calls.length, denied ? 2 : 1);
    playback.dispose();
  });

  test(`selected startup audio reapplies its preference once the player is loaded (${denied})`, async () => {
    const camera = { entity: "camera.one", start_unmuted: true };
    const host = { _activeCam: camera, _engine: null, _renderMuteButton() {}, _findVideoDeep: (engine) => engine?.video };
    const controller = new LiveAudioController(host, { interactionTarget: new EventTarget() });
    controller.prepareCameraStart(camera);
    const video = makeVideo(denied);
    const playback = controller.createInitialPlayback(video, { entity: camera.entity });
    await playback.play();
    assert.equal(host._engine, null, "no late committed-engine unmute can satisfy this test");
    assert.deepEqual(video.calls, denied ? [false, true] : [false]);
    host._engine = { video };
    assert.equal(controller.applyCameraStartPreference(), true);
    await Promise.resolve();
    assert.equal(host._streamMuted, denied);
    assert.equal(controller.resolveStartupMuted(camera.entity), denied,
      "provider loading updates must preserve a loaded-playback denial");
    assert.deepEqual(video.calls, denied ? [false, true, false, true] : [false]);
    controller.applyCameraStartPreference();
    video.dispatchEvent(new Event("canplay"));
    assert.equal(video.calls.length, denied ? 4 : 1, "repeated readiness cannot loop unmute");
    controller.dispose();
  });
}

for (const action of ["loaded", "manual-mute", "camera-change", "hidden", "dispose"]) {
  test(`early denial followed by allowed loaded playback respects ${action}`, async () => {
    const camera = { entity: "camera.one", start_unmuted: true };
    const video = makeVideo();
    let allowed = false;
    video.play = function () {
      this.calls.push(this.muted);
      return this.muted || allowed ? Promise.resolve()
        : Promise.reject(new DOMException("Denied", "NotAllowedError"));
    };
    const target = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const host = { _activeCam: camera, _engine: null, _renderMuteButton() {}, _findVideoDeep: (engine) => engine?.video };
    const controller = new LiveAudioController(host, { interactionTarget: target });
    host._setLiveMuted = (muted) => controller.setMuted(muted, { startPlayback: false, synchronizeLater: false });
    controller.prepareCameraStart(camera);
    await controller.createInitialPlayback(video, { entity: camera.entity }).play();
    host._engine = { video };
    allowed = true;
    if (action === "manual-mute") controller.applyMuteChange(true);
    if (action === "camera-change") controller.prepareCameraStart({ entity: "camera.two", start_unmuted: false });
    if (action === "hidden") target.visibilityState = "hidden";
    if (action === "dispose") controller.dispose();
    video.dispatchEvent(new Event("loadeddata"));
    controller.applyCameraStartPreference();
    await Promise.resolve();
    assert.equal(video.muted, action !== "loaded");
    assert.deepEqual(video.calls, action === "loaded" ? [false, true, false] : [false, true]);
    controller.dispose();
  });
}

test("a late initial denial cannot remute the successful loaded-player attempt", async () => {
  const camera = { entity: "camera.one", start_unmuted: true };
  const video = makeVideo();
  let rejectInitial;
  video.play = function () {
    this.calls.push(this.muted);
    return this.calls.length === 1 ? new Promise((_resolve, reject) => { rejectInitial = reject; }) : Promise.resolve();
  };
  const host = { _activeCam: camera, _engine: null, _renderMuteButton() {}, _findVideoDeep: (engine) => engine?.video };
  const controller = new LiveAudioController(host, { interactionTarget: null });
  controller.prepareCameraStart(camera);
  const pending = controller.createInitialPlayback(video, { entity: camera.entity }).play();
  host._engine = { video };
  controller.applyCameraStartPreference();
  rejectInitial(new DOMException("Stale denial", "NotAllowedError"));
  await pending;
  assert.deepEqual(video.calls, [false, false]);
  assert.equal(video.muted, false);
  assert.equal(host._streamMuted, false);
  controller.dispose();
});

test("racing candidates, background cameras and cancelled starts cannot introduce extra audio", async () => {
  const camera = { entity: "camera.one", start_unmuted: true };
  const host = { _activeCam: camera, _engine: null, _renderMuteButton() {} };
  const controller = new LiveAudioController(host, { interactionTarget: null });
  controller.prepareCameraStart(camera);
  const first = makeVideo();
  const second = makeVideo();
  const a = controller.createInitialPlayback(first, { entity: camera.entity });
  const b = controller.createInitialPlayback(second, { entity: camera.entity });
  assert.equal(controller.createInitialPlayback(makeVideo(), { entity: "camera.two" }), null);
  await a.play();
  await b.play();
  assert.deepEqual(first.calls, [false]);
  assert.deepEqual(second.calls, [true]);
  controller.prepareCameraStart({ entity: "camera.two", start_unmuted: false });
  assert.equal(first.muted, true);
  first.dispatchEvent(new Event("canplay"));
  await a.play();
  assert.deepEqual(first.calls, [false]);
  controller.dispose();
});

test("an interrupted initial request retries at readiness without forcing mute", async () => {
  const video = makeVideo();
  video.play = function () {
    this.calls.push(this.muted);
    return this.calls.length === 1
      ? Promise.reject(new DOMException("Interrupted", "AbortError")) : Promise.resolve();
  };
  const playback = createInitialPlayback(video, { getMuted: () => false });
  await playback.play();
  assert.equal(video.muted, false);
  video.dispatchEvent(new Event("canplay"));
  await Promise.resolve();
  assert.deepEqual(video.calls, [false, false]);
  playback.dispose();
});

test("a denied audible request never retries audio when muted playback is interrupted", async () => {
  const video = makeVideo();
  video.play = function () {
    this.calls.push(this.muted);
    if (this.calls.length === 1) return Promise.reject(new DOMException("Denied", "NotAllowedError"));
    if (this.calls.length === 2) return Promise.reject(new DOMException("Interrupted", "AbortError"));
    return Promise.resolve();
  };
  const playback = createInitialPlayback(video, { getMuted: () => false });
  await playback.play();
  video.dispatchEvent(new Event("canplay"));
  await Promise.resolve();
  assert.deepEqual(video.calls, [false, true, true]);
  assert.equal(playback.state.requestedUnmuted, true);
  assert.equal(playback.state.blocked, true);
  playback.dispose();
});

test("initial playback ignores a stale denial", async () => {
  const video = makeVideo();
  let reject;
  video.play = () => new Promise((resolve, fail) => { reject = fail; });
  let current = true;
  const playback = createInitialPlayback(video, { getMuted: () => false, isCurrent: () => current });
  const pending = playback.play();
  current = false;
  reject(new DOMException("Denied", "NotAllowedError"));
  await pending;
  assert.equal(video.muted, false, "a stale rejection cannot change the next owner's mute choice");
  playback.dispose();
});
