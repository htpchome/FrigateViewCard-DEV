import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildRecordingPlaybackPlan,
  resolveRecordingPlaybackAlignment,
  shouldPreferRecordingHls,
} from "../../src/features/recordings/utils/playback.js";

test("recording playback prefers seekable HLS across supported browsers", () => {
  assert.equal(shouldPreferRecordingHls({ isSafari: true }), true);
  assert.equal(shouldPreferRecordingHls({ isIOS: true }), true);
  assert.equal(shouldPreferRecordingHls({ isFirefox: true }), true);
  assert.equal(shouldPreferRecordingHls({ isEdge: true }), true);
  assert.equal(shouldPreferRecordingHls({}), true);
});

test("buildRecordingPlaybackPlan caps recording chunk length and formats camera name", () => {
  assert.deepEqual(
    buildRecordingPlaybackPlan({
      clientId: "client-a",
      camera: "front_door",
      start: 100,
      end: 5000,
      preferHls: false,
    }),
    {
      chunkEnd: 3700,
      clipDurationSec: 3600,
      displayCamera: "front door",
      sourceCandidates: [
        "/api/frigate/client-a/recording/front_door/start/100/end/3700",
        "/api/frigate/client-a/vod/front_door/start/100/end/3700/index.m3u8",
        "/api/frigate/client-a/vod/front_door/start/100/end/3700/master.m3u8",
      ],
    },
  );
});

test("buildRecordingPlaybackPlan prefers HLS sources when requested", () => {
  assert.deepEqual(
    buildRecordingPlaybackPlan({
      clientId: "client-a",
      camera: "front door",
      start: 100,
      end: 200,
      preferHls: true,
    }).sourceCandidates,
    [
      "/api/frigate/client-a/vod/front%20door/start/100/end/200/index.m3u8",
      "/api/frigate/client-a/vod/front%20door/start/100/end/200/master.m3u8",
      "/api/frigate/client-a/recording/front%20door/start/100/end/200",
    ],
  );
});

test("recording playback alignment starts at the containing raw segment", () => {
  assert.deepEqual(
    resolveRecordingPlaybackAlignment({
      recordings: [
        { start_time: 90, end_time: 100 },
        { start_time: 95.25, end_time: 105.25 },
      ],
      start: 100,
      end: 104,
    }),
    {
      transportStart: 95.25,
      startPosition: 4.75,
      playbackDuration: 4,
    },
  );
});

test("recording playback alignment rejects unsafe or unnecessary offsets", () => {
  assert.equal(
    resolveRecordingPlaybackAlignment({
      recordings: [{ start_time: 100, end_time: 110 }],
      start: 100,
      end: 104,
    }),
    null,
  );
  assert.equal(
    resolveRecordingPlaybackAlignment({
      recordings: [{ start_time: 0, end_time: 700 }],
      start: 601,
      end: 604,
    }),
    null,
  );
  assert.equal(
    resolveRecordingPlaybackAlignment({
      recordings: [{ start_time: 95, end_time: 99 }],
      start: 100,
      end: 104,
    }),
    null,
  );
});
