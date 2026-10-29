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

const flushMicrotasks = async (count = 8) => {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
};

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

test("selected startup owner repeats ACC's early action when media loads", async () => {
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
  await flushMicrotasks();
  assert.deepEqual(video.calls, [false, false],
    "the selected owner receives the pre-source and loaded-media actions");
  assert.equal(video.muted, false);
  host._engine = { video };
  assert.equal(controller.applyCameraStartPreference(), true);
  await Promise.resolve();
  assert.deepEqual(video.calls, [false, false],
    "adopting an already-audible owner must not request a third play");
  assert.equal(host._streamMuted, false);
  assert.equal(releases, 1);
  controller.dispose();
});

test("go2rtc repeats its loaded-media action only after the race winner is committed", async () => {
  const video = makeVideo();
  const playback = createInitialPlayback(video, {
    getMuted: () => false,
    reapplyOnLoadedData: true,
    deferUntilCommit: true,
    deferLoadedReapplyUntilCommit: true,
  });

  await playback.play();
  video.dispatchEvent(new Event("loadeddata"));
  await flushMicrotasks();
  assert.deepEqual(video.calls, [], "hidden race readiness must not request audible playback");

  playback.commit();
  await flushMicrotasks();
  assert.deepEqual(video.calls, [false], "the adopted winner receives media-loaded audio");
  playback.dispose();
});

test("adopting a go2rtc winner does not duplicate its committed loaded action", async () => {
  const camera = { entity: "camera.one", start_unmuted: true };
  const video = makeVideo();
  const host = {
    _activeCam: camera,
    _engine: null,
    _renderMuteButton() {},
    _findVideoDeep: (engine) => engine?.video,
  };
  const controller = new LiveAudioController(host, {
    interactionTarget: new EventTarget(),
  });
  controller.prepareCameraStart(camera);
  let releases = 0;
  const playback = controller.createInitialPlayback(video, {
    entity: camera.entity,
    deferUntilCommit: true,
    deferLoadedReapplyUntilCommit: true,
    onDispose: () => { releases += 1; },
  });

  await playback.play();
  video.dispatchEvent(new Event("loadeddata"));
  host._engine = { video };
  playback.commit();
  controller.applyCameraStartPreference();
  await flushMicrotasks();

  assert.deepEqual(video.calls, [false]);
  assert.equal(host._streamMuted, false);
  assert.equal(releases, 1);
  controller.dispose();
});

test("each muted go2rtc race candidate may reserve a visible-commit action", () => {
  const camera = { entity: "camera.one", start_unmuted: true };
  const host = { _activeCam: camera, _engine: null, _renderMuteButton() {} };
  const controller = new LiveAudioController(host, { interactionTarget: null });
  controller.prepareCameraStart(camera);
  const firstVideo = makeVideo();
  const first = controller.createInitialPlayback(firstVideo, {
    entity: camera.entity,
    deferUntilCommit: true,
  });
  const second = controller.createInitialPlayback(makeVideo(), {
    entity: camera.entity,
    deferUntilCommit: true,
  });
  assert.ok(first);
  assert.ok(second);
  first.commit();
  assert.equal(controller._initialAudioOwner, firstVideo);
  controller.dispose();
});

test("adopting an early autoplay denial does not veto ACC's loaded-media retry", async () => {
  const camera = { entity: "camera.one", start_unmuted: true };
  const video = Object.assign(makeVideo(), { readyState: 0, loaded: false });
  video.play = function () {
    this.calls.push(this.muted);
    return !this.muted && !this.loaded
      ? Promise.reject(new DOMException("Denied", "NotAllowedError"))
      : Promise.resolve();
  };
  const target = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const host = {
    _activeCam: camera,
    _engine: null,
    _renderMuteButton() {},
    _findVideoDeep: (engine) => engine?.video,
  };
  const controller = new LiveAudioController(host, { interactionTarget: target });
  controller.prepareCameraStart(camera);
  const playback = controller.createInitialPlayback(video, { entity: camera.entity });

  await playback.play();
  assert.deepEqual(video.calls, [false, true]);
  assert.equal(playback.state.blocked, true);

  host._engine = { video };
  assert.equal(controller.applyCameraStartPreference(), true);
  assert.equal(host._streamMuted, true);

  video.loaded = true;
  video.readyState = 2;
  video.dispatchEvent(new Event("loadeddata"));
  await flushMicrotasks();

  assert.deepEqual(video.calls, [false, true, false],
    "the loaded-media action must retry audio after muted playback starts");
  assert.equal(video.muted, false);
  assert.equal(host._streamMuted, false);
  controller.dispose();
});

test("selected startup owner ignores readiness events ACC does not act on", async () => {
  const camera = { entity: "camera.one", start_unmuted: true };
  const video = Object.assign(makeVideo(), { readyState: 0 });
  video.play = function () {
    this.calls.push(this.muted);
    return this.calls.length === 1
      ? Promise.reject(new DOMException("Interrupted", "AbortError"))
      : Promise.resolve();
  };
  const host = {
    _activeCam: camera,
    _engine: null,
    _renderMuteButton() {},
    _findVideoDeep: (engine) => engine?.video,
  };
  const controller = new LiveAudioController(host, {
    interactionTarget: new EventTarget(),
  });
  controller.prepareCameraStart(camera);
  const playback = controller.createInitialPlayback(video, {
    entity: camera.entity,
  });

  await playback.play();
  video.dispatchEvent(new Event("loadedmetadata"));
  video.dispatchEvent(new Event("canplay"));
  await flushMicrotasks();
  assert.deepEqual(video.calls, [false],
    "metadata and canplay must not add playback requests between ACC's two actions");

  video.readyState = 2;
  video.dispatchEvent(new Event("loadeddata"));
  await flushMicrotasks();
  assert.deepEqual(video.calls, [false, false]);
  assert.equal(video.muted, false);
  controller.dispose();
});

test("selected startup preserves ACC's asynchronous unmute-before-play boundary", async () => {
  const video = makeVideo();
  const playback = createInitialPlayback(video, {
    getMuted: () => false,
    settleAroundMute: true,
  });

  const pending = playback.play();
  assert.equal(video.muted, true);
  assert.deepEqual(video.calls, []);
  await Promise.resolve();
  assert.equal(video.muted, false);
  assert.deepEqual(video.calls, [], "play waits for the unmute controller action to settle");
  await pending;
  assert.deepEqual(video.calls, [false]);
  playback.dispose();
});

test("selected startup publishes provider unmute before requesting playback", async () => {
  const order = [];
  const video = makeVideo();
  video.play = () => {
    order.push("play");
    return Promise.resolve();
  };
  const playback = createInitialPlayback(video, {
    getMuted: () => false,
    onPlayRequested: () => order.push("unmute"),
  });

  await playback.play();
  assert.deepEqual(order, ["unmute", "play"]);
  playback.dispose();
});

for (const action of ["loaded", "manual-mute", "camera-change", "hidden", "dispose"]) {
  test(`early selected action respects ${action}`, async () => {
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
    assert.deepEqual(video.calls, [false]);
    if (action === "manual-mute") controller.applyMuteChange(true);
    if (action === "camera-change") controller.prepareCameraStart({ entity: "camera.two" });
    if (action === "hidden") target.visibilityState = "hidden";
    if (action === "dispose") controller.dispose();
    video.readyState = 2;
    video.dispatchEvent(new Event("loadeddata"));
    await flushMicrotasks();
    assert.equal(video.muted, action !== "loaded");
    assert.deepEqual(video.calls, action === "loaded" ? [false, false] : [false]);
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
    assert.deepEqual(video.calls, denied ? [false, true] : [false]);
    host._engine = { video };
    assert.equal(controller.applyCameraStartPreference(), true);
    await Promise.resolve();
    assert.equal(host._streamMuted, denied);
    assert.deepEqual(video.calls, denied ? [false, true] : [false]);
    video.dispatchEvent(new Event("loadeddata"));
    await flushMicrotasks();
    assert.deepEqual(video.calls, denied ? [false, true, false, true] : [false, false]);
    controller.applyCameraStartPreference();
    video.dispatchEvent(new Event("canplay"));
    assert.equal(video.calls.length, denied ? 4 : 2,
      "repeated readiness cannot loop unmute");
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
  assert.equal(b, null, "only one racing candidate may own startup audio");
  assert.equal(controller.createInitialPlayback(makeVideo(), { entity: "camera.two" }), null);
  await a.play();
  assert.deepEqual(first.calls, [false]);
  assert.deepEqual(second.calls, []);
  controller.prepareCameraStart({ entity: "camera.two", start_unmuted: false });
  assert.equal(first.muted, true);
  first.dispatchEvent(new Event("canplay"));
  await a.play();
  assert.deepEqual(first.calls, [false]);
  controller.dispose();
});

test("committing a pre-source owner does not add an action before loaded media", async () => {
  const video = makeVideo();
  video.readyState = 0;
  const playback = createInitialPlayback(video, {
    getMuted: () => false,
    reapplyOnLoadedData: true,
    deferLoadedReapplyUntilCommit: true,
  });

  await playback.play();
  assert.deepEqual(video.calls, [false]);
  playback.commit();
  await Promise.resolve();
  assert.deepEqual(video.calls, [false]);

  video.readyState = 2;
  video.dispatchEvent(new Event("loadeddata"));
  await Promise.resolve();
  assert.deepEqual(video.calls, [false, false]);
  playback.dispose();
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
