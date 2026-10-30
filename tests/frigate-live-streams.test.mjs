import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchFrigateLiveStreamOptions,
  normalizeFrigateGo2RtcStream,
  resolveConfiguredFrigateGo2RtcStream,
  resolveFrigateLiveStreamOptions,
} from "../src/integrations/frigate/live-streams.js";

test("Frigate live stream discovery excludes main and preserves configured labels", () => {
  const options = resolveFrigateLiveStreamOptions({
    cameras: {
      driveway: {
        live: {
          streams: {
            "Main Stream": "driveway",
            "Low Resolution": "driveway_sub",
            "Mobile Portrait": "driveway_vertical",
            "Duplicate Sub": "driveway_sub",
          },
        },
      },
    },
  }, "driveway");

  assert.deepEqual(options, [
    { label: "Low Resolution", value: "driveway_sub" },
    { label: "Mobile Portrait", value: "driveway_vertical" },
  ]);
});

test("Frigate live stream discovery treats the first configured stream as main when unnamed", () => {
  assert.deepEqual(resolveFrigateLiveStreamOptions({
    config: {
      cameras: {
        deck: {
          live: {
            streams: {
              Primary: "deck_high",
              Secondary: "deck_low",
            },
          },
        },
      },
    },
  }, "deck"), [
    { label: "Secondary", value: "deck_low" },
  ]);
});

test("configured go2rtc stream applies only to the primary camera entity", () => {
  const config = {
    cameras: [{
      entity: "camera.doorbell",
      frigate_go2rtc_stream: "doorbell_sub",
      group: { secondary_entity: "camera.package" },
    }],
  };

  assert.equal(resolveConfiguredFrigateGo2RtcStream({
    config,
    entity: "camera.doorbell",
  }), "doorbell_sub");
  assert.equal(resolveConfiguredFrigateGo2RtcStream({
    config,
    entity: "camera.package",
  }), "");
});

test("Frigate stream normalization rejects control characters", () => {
  assert.equal(normalizeFrigateGo2RtcStream(" porch_sub "), "porch_sub");
  assert.equal(normalizeFrigateGo2RtcStream("porch\nsub"), "");
});

test("Frigate live stream discovery uses the authenticated HA proxy", async () => {
  const calls = [];
  const options = await fetchFrigateLiveStreamOptions({
    hass: {
      callWS: async (message) => {
        calls.push(message);
        return { path: `${message.path}?authSig=test` };
      },
    },
    instanceId: "frigate-main",
    cameraName: "garage",
    origin: "https://ha.local",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({
          cameras: {
            garage: {
              live: {
                streams: {
                  "Main Stream": "garage",
                  "Sub Stream": "garage_sub",
                },
              },
            },
          },
        }),
      };
    },
  });

  assert.deepEqual(options, [
    { label: "Sub Stream", value: "garage_sub" },
  ]);
  assert.deepEqual(calls[0], {
    type: "auth/sign_path",
    path: "/api/frigate/frigate-main/config",
    expires: 3600,
  });
  assert.equal(
    calls[1].url,
    "https://ha.local/api/frigate/frigate-main/config?authSig=test",
  );
  assert.equal(calls[1].init.credentials, "same-origin");
});
