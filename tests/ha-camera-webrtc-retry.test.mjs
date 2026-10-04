import assert from "node:assert/strict";
import { test } from "node:test";
import { createHaCameraWebRtcRetry } from "../src/integrations/home-assistant/camera-webrtc-retry.js";
import { preserveHaCameraHlsFallback } from "../src/integrations/home-assistant/camera-stream-compat.js";
import { upstreamHaCameraStreamSelector } from "./fixtures/ha-camera-stream-selector.mjs";

const good = { hasVideo: true, hasAudio: false };
const failed = { hasVideo: false, hasAudio: false };
const fixture = () => {
  let time = 0;
  let updates = 0;
  let child;
  const timers = new Set();
  const provider = {
    _streams: upstreamHaCameraStreamSelector,
    requestUpdate: () => { updates += 1; },
    shadowRoot: { querySelector: () => child },
  };
  const retry = createHaCameraWebRtcRetry({ provider, now: () => time,
    setTimer: (callback) => { timers.add(callback); return callback; },
    clearTimer: (callback) => timers.delete(callback),
  });
  preserveHaCameraHlsFallback(provider, undefined, { webRtcRetry: retry });
  const select = (hls = good, rtc) => provider._streams(["hls", "web_rtc"], hls, rtc, true);
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
