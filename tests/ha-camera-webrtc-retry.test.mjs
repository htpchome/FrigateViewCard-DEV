import assert from "node:assert/strict";
import { test } from "node:test";
import { createHaCameraWebRtcRetry } from "../src/integrations/home-assistant/camera-webrtc-retry.js";
import { preserveHaCameraHlsFallback } from "../src/integrations/home-assistant/camera-stream-compat.js";
import { upstreamHaCameraStreamSelector } from "./fixtures/ha-camera-stream-selector.mjs";

const good = { hasVideo: true, hasAudio: false };
const failed = { hasVideo: false, hasAudio: false };
const fixture = ({ types = ["hls", "web_rtc"], requestHls } = {}) => {
  let time = 0;
  let updates = 0;
  let child;
  let hlsChild;
  const timers = new Set();
  const provider = {
    _streams: upstreamHaCameraStreamSelector,
    requestUpdate: () => { updates += 1; },
    shadowRoot: { querySelector: (selector) => selector === "ha-web-rtc-player" ? child : hlsChild },
  };
  const retry = createHaCameraWebRtcRetry({ provider, now: () => time,
    setTimer: (callback) => { timers.add(callback); return callback; },
    clearTimer: (callback) => timers.delete(callback),
  });
  preserveHaCameraHlsFallback(provider, undefined, { webRtcRetry: retry, requestHls });
  const select = (hls = good, rtc) => provider._streams(types, hls, rtc, true);
  const attach = () => {
    const peer = new EventTarget();
    peer.iceConnectionState = "checking";
    peer.connectionState = "connecting";
    child = { isConnected: true, _peerConnection: peer };
    retry.observe();
    return peer;
  };
  const ice = (peer, state) => {
    peer.iceConnectionState = state;
    peer.dispatchEvent(new Event("iceconnectionstatechange"));
  };
  return { retry, select, attach, ice, timers, provider,
    setTime: (value) => { time = value; }, updates: () => updates,
    setChild: (value) => { child = value; },
    getChild: () => child,
    setHlsChild: (value) => { hlsChild = value; },
  };
};

test("failed native ICE retires only WebRTC, with selection-gated 2/5 minute retries", () => {
  const f = fixture();
  const both = [{ type: "hls", visible: true }, { type: "web_rtc", visible: false }];
  const hls = [{ type: "hls", visible: true }];
  assert.deepEqual(f.select(), both);
  f.ice(f.attach(), "failed");
  assert.deepEqual(f.select(), hls);
  f.setChild(null);
  f.retry.observe();
  assert.equal(f.timers.size, 0, "no timer probes after native child teardown");
  f.setTime(119999);
  f.retry.retryIfEligible();
  assert.deepEqual(f.select(), hls);
  f.setTime(120000);
  assert.deepEqual(f.select(), hls, "expiry alone must not retry");
  f.retry.retryIfEligible();
  assert.deepEqual(f.select(), both);
  f.ice(f.attach(), "failed");
  assert.deepEqual(f.select(), hls);
  f.setTime(419999);
  f.retry.retryIfEligible();
  assert.deepEqual(f.select(), hls);
  f.setTime(420000);
  f.retry.retryIfEligible();
  assert.deepEqual(f.select(), both);
  f.retry.dispose();
});

test("failure before HLS is ready is remembered without cutting off the only candidate", () => {
  const f = fixture();
  f.select(null);
  const peer = f.attach();
  f.ice(peer, "failed");
  assert.equal(f.updates(), 0);
  // HA's restartIce has already begun another negotiation when HLS arrives.
  f.ice(peer, "checking");
  assert.deepEqual(f.select(), [{ type: "hls", visible: true }]);
  assert.equal(f.updates(), 1);
  f.retry.dispose();
});

test("ordinary disconnect, closed, superseded, and pending peers are not failed attempts", () => {
  const f = fixture();
  f.select();
  const oldPeer = f.attach();
  for (const state of ["checking", "disconnected", "closed"]) f.ice(oldPeer, state);
  const currentPeer = f.attach();
  f.ice(oldPeer, "failed");
  assert.equal(f.updates(), 0);
  assert.equal(f.timers.size, 0);
  f.ice(currentPeer, "failed");
  assert.equal(f.updates(), 1);
  f.retry.dispose();
  f.ice(currentPeer, "failed");
  assert.equal(f.updates(), 1);
});

test("discovers asynchronously created and replaced native peers and cleans up observation", () => {
  const f = fixture();
  f.select();
  const child = { isConnected: true, _peerConnection: null };
  f.setChild(child);
  f.retry.observe();
  assert.equal(f.timers.size, 1);
  const peer = new EventTarget();
  peer.iceConnectionState = "checking";
  child._peerConnection = peer;
  for (const callback of [...f.timers]) { f.timers.delete(callback); callback(); }
  assert.equal(f.timers.size, 0);
  // HA clears the old reference before its queued closed event arrives.
  child._peerConnection = null;
  f.ice(peer, "closed");
  assert.equal(f.timers.size, 1);
  assert.equal(f.updates(), 0, "native cleanup is not a failure");
  f.retry.dispose();
  assert.equal(f.timers.size, 0);
});

test("retry ignores only the stale native failure and success resets failure history", () => {
  const f = fixture();
  assert.deepEqual(f.select(good, failed), [{ type: "hls", visible: true }]);
  f.setTime(120000);
  f.retry.retryIfEligible();
  assert.equal(f.select(good, failed).length, 2);
  assert.deepEqual(f.select(good, { ...good }), [{ type: "web_rtc", visible: true }]);
  const nextFailure = { ...failed };
  assert.deepEqual(f.select(good, nextFailure), [{ type: "hls", visible: true }]);
  f.setTime(240000);
  f.retry.retryIfEligible();
  assert.equal(f.select(good, nextFailure).length, 2, "success restored the two-minute first cooldown");
  f.retry.dispose();
});

test("HLS failure bypasses cooldown and policies remain camera-local", () => {
  const a = fixture();
  const b = fixture();
  a.select(good, failed);
  assert.equal(b.select().length, 2);
  assert.deepEqual(a.select(failed, failed), [{ type: "web_rtc", visible: true }]);
  assert.equal(b.updates(), 0);
  a.retry.dispose();
  b.retry.dispose();
});

for (const failure of ["ice", "connection", "native-error"]) {
  test(`previously live WebRTC recovers through HLS after ${failure}, ignoring retained stream metadata`, () => {
    for (const previousHls of [null, good, failed]) {
      const f = fixture();
      const peer = f.attach();
      const player = f.getChild();
      peer.iceConnectionState = "connected";
      peer.connectionState = "connected";
      assert.equal(f.select(previousHls, good).find((stream) => stream.visible)?.type, "web_rtc");
      if (failure === "ice") f.ice(peer, "failed");
      else if (failure === "connection") {
        peer.connectionState = "failed";
        peer.dispatchEvent(new Event("connectionstatechange"));
      } else {
        // HA cleans up signaling errors without sending streams:false.
        player._error = "Failed to start WebRTC stream";
        player._peerConnection = undefined;
        f.ice(peer, "closed");
        f.retry.observe();
      }
      assert.ok(f.updates() > 0, "native failure must invalidate stale success without another HA event");
      assert.deepEqual(f.select(previousHls, good), [{ type: "hls", visible: true }]);
      player.isConnected = false;
      f.setChild(null);
      f.retry.observe();
      assert.equal(f.timers.size, 0);
      assert.deepEqual(f.select(previousHls, good), [{ type: "hls", visible: true }], "old HLS metadata is not fresh playback");
      const video = Object.assign(new EventTarget(), { readyState: 0, videoWidth: 0, paused: true, ended: false });
      f.setHlsChild({ isConnected: true, shadowRoot: { querySelector: () => video } });
      f.select(good, good);
      f.retry.observe();
      assert.deepEqual(f.select(good, good), [{ type: "hls", visible: true }], "manifest metadata alone cannot retry WebRTC");
      Object.assign(video, { readyState: 2, videoWidth: 640, paused: false });
      video.dispatchEvent(new Event("playing"));
      assert.deepEqual(f.select(good, good), [
        { type: "hls", visible: true }, { type: "web_rtc", visible: false },
      ], "restored HLS permits one fresh native WebRTC attempt without a cooldown");
      const nextPeer = f.attach();
      nextPeer.iceConnectionState = "connected";
      const nextStreams = { ...good };
      assert.deepEqual(f.select(good, nextStreams), [{ type: "web_rtc", visible: true }]);
      f.setHlsChild(null);
      f.ice(nextPeer, "failed");
      assert.deepEqual(f.select(good, nextStreams), [{ type: "hls", visible: true }], "a later outage recovers independently");
      assert.deepEqual(good, { hasVideo: true, hasAudio: false }, "never mutate HA metadata");
      f.retry.dispose();
    }
  });
}

test("failed post-outage WebRTC retry returns to the existing bounded HLS-only policy", () => {
  const f = fixture();
  const peer = f.attach();
  f.select(good, good);
  f.ice(peer, "failed");
  assert.deepEqual(f.select(good, good), [{ type: "hls", visible: true }]);
  f.setChild(null);
  const video = Object.assign(new EventTarget(), {
    readyState: 2, videoWidth: 640, paused: false, ended: false,
  });
  f.setHlsChild({ isConnected: true, shadowRoot: { querySelector: () => video } });
  f.retry.observe();
  assert.equal(f.select(good, good).length, 2);
  f.ice(f.attach(), "failed");
  assert.deepEqual(f.select(good, good), [{ type: "hls", visible: true }]);
  f.setTime(119999);
  f.retry.retryIfEligible();
  assert.equal(f.select(good, good).length, 1);
  f.setTime(120000);
  f.retry.retryIfEligible();
  assert.equal(f.select(good, good).length, 2);
  f.retry.dispose();
});

test("ordinary disconnect and hidden cleanup of previously live WebRTC do not start outage recovery", () => {
  const f = fixture();
  const peer = f.attach();
  f.select(good, good);
  f.ice(peer, "disconnected");
  assert.deepEqual(f.select(good, good), [{ type: "web_rtc", visible: true }]);
  f.getChild()._peerConnection = undefined;
  f.ice(peer, "closed");
  assert.equal(f.updates(), 0);
  assert.deepEqual(f.select(good, good), [{ type: "web_rtc", visible: true }]);
  f.retry.dispose();
  assert.equal(f.timers.size, 0);
});

test("a terminal HLS error during recovery permits a fresh native WebRTC attempt", () => {
  const f = fixture();
  const peer = f.attach();
  f.select(good, good);
  f.ice(peer, "failed");
  f.select(good, good);
  f.setChild(null);
  const hls = { isConnected: true, _error: "Unsupported HLS stream", _errorIsFatal: false };
  f.setHlsChild(hls);
  f.select(failed, good);
  f.retry.observe();
  assert.deepEqual(f.select(failed, good), [{ type: "hls", visible: true }], "retryable HLS is left to its recovery owner");
  hls._errorIsFatal = true;
  f.retry.observe();
  assert.deepEqual(f.select(failed, good), [{ type: "web_rtc", visible: true }]);
  f.retry.dispose();
});

test("post-outage recovery requires advertised or verified HLS and never fabricates support", async () => {
  for (const verified of [false, true]) {
    const f = fixture({ types: ["web_rtc"], requestHls: async () => verified
      ? { url: "/api/hls/synthetic/master_playlist.m3u8" } : null });
    const peer = f.attach();
    f.select(null, good);
    await Promise.resolve();
    f.select(null, good);
    f.ice(peer, "failed");
    assert.deepEqual(f.select(null, good), [{ type: verified ? "hls" : "web_rtc", visible: true }]);
    f.retry.dispose();
  }
});

test("disposal removes the post-outage HLS media recovery listeners", () => {
  const f = fixture();
  const peer = f.attach();
  f.select(good, good);
  f.ice(peer, "failed");
  assert.deepEqual(f.select(good, good), [{ type: "hls", visible: true }]);
  f.setChild(null);
  const video = Object.assign(new EventTarget(), { readyState: 0, videoWidth: 0, paused: true });
  f.setHlsChild({ isConnected: true, shadowRoot: { querySelector: () => video } });
  f.retry.observe();
  const updates = f.updates();
  f.retry.dispose();
  Object.assign(video, { readyState: 2, videoWidth: 640, paused: false });
  video.dispatchEvent(new Event("playing"));
  video.dispatchEvent(new Event("timeupdate"));
  assert.equal(f.updates(), updates, "late HLS media after disposal cannot restart WebRTC");
  assert.equal(f.timers.size, 0);
});

test("a native error flag with retained video and terminal stream metadata keep their existing paths", () => {
  const f = fixture();
  const peer = f.attach();
  const video = new EventTarget();
  f.getChild().shadowRoot = { querySelector: () => video };
  f.select(good, good);
  f.getChild()._error = "Still recovering";
  f.retry.observe();
  assert.equal(f.updates(), 0);
  assert.deepEqual(f.select(good, good), [{ type: "web_rtc", visible: true }]);
  assert.deepEqual(f.select(failed, failed), [{ type: "mjpeg", visible: true }]);
  assert.equal(f.updates(), 0);
  assert.equal(peer.iceConnectionState, "checking");
  f.retry.dispose();
});
