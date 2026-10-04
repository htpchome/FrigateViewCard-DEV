import assert from "node:assert/strict";
import { test } from "node:test";
import { createHaCameraHlsRecovery } from "../src/integrations/home-assistant/camera-hls-recovery.js";
import { preserveHaCameraHlsFallback } from "../src/integrations/home-assistant/camera-stream-compat.js";
import { upstreamHaCameraStreamSelector } from "./fixtures/ha-camera-stream-selector.mjs";

const good = Object.freeze({ hasVideo: true, hasAudio: true });
const failed = Object.freeze({ hasVideo: false, hasAudio: false });
const fixture = (options = {}) => {
  const video = Object.assign(new EventTarget(), {
    currentTime: 10, readyState: 4, videoWidth: 160, paused: false,
  });
  const player = { isConnected: true, _errorIsFatal: false,
    shadowRoot: { querySelector: () => video } };
  let child = player;
  let updates = 0;
  const provider = { _streams: upstreamHaCameraStreamSelector,
    shadowRoot: { querySelector: () => child }, requestUpdate: () => { updates += 1; } };
  const recovery = createHaCameraHlsRecovery(provider, options);
  preserveHaCameraHlsFallback(provider, undefined, { hlsRecovery: recovery });
  const select = (hls, rtc, types = ["hls", "web_rtc"]) => provider._streams(types, hls, rtc, true);
  return { video, player, recovery, select, updates: () => updates,
    setChild: (value) => { child = value; } };
};

test("retryable HLS stays mounted for native recovery with pending or failed WebRTC", () => {
  for (const rtc of [undefined, failed]) {
    const f = fixture();
    f.select(good, rtc);
    f.player._error = "Stream network error";
    const streams = f.select(failed, rtc);
    assert.deepEqual(streams, rtc ? [{ type: "hls", visible: true }] : [
      { type: "hls", visible: true }, { type: "web_rtc", visible: false },
    ]);
    assert.equal(f.recovery.adjustStreams(failed), undefined, "retrying is not ready");
    assert.deepEqual(f.select(failed, rtc, ["hls"]), [{ type: "hls", visible: true }]);
    f.recovery.dispose();
  }
});

test("expired HLS URLs refresh through the public player input without request storms", async () => {
  let time = 0;
  let requests = 0;
  let respond;
  const f = fixture({ now: () => time, resolveUrl: (url) => `https://ha.example${url}`,
    requestHls: () => { requests += 1; return new Promise((resolve) => { respond = resolve; }); } });
  f.player._url = "https://ha.example/api/hls/old/master_playlist.m3u8";
  f.player._error = "Stream never started";
  f.select(failed);
  f.select({ ...failed });
  assert.equal(requests, 1);
  respond({ url: "/api/hls/new/master_playlist.m3u8" });
  await Promise.resolve();
  assert.equal(f.player.url, "https://ha.example/api/hls/new/master_playlist.m3u8");
  f.select({ ...failed });
  assert.equal(requests, 1);
  time = 5000;
  f.select({ ...failed });
  assert.equal(requests, 2);
  f.recovery.dispose();
  respond({ url: "/api/hls/late/master_playlist.m3u8" });
  await Promise.resolve();
  assert.equal(f.player.url, "https://ha.example/api/hls/new/master_playlist.m3u8");
});

test("unchanged and late-after-recovery URLs cannot reload working HLS", async () => {
  let respond;
  let time = 0;
  const f = fixture({ now: () => time,
    requestHls: () => new Promise((resolve) => { respond = resolve; }) });
  f.player._url = "/api/hls/retained/master_playlist.m3u8";
  f.player._error = "Stream network error";
  f.select(failed);
  respond({ url: f.player._url });
  await Promise.resolve();
  assert.equal(f.player.url, undefined, "same URL stays under native HA retry");
  time = 5000;
  f.select({ ...failed });
  f.player._error = undefined;
  respond({ url: "/api/hls/late/master_playlist.m3u8" });
  await Promise.resolve();
  assert.equal(f.player.url, undefined, "native recovery finished before the URL request");
  f.recovery.dispose();
});

test("an unavailable HA URL retries after backend recovery without further player errors", async () => {
  const timers = new Map();
  let time = 0;
  let calls = 0;
  const f = fixture({ now: () => time,
    setTimer: (callback, delay) => { timers.set(callback, delay); return callback; },
    clearTimer: (timer) => timers.delete(timer),
    requestHls: async () => {
      calls += 1;
      if (calls === 1) throw new Error("Backend unavailable");
      return { url: "/api/hls/recovered/master_playlist.m3u8" };
    } });
  f.player._error = "Stream network error";
  f.select(failed);
  await Promise.resolve();
  assert.deepEqual([...timers.values()], [5000]);
  time = 5000;
  const [retry] = timers.keys();
  timers.delete(retry);
  retry();
  await Promise.resolve();
  assert.equal(calls, 2);
  assert.equal(f.player.url, "/api/hls/recovered/master_playlist.m3u8");
  assert.equal(timers.size, 0);
  f.recovery.dispose();
});

test("a second outage inside the rate limit gets a deferred URL request without another error event", async () => {
  const timers = new Map();
  let time = 0;
  let calls = 0;
  const f = fixture({ now: () => time,
    setTimer: (callback, delay) => { timers.set(callback, delay); return callback; },
    clearTimer: (timer) => timers.delete(timer),
    requestHls: async () => ({ url: `/api/hls/session-${++calls}/master_playlist.m3u8` }) });
  f.player._error = "Stream network error";
  f.select(failed);
  await Promise.resolve();
  time = 1000;
  f.select({ ...failed });
  assert.deepEqual([...timers.values()], [4000]);
  time = 5000;
  const [retry] = timers.keys();
  timers.delete(retry);
  retry();
  await Promise.resolve();
  assert.equal(calls, 2);
  assert.equal(f.player.url, "/api/hls/session-2/master_playlist.m3u8");
  f.recovery.dispose();
});

test("native error clearing plus fresh playback repairs stale status without mutating HA", () => {
  const f = fixture();
  f.select(good, failed);
  f.player._error = "Stream network error";
  f.select(failed, failed);
  f.video.currentTime = 11;
  f.video.dispatchEvent(new Event("timeupdate"));
  assert.equal(f.updates(), 0, "buffered frames during the outage do not complete recovery");
  f.player._error = undefined;
  f.video.dispatchEvent(new Event("timeupdate"));
  assert.equal(f.updates(), 1);
  assert.equal(f.recovery.adjustStreams(failed), good);
  assert.deepEqual(failed, { hasVideo: false, hasAudio: false });
  assert.deepEqual(f.select(failed, good), [{ type: "web_rtc", visible: true }]);
  f.video.currentTime = 12;
  f.video.dispatchEvent(new Event("timeupdate"));
  assert.equal(f.updates(), 1, "progress listener is removed after recovery");
  f.recovery.dispose();
});

test("repeated outages need new progress, including a restarted media timeline", () => {
  const f = fixture();
  f.select(good);
  for (const time of [11, 0.5]) {
    const status = { ...failed };
    f.player._error = "Stream network error";
    f.select(status);
    f.player._error = undefined;
    f.video.dispatchEvent(new Event("playing"));
    assert.equal(f.recovery.adjustStreams(status), undefined);
    f.video.currentTime = time;
    f.video.dispatchEvent(new Event("timeupdate"));
    assert.equal(f.recovery.adjustStreams(status), good);
  }
  assert.equal(f.updates(), 2);
  f.recovery.dispose();
});

test("terminal errors, unknown native state, removal, and disposal are not retries", () => {
  for (const fatal of [true, undefined]) {
    const f = fixture();
    f.player._error = "Cannot decode";
    f.player._errorIsFatal = fatal;
    assert.equal(f.recovery.adjustStreams(failed), failed);
    f.recovery.dispose();
  }
  const f = fixture();
  assert.equal(f.recovery.adjustStreams(failed), failed, "no retryable error evidence");
  f.player._error = "Stream network error";
  f.select(failed);
  f.setChild(null);
  f.recovery.observe();
  f.player._error = undefined;
  f.video.currentTime = 11;
  f.video.dispatchEvent(new Event("timeupdate"));
  assert.equal(f.updates(), 0);
  assert.equal(f.recovery.adjustStreams(failed), failed);
  f.setChild(f.player);
  f.player._error = "Stream network error";
  f.select(failed);
  f.recovery.dispose();
  f.player._error = undefined;
  f.video.currentTime = 12;
  f.video.dispatchEvent(new Event("timeupdate"));
  assert.equal(f.updates(), 0);
});
