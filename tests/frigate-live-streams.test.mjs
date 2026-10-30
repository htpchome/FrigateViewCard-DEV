import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchFrigateLiveStreamOptions,
  normalizeFrigateGo2RtcStream,
  resolveConfiguredFrigateGo2RtcStream,
  resolveFrigateLiveStreamOptions,
} from "../src/integrations/frigate/live-streams.js";

test("Frigate live stream discovery excludes main and lists matching names first", () => {
  const options = resolveFrigateLiveStreamOptions({
    driveway: {},
    garage: {},
    driveway_sub: {},
    "driveway-low": {},
    alternate: {},
  }, "driveway");

  assert.deepEqual(options, [
    { label: "driveway-low", value: "driveway-low" },
    { label: "driveway_sub", value: "driveway_sub" },
    { label: "alternate", value: "alternate" },
    { label: "garage", value: "garage" },
  ]);
});

test("Frigate live stream discovery rejects malformed response bodies", () => {
  assert.deepEqual(resolveFrigateLiveStreamOptions([], "deck"), []);
  assert.deepEqual(resolveFrigateLiveStreamOptions(null, "deck"), []);
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
          garage: {},
          garage_sub: {},
        }),
      };
    },
  });

  assert.deepEqual(options, [
    { label: "garage_sub", value: "garage_sub" },
  ]);
  assert.deepEqual(calls[0], {
    type: "auth/sign_path",
    path: "/api/frigate/frigate-main/go2rtc/api/streams",
    expires: 3600,
  });
  assert.equal(
    calls[1].url,
    "https://ha.local/api/frigate/frigate-main/go2rtc/api/streams?authSig=test",
  );
  assert.equal(calls[1].init.credentials, "same-origin");
});
