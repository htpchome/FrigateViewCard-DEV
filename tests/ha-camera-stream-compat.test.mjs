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
