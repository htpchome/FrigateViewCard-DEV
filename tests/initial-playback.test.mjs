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

test("selected startup candidates do not play until committed with loaded data", async () => {
  const camera = { entity: "camera.one", start_unmuted: true };
  const video = makeVideo();
  const host = { _activeCam: camera, _engine: null, _renderMuteButton() {},
    _findVideoDeep: (engine) => engine?.video };
  const controller = new LiveAudioController(host, { interactionTarget: new EventTarget() });
  controller.prepareCameraStart(camera);
  let releases = 0;
  const playback = controller.createInitialPlayback(video, { entity: camera.entity,
    onDispose: () => { releases += 1; } });
  assert.equal(video.preload, "auto", "holding autoplay must not defer source loading");
  await playback.play();
  video.dispatchEvent(new Event("loadeddata"));
  await Promise.resolve();
  assert.deepEqual(video.calls, [], "a hidden loading candidate must not establish muted autoplay");
  assert.equal(video.muted, true);
  host._engine = { video };
  assert.equal(controller.applyCameraStartPreference(), true);
  await Promise.resolve();
  assert.deepEqual(video.calls, [false], "the committed visible player receives the first play request");
  assert.equal(host._streamMuted, false);
  assert.equal(releases, 1);
  controller.dispose();
});

for (const action of ["loaded", "manual-mute", "camera-change", "hidden", "dispose"]) {
  test(`visible adoption waits for data, then respects ${action}`, async () => {
    const camera = { entity: "camera.one", start_unmuted: true };
    const video = Object.assign(makeVideo(), { readyState: 0 });
    const target = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const host = { _activeCam: camera, _engine: null, _renderMuteButton() {}, _findVideoDeep: engine => engine?.video };
    const controller = new LiveAudioController(host, { interactionTarget: target });
    host._setLiveMuted = muted => controller.setMuted(muted, { startPlayback: false, synchronizeLater: false });
    controller.prepareCameraStart(camera);
    await controller.createInitialPlayback(video, { entity: camera.entity }).play();
    host._engine = { video };
    controller.applyCameraStartPreference();
    assert.deepEqual(video.calls, []);
    if (action === "manual-mute") controller.applyMuteChange(true);
    if (action === "camera-change") controller.prepareCameraStart({ entity: "camera.two" });
    if (action === "hidden") target.visibilityState = "hidden";
    if (action === "dispose") controller.dispose();
    video.readyState = 2;
    video.dispatchEvent(new Event("loadeddata"));
    await Promise.resolve();
    assert.equal(video.muted, action !== "loaded");
    assert.deepEqual(video.calls, action === "loaded" ? [false] : []);
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

  test(`selected visible startup handles autoplay denial (${denied})`, async () => {
    const camera = { entity: "camera.one", start_unmuted: true };
    const host = { _activeCam: camera, _engine: null, _renderMuteButton() {}, _findVideoDeep: (engine) => engine?.video };
    const controller = new LiveAudioController(host, { interactionTarget: new EventTarget() });
    controller.prepareCameraStart(camera);
    const video = makeVideo(denied);
    const playback = controller.createInitialPlayback(video, { entity: camera.entity });
    await playback.play();
    assert.deepEqual(video.calls, []);
    host._engine = { video };
    assert.equal(controller.applyCameraStartPreference(), true);
    await Promise.resolve();
    assert.equal(host._streamMuted, denied);
    assert.deepEqual(video.calls, denied ? [false, true] : [false]);
    controller.applyCameraStartPreference();
    video.dispatchEvent(new Event("canplay"));
    assert.equal(video.calls.length, denied ? 2 : 1, "repeated readiness cannot loop unmute");
    controller.dispose();
  });
}

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
  assert.deepEqual(first.calls, []);
  assert.deepEqual(second.calls, []);
  controller.prepareCameraStart({ entity: "camera.two", start_unmuted: false });
  assert.equal(first.muted, true);
  first.dispatchEvent(new Event("canplay"));
  await a.play();
  assert.deepEqual(first.calls, []);
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
