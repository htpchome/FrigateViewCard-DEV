import assert from "node:assert/strict";
import { test } from "node:test";
import { preserveHaCameraHlsFallback } from "../src/integrations/home-assistant/camera-stream-compat.js";
import { upstreamHaCameraStreamSelector } from "./fixtures/ha-camera-stream-selector.mjs";

const both = ["hls", "web_rtc"];
const good = { hasAudio: true, hasVideo: true };
const failed = { hasAudio: false, hasVideo: false };
const provider = () => preserveHaCameraHlsFallback({ _streams: upstreamHaCameraStreamSelector });

test("reproduces HA's muted HLS fallback defect and corrects it locally", () => {
  assert.deepEqual(upstreamHaCameraStreamSelector(both, good, failed, true),
    [{ type: "mjpeg", visible: true }]);
  for (const muted of [true, false]) {
    for (const hasAudio of [true, false]) {
      assert.deepEqual(provider()._streams(both, { ...good, hasAudio }, failed, muted),
        [{ type: "hls", visible: true }]);
    }
  }
  assert.deepEqual(upstreamHaCameraStreamSelector(both, good, failed, true),
    [{ type: "mjpeg", visible: true }]);
});

test("leaves every other capability, pending, successful and failure branch to HA", () => {
  const adapted = provider();
  for (const types of [undefined, [], ["hls"], ["web_rtc"], both]) {
    for (const hls of [undefined, good, failed]) {
      for (const rtc of [undefined, good, failed]) {
        for (const muted of [true, false]) {
          if (types === both && hls === good && rtc === failed && muted) continue;
          assert.deepEqual(adapted._streams(types, hls, rtc, muted),
            upstreamHaCameraStreamSelector(types, hls, rtc, muted));
        }
      }
    }
  }
});

test("does not replace a future upstream fix and fails explicitly for an unknown selector", () => {
  const result = [{ type: "hls", visible: true }];
  assert.equal(preserveHaCameraHlsFallback({ _streams: () => result })
    ._streams(both, good, failed, true), result);
  assert.throws(() => preserveHaCameraHlsFallback({}), /Unsupported Home Assistant/);
});

const verificationFixture = () => {
  let resolve;
  let reject;
  const request = new Promise((yes, no) => { resolve = yes; reject = no; });
  const state = { requests: 0, updates: 0, disposed: false, selection: null };
  const adapted = preserveHaCameraHlsFallback({
    _streams: upstreamHaCameraStreamSelector,
    requestUpdate: () => { state.updates += 1; },
  }, (streams, status) => { state.selection = { streams, ...status }; }, {
    requestHls: () => { state.requests += 1; return request; },
    isDestroyed: () => state.disposed,
  });
  return { adapted, state, resolve, reject };
};

test("WebRTC-only capabilities verify HLS immediately even if WebRTC never reports failure", async () => {
  const { adapted, state, resolve } = verificationFixture();
  const types = Object.freeze(["web_rtc"]);
  assert.deepEqual(adapted._streams(types, undefined, undefined, true), [{ type: "web_rtc", visible: true }]);
  assert.equal(state.requests, 1);
  assert.equal(state.selection.hlsPending, true);
  resolve({ url: "/api/hls/synthetic/master_playlist.m3u8" });
  await Promise.resolve();
  assert.equal(state.updates, 1);
  assert.deepEqual(adapted._streams(types, undefined, undefined, true), [
    { type: "hls", visible: true }, { type: "web_rtc", visible: false },
  ]);
  assert.deepEqual(adapted._streams(types, good, undefined, true), [
    { type: "hls", visible: true }, { type: "web_rtc", visible: false },
  ]);
  assert.deepEqual(adapted._streams(types, good, good, true), [{ type: "web_rtc", visible: true }]);
  assert.equal(state.selection.hlsPending, false);
  assert.equal(state.requests, 1);
  assert.deepEqual(types, ["web_rtc"]);
});

test("explicit WebRTC failure waits for in-flight HLS verification, not a timeout", async () => {
  const { adapted, state, resolve } = verificationFixture();
  adapted._streams(["web_rtc"], undefined, failed, true);
  assert.equal(state.selection.hlsPending, true);
  resolve({ url: "/api/hls/synthetic/master_playlist.m3u8" });
  await Promise.resolve();
  assert.deepEqual(adapted._streams(["web_rtc"], undefined, failed, true), [{ type: "hls", visible: true }]);
  assert.deepEqual(adapted._streams(["web_rtc"], good, failed, true), [{ type: "hls", visible: true }]);
});

test("does not create a late HLS child when WebRTC is already usable", async () => {
  const { adapted, state, resolve } = verificationFixture();
  adapted._streams(["web_rtc"], undefined, undefined, true);
  resolve({ url: "/api/hls/synthetic/master_playlist.m3u8" });
  await Promise.resolve();
  for (const muted of [true, false]) {
    assert.deepEqual(adapted._streams(["web_rtc"], undefined, good, muted), [{ type: "web_rtc", visible: true }]);
  }
  assert.equal(state.requests, 1);
});

test("unavailable HLS never fabricates support, retries, or interferes with WebRTC", async () => {
  for (const result of [null, {}, { url: "" }, { url: 123 }, new Error("unavailable")]) {
    const { adapted, state, resolve, reject } = verificationFixture();
    adapted._streams(["web_rtc"], undefined, undefined, true);
    if (result instanceof Error) reject(result);
    else resolve(result);
    await Promise.resolve();
    for (const rtc of [undefined, good, failed]) {
      assert.deepEqual(adapted._streams(["web_rtc"], undefined, rtc, true),
        upstreamHaCameraStreamSelector(["web_rtc"], undefined, rtc, true));
    }
    assert.equal(state.selection.hlsPending, false);
    assert.equal(state.requests, 1);
    assert.equal(state.updates, 1);
  }
});

test("HLS verification is provider-local and does not run for advertised HLS", async () => {
  const a = verificationFixture();
  const b = verificationFixture();
  for (const types of [undefined, [], ["hls"], both]) a.adapted._streams(types, undefined, undefined, true);
  assert.equal(a.state.requests, 0);
  a.adapted._streams(["web_rtc"], undefined, undefined, true);
  a.state.disposed = true;
  a.resolve({ url: "/api/hls/synthetic/master_playlist.m3u8" });
  await Promise.resolve();
  assert.equal(a.state.updates, 0);
  b.adapted._streams(["web_rtc"], undefined, undefined, true);
  assert.equal(b.state.requests, 1);
  assert.equal(b.state.selection.hlsPending, true);
});
