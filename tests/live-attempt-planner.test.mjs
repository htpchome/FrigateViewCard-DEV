import { test } from "node:test";
import assert from "node:assert/strict";

import { buildLiveAttemptPlan } from "../src/features/live/attempt-planner.js";

test("buildLiveAttemptPlan excludes HLS from automatic live startup", () => {
  const attempts = buildLiveAttemptPlan({
    connectionType: "frigate_go2rtc",
    builders: {
      webrtc: () => ({ ok: true }),
      mse: () => ({ ok: true }),
      hls: () => ({ ok: true }),
    },
  });

  assert.deepEqual(
    attempts.map((attempt) => attempt.type),
    ["webrtc", "mse"],
  );
});

test("buildLiveAttemptPlan keeps HLS available when explicitly forced", () => {
  const attempts = buildLiveAttemptPlan({
    connectionType: "frigate_go2rtc",
    forcedType: "hls",
    builders: {
      webrtc: () => ({ ok: true }),
      mse: () => ({ ok: true }),
      hls: () => ({ ok: true }),
    },
  });

  assert.deepEqual(
    attempts.map((attempt) => attempt.type),
    ["hls"],
  );
});

test("buildLiveAttemptPlan returns no attempts for ha_direct", () => {
  const attempts = buildLiveAttemptPlan({
    connectionType: "ha_direct",
    builders: {
      webrtc: () => ({ ok: true }),
      mse: () => ({ ok: true }),
      hls: () => ({ ok: true }),
    },
  });

  assert.deepEqual(attempts, []);
});
