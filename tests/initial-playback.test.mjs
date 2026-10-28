import { test } from "node:test";
import assert from "node:assert/strict";
import { createInitialPlayback } from "../src/shared/media/initial-playback.js";
import { LiveAudioController } from "../src/features/live/audio.ctrl.js";

const makeVideo = (denied = false) => Object.assign(new EventTarget(), {
  muted: true, defaultMuted: true, calls: [],
  play() {
    this.calls.push(this.muted);
    return denied && !this.muted
      ? Promise.reject(new DOMException("Denied", "NotAllowedError")) : Promise.resolve();
  },
});

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

  test(`selected startup audio runs before engine readiness and keeps denial on adoption (${denied})`, async () => {
    const camera = { entity: "camera.one", start_unmuted: true };
    const host = { _activeCam: camera, _engine: null, _renderMuteButton() {} };
    const controller = new LiveAudioController(host, { interactionTarget: new EventTarget() });
    controller.prepareCameraStart(camera);
    const video = makeVideo(denied);
    const playback = controller.createInitialPlayback(video, { entity: camera.entity });
    await playback.play();
    assert.equal(host._engine, null, "no late committed-engine unmute can satisfy this test");
    assert.deepEqual(video.calls, denied ? [false, true] : [false]);
    host._engine = { video };
    assert.equal(controller.applyCameraStartPreference(), true);
    assert.equal(host._streamMuted, denied);
    assert.deepEqual(video.calls, denied ? [false, true] : [false], "adoption does not repeat autoplay");
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
