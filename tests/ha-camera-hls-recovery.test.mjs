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
    getAttribute: () => null,
  });
  const player = { isConnected: true, _errorIsFatal: false,
    shadowRoot: { querySelector: () => video } };
  let child = player;
  let updates = 0;
  const ownerDocument = Object.assign(new EventTarget(), { hidden: false });
  const provider = { _streams: upstreamHaCameraStreamSelector, ownerDocument,
    shadowRoot: { querySelector: () => child }, requestUpdate: () => { updates += 1; } };
  const recovery = createHaCameraHlsRecovery(provider, options);
  preserveHaCameraHlsFallback(provider, undefined, { hlsRecovery: recovery });
  const select = (hls, rtc, types = ["hls", "web_rtc"]) => provider._streams(types, hls, rtc, true);
  return { video, player, recovery, select, ownerDocument, updates: () => updates,
    setChild: (value) => { child = value; } };
};

test("an expired master after background cleanup stays mounted before HA reports an error", async () => {
  let requests = 0;
  let respond;
  const f = fixture({ requestHls: () => {
    requests += 1;
    return new Promise((resolve) => { respond = resolve; });
  } });
  f.select(good, failed);
  // HA's hidden-tab cleanup empties the video. On return an expired master
  // reports streams:false BEFORE Hls.js exists or emits a retryable error.
  f.video.readyState = 0;
  f.video.currentTime = 0;
  assert.deepEqual(f.select(failed, failed, ["hls"]), [{ type: "hls", visible: true }]);
  // MEDIA_ATTACHED resets the native error and adds a blob URL while the HA
  // websocket URL request is still pending. This is not successful playback.
  f.video.getAttribute = () => "blob:synthetic";
  respond({ url: "/api/hls/resumed/master_playlist.m3u8" });
  await Promise.resolve();
  assert.equal(requests, 1);
  assert.equal(f.player.url, "/api/hls/resumed/master_playlist.m3u8");
  f.recovery.dispose();
});

test("a failed manifest with the same HA URL reloads through the existing player's public input", async () => {
  const url = "/api/hls/retained/master_playlist.m3u8";
  const f = fixture({ requestHls: async () => ({ url }) });
  f.player._url = url;
  f.player.url = url;
  f.player._hlsPolyfillInstance = { levels: [] };
  const updates = [];
  f.player.requestUpdate = (...args) => updates.push(args);
  f.player._error = "Stream never started";
  f.select(failed);
  await Promise.resolve();
  assert.deepEqual(updates, [["url", undefined]], "startLoad cannot retry an unparsed manifest");
  f.recovery.dispose();
});

test("background failures wait for visibility and late responses cannot reset resumed playback", async () => {
  let requests = 0;
  let respond;
  const f = fixture({ requestHls: () => {
    requests += 1;
    return new Promise((resolve) => { respond = resolve; });
  } });
  f.select(good, failed);
  f.ownerDocument.hidden = true;
  f.player._error = "Stream network error";
  f.select(failed, failed);
  assert.equal(requests, 0);
  // HA resets its error before starting the old URL on foreground return.
  f.player._error = undefined;
  f.video.readyState = 0;
  f.ownerDocument.hidden = false;
  f.ownerDocument.dispatchEvent(new Event("visibilitychange"));
  assert.equal(requests, 0, "HA is already starting the cleared player; do not race its master fetch");
  f.select({ ...failed }, failed);
  assert.equal(requests, 1);
  f.select(good, failed);
  respond({ url: "/api/hls/late/master_playlist.m3u8" });
  await Promise.resolve();
  assert.equal(f.player.url, undefined);
  f.recovery.dispose();
  f.ownerDocument.dispatchEvent(new Event("visibilitychange"));
  assert.equal(requests, 1);
});

test("a short hidden interruption resumes a deferred retry without a native restart", async () => {
  let requests = 0;
  const f = fixture({ requestHls: async () => {
    requests += 1;
    return { url: "/api/hls/recovered/master_playlist.m3u8" };
  } });
  f.select(good, failed);
  f.ownerDocument.hidden = true;
  f.player._error = "Stream network error";
  f.select(failed, failed);
  assert.equal(requests, 0);
  f.ownerDocument.hidden = false;
  f.ownerDocument.dispatchEvent(new Event("visibilitychange"));
  await Promise.resolve();
  assert.equal(requests, 1);
  assert.equal(f.player.url, "/api/hls/recovered/master_playlist.m3u8");
  f.recovery.dispose();
});

test("short background returns and healthy HLS never request a replacement URL", () => {
  let requests = 0;
  const f = fixture({ requestHls: async () => { requests += 1; return {}; } });
  f.select(good, failed);
  f.ownerDocument.hidden = true;
  f.ownerDocument.dispatchEvent(new Event("visibilitychange"));
  f.ownerDocument.hidden = false;
  f.ownerDocument.dispatchEvent(new Event("visibilitychange"));
  assert.equal(requests, 0);
  f.recovery.dispose();
});

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
