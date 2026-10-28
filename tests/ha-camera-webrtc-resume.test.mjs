import { test } from "node:test";
import assert from "node:assert/strict";
import { createHaCameraWebRtcResume } from "../src/integrations/home-assistant/camera-webrtc-resume.js";

const fixture = () => {
  const document = Object.assign(new EventTarget(), { hidden: false, defaultView: new EventTarget() });
  const video = Object.assign(new EventTarget(), {
    currentTime: 10, readyState: 4, videoWidth: 640, paused: false, ended: false,
    decoded: 100, playCalls: 0,
    getVideoPlaybackQuality() { return { totalVideoFrames: this.decoded }; },
    play() { this.playCalls += 1; this.paused = false; return Promise.resolve(); },
  });
  const player = { isConnected: true, shadowRoot: { querySelector: () => video } };
  let currentPlayer = player;
  let usable = true;
  const provider = { ownerDocument: document, shadowRoot: { querySelector: () => currentPlayer } };
  const timers = new Map();
  const stalled = [];
  const resume = createHaCameraWebRtcResume({
    provider, isUsable: (target) => usable && target === player,
    onStalled: (target) => stalled.push(target),
    setTimer: (callback, delay) => { timers.set(callback, delay); return callback; },
    clearTimer: (callback) => timers.delete(callback),
  });
  const visibility = (hidden) => {
    document.hidden = hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  };
  const expire = () => { for (const callback of [...timers.keys()]) { timers.delete(callback); callback(); } };
  const progress = () => {
    video.decoded += 1;
    video.currentTime += 0.1;
    video.dispatchEvent(new Event("timeupdate"));
  };
  return { document, provider, player, video, resume, stalled, timers, visibility, expire, progress,
    replace: (target) => { currentPlayer = target; }, setUsable: (value) => { usable = value; } };
};

test("foreground detects silent established stalls even with cached readiness and a running media clock", () => {
  const f = fixture();
  f.visibility(true);
  assert.equal(f.timers.size, 0, "no probing while backgrounded");
  f.visibility(false);
  assert.deepEqual([...f.timers.values()], [10000]);
  f.video.currentTime += 10;
  f.video.dispatchEvent(new Event("timeupdate"));
  assert.equal(f.timers.size, 1, "media clock alone cannot override a frozen decoded-frame count");
  f.expire();
  assert.deepEqual(f.stalled, [f.player]);
  assert.equal(f.timers.size, 0, "one check, no continual reconnect loop");
  f.resume.dispose();
});

test("healthy foreground return preserves the player and cancels the progress check", () => {
  const f = fixture();
  f.visibility(true); f.visibility(false); f.progress(); f.expire();
  assert.deepEqual(f.stalled, []);
  assert.equal(f.video.playCalls, 0, "already playing video is not restarted");
  assert.equal(f.timers.size, 0);
  f.resume.dispose();
});

test("an ordinary paused foreground video resumes without transport recovery", () => {
  const f = fixture();
  f.visibility(true);
  f.video.paused = true;
  f.video.muted = false;
  f.visibility(false);
  assert.equal(f.video.playCalls, 1);
  assert.equal(f.video.muted, false, "preserve audio choice");
  f.progress(); f.expire();
  assert.deepEqual(f.stalled, []);
  f.resume.dispose();
});

test("autoplay denial is not treated as a failed connection", async () => {
  const f = fixture();
  f.visibility(true);
  f.video.paused = true;
  f.video.play = () => Promise.reject(new DOMException("Blocked", "NotAllowedError"));
  f.visibility(false);
  await Promise.resolve();
  assert.equal(f.timers.size, 0);
  f.expire();
  assert.deepEqual(f.stalled, []);
  f.resume.dispose();
});

test("dormant cameras wait until presented and switching away cancels the check", () => {
  const f = fixture();
  f.resume.setPresented(false);
  f.visibility(true); f.visibility(false);
  assert.equal(f.timers.size, 0);
  f.resume.setPresented(true);
  assert.equal(f.timers.size, 1);
  f.resume.setPresented(true);
  assert.equal(f.timers.size, 1, "presentation refresh does not reschedule");
  f.resume.setPresented(false);
  assert.equal(f.timers.size, 0);
  f.resume.setPresented(true); f.expire();
  assert.deepEqual(f.stalled, [f.player]);
  f.resume.dispose();
});

for (const reason of ["hidden", "replaced", "disposed", "transport hidden", "no longer usable"]) {
  test(`foreground check cannot recover stale media after ${reason}`, () => {
    const f = fixture();
    f.visibility(true); f.visibility(false);
    if (reason === "hidden") f.visibility(true);
    if (reason === "replaced") { f.replace({}); f.resume.observe(); }
    if (reason === "disposed") f.resume.dispose();
    if (reason === "transport hidden") f.player.hidden = true;
    if (reason === "no longer usable") f.setUsable(false);
    f.expire();
    assert.deepEqual(f.stalled, []);
    f.resume.dispose();
  });
}

test("cold startup and duplicate visible notifications never create a recovery timeout", () => {
  const f = fixture();
  f.visibility(false);
  assert.equal(f.timers.size, 0);
  f.setUsable(false);
  f.visibility(true); f.visibility(false);
  assert.equal(f.timers.size, 0);
  f.expire();
  assert.deepEqual(f.stalled, []);
  f.resume.dispose();
});

test("bfcache page return and visibility events share one foreground check", () => {
  const f = fixture();
  f.document.defaultView.dispatchEvent(new Event("pagehide"));
  f.visibility(true); f.visibility(false);
  const timer = [...f.timers.keys()][0];
  f.document.defaultView.dispatchEvent(new Event("pageshow"));
  assert.deepEqual([...f.timers.keys()], [timer]);
  f.progress(); f.expire();
  assert.deepEqual(f.stalled, []);
  f.resume.dispose();
});

test("pagehide defers presentation checks even before document.hidden catches up", () => {
  const f = fixture();
  f.resume.setPresented(false);
  f.document.defaultView.dispatchEvent(new Event("pagehide"));
  f.resume.setPresented(true);
  assert.equal(f.timers.size, 0);
  f.document.defaultView.dispatchEvent(new Event("pageshow"));
  assert.equal(f.timers.size, 1);
  f.progress(); f.expire();
  assert.deepEqual(f.stalled, []);
  f.resume.dispose();
});

test("clients without decoded-frame counters can confirm playback progress by media time", () => {
  const f = fixture();
  delete f.video.getVideoPlaybackQuality;
  f.visibility(true); f.visibility(false); f.progress(); f.expire();
  assert.deepEqual(f.stalled, []);
  f.resume.dispose();
});

test("zero-only frame counters do not misclassify healthy resumed playback", () => {
  const f = fixture();
  f.video.getVideoPlaybackQuality = () => ({ totalVideoFrames: 0 });
  f.visibility(true); f.visibility(false); f.progress(); f.expire();
  assert.deepEqual(f.stalled, []);
  f.resume.dispose();
});

test("HA's own restart can reset counters on the same video and still resume normally", () => {
  const f = fixture();
  f.visibility(true); f.visibility(false);
  f.video.currentTime = 0.5;
  f.video.decoded = 3;
  f.video.dispatchEvent(new Event("timeupdate"));
  f.expire();
  assert.deepEqual(f.stalled, []);
  f.resume.dispose();
});

test("picture-in-picture playback keeps its native background lifecycle", () => {
  const f = fixture();
  f.document.pictureInPictureElement = f.video;
  f.visibility(true); f.visibility(false);
  assert.equal(f.timers.size, 0);
  f.resume.dispose();
});

test("a late cancelled callback cannot clear a newer foreground check", () => {
  const f = fixture();
  f.visibility(true); f.visibility(false);
  const oldTimer = [...f.timers.keys()][0];
  f.visibility(true); f.visibility(false);
  oldTimer();
  assert.equal(f.timers.size, 1);
  f.expire();
  assert.deepEqual(f.stalled, [f.player]);
  f.resume.dispose();
});
