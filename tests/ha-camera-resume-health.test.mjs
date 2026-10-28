import assert from "node:assert/strict";
import { test } from "node:test";
import { checkHaCameraResume } from "../src/integrations/home-assistant/camera-resume-health.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const fixture = ({ rtc = true } = {}) => {
  const timers = new Map();
  const results = [];
  let frameCount = 100;
  let bytesReceived = 1000;
  let reads = 0;
  const video = Object.assign(new EventTarget(), {
    currentTime: 10, paused: false, ended: false, muted: false,
    getAttribute: () => "blob:synthetic",
    getVideoPlaybackQuality: () => ({ totalVideoFrames: frameCount }),
    play: async () => { video.paused = false; },
  });
  const peer = {
    connectionState: "connected", iceConnectionState: "connected",
    getStats: async () => {
      reads += 1;
      return new Map([["video", { id: "video", type: "inbound-rtp", kind: "video", bytesReceived }]]);
    },
  };
  const player = {
    tagName: rtc ? "HA-WEB-RTC-PLAYER" : "HA-HLS-PLAYER",
    localName: rtc ? "ha-web-rtc-player" : "ha-hls-player", isConnected: true,
    _peerConnection: peer, shadowRoot: { querySelector: () => video },
  };
  const provider = { shadowRoot: { querySelectorAll: () => [player] } };
  const begin = () => checkHaCameraResume({ provider, onResult: (value) => results.push(value),
    setTimer: (callback, ms) => { timers.set(callback, ms); return callback; },
    clearTimer: (id) => timers.delete(id),
  });
  const tick = async (ms) => {
    for (const [callback, delay] of [...timers]) if (delay === ms) {
      timers.delete(callback);
      callback();
    }
    await flush();
  };
  const progress = ({ incoming = true, decoded = true, seconds = 0.5 } = {}) => {
    if (incoming) bytesReceived += 500;
    if (decoded) { frameCount += 10; video.currentTime += seconds; }
    video.dispatchEvent(new Event("timeupdate"));
  };
  return { begin, video, player, peer, provider, results, timers, tick, progress, reads: () => reads };
};

test("reuses a WebRTC player only after foreground video data and decoding advance", async () => {
  const f = fixture();
  f.begin();
  await flush();
  f.progress();
  assert.deepEqual(f.results, [], "a frame alone is not proof of fresh WebRTC data");
  await f.tick(150);
  assert.deepEqual(f.results, [true]);
  assert.equal(f.reads(), 2);
  assert.equal(f.timers.size, 0);
  assert.equal(f.video.muted, false);
});

for (const condition of ["no-data", "no-frames", "frozen", "rejected-stats", "hung-stats"]) {
  test(`connected flag cannot retain ${condition} WebRTC indefinitely`, async () => {
    const f = fixture();
    if (condition === "rejected-stats") f.peer.getStats = async () => { throw new Error("Unavailable"); };
    if (condition === "hung-stats") f.peer.getStats = () => new Promise(() => {});
    f.begin();
    await flush();
    f.progress({ incoming: condition !== "no-data" && condition !== "frozen",
      decoded: condition !== "no-frames" && condition !== "frozen" });
    await f.tick(150);
    assert.deepEqual(f.results, []);
    await f.tick(1500);
    assert.deepEqual(f.results, [false]);
    assert.equal(f.timers.size, 0);
  });
}

for (const condition of ["missing-peer", "closed", "failed", "ended-track", "cleared-hls", "fatal-hls"]) {
  test(`released ${condition} is rejected synchronously without a timer`, () => {
    const f = fixture({ rtc: !condition.includes("hls") });
    if (condition === "missing-peer") f.player._peerConnection = undefined;
    if (condition === "closed" || condition === "failed") f.peer.connectionState = condition;
    if (condition === "ended-track") f.video.srcObject = { getVideoTracks: () => [{ readyState: "ended" }] };
    if (condition === "cleared-hls") {
      f.video.getAttribute = () => null;
      f.video.currentSrc = "blob:stale-source-after-load";
    }
    if (condition === "fatal-hls") { f.player._error = "fatal"; f.player._errorIsFatal = true; }
    f.begin();
    assert.deepEqual(f.results, [false]);
    assert.equal(f.timers.size, 0);
    assert.equal(f.reads(), 0);
  });
}

test("HLS retains advancing playback and rejects a frozen picture", async () => {
  for (const advancing of [true, false]) {
    const f = fixture({ rtc: false });
    f.begin();
    if (advancing) f.progress();
    await f.tick(1500);
    assert.deepEqual(f.results, [advancing]);
    assert.equal(f.reads(), 0);
    assert.equal(f.timers.size, 0);
  }
});

test("time progress is a fallback only when decoded-frame counters are unavailable", async () => {
  const f = fixture({ rtc: false });
  f.video.getVideoPlaybackQuality = undefined;
  f.begin();
  f.progress();
  assert.deepEqual(f.results, [true]);
});

test("one final queued frame after suspension is not enough to retain a frozen HLS player", async () => {
  const f = fixture({ rtc: false });
  f.begin();
  f.progress({ seconds: 0.01 });
  assert.deepEqual(f.results, []);
  await f.tick(1500);
  assert.deepEqual(f.results, [false]);
});

test("a paused retained video resumes without changing mute; autoplay denial does not reconnect", async () => {
  for (const blocked of [false, true]) {
    const f = fixture({ rtc: false });
    f.video.paused = true;
    if (blocked) f.video.play = async () => { throw Object.assign(new Error("Blocked"), { name: "NotAllowedError" }); };
    f.begin();
    await flush();
    if (!blocked) f.progress();
    assert.deepEqual(f.results, [true]);
    assert.equal(f.video.muted, false);
    assert.equal(f.timers.size, 0);
  }
});

test("cancellation and child replacement cannot accept late stats or leave timers running", async () => {
  for (const cancel of [true, false]) {
    const f = fixture();
    let resolve;
    f.peer.getStats = () => new Promise((done) => { resolve = done; });
    const stop = f.begin();
    if (cancel) stop();
    else f.provider.shadowRoot.querySelectorAll = () => [];
    resolve(new Map());
    await flush();
    f.progress();
    await f.tick(1500);
    assert.deepEqual(f.results, cancel ? [] : [false]);
    assert.equal(f.timers.size, 0);
  }
});
