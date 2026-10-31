import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchFrigateLiveStreamOptions,
  normalizeFrigateGo2RtcStream,
  resolveConfiguredFrigateGo2RtcStream,
  resolveFrigateLiveStreamOptions,
} from "../src/integrations/frigate/live-streams.js";

test("Frigate live stream discovery lists only the selected camera's suffixed streams", () => {
  const options = resolveFrigateLiveStreamOptions({
    driveway: {},
    garage: {},
    driveway_sub: {},
    driveway_audio: {},
    driveway_sky: {},
    drivewaycustom: {},
    driveway2_sub: {},
    alternate: {},
  }, "driveway");

  assert.deepEqual(options, [
    { label: "driveway_sky", value: "driveway_sky" },
    { label: "driveway_sub", value: "driveway_sub" },
  ]);
});

test("Frigate live stream discovery does not confuse cameras with common name prefixes", () => {
  assert.deepEqual(resolveFrigateLiveStreamOptions({
    hall: {},
    hall_sub: {},
    hall_audio: {},
    hallway_sub: {},
    backyard: {},
  }, "hall"), [
    { label: "hall_sub", value: "hall_sub" },
  ]);
});

test("Frigate live stream discovery excludes the camera's audio-only stream", () => {
  assert.deepEqual(resolveFrigateLiveStreamOptions({
    porch_audio: {},
    porch_alt: {},
    porch_audio_backup: {},
  }, "porch"), [
    { label: "porch_alt", value: "porch_alt" },
    { label: "porch_audio_backup", value: "porch_audio_backup" },
  ]);
});

test("Frigate live stream discovery rejects malformed response bodies", () => {
  assert.deepEqual(resolveFrigateLiveStreamOptions([], "deck"), []);
  assert.deepEqual(resolveFrigateLiveStreamOptions(null, "deck"), []);
  assert.deepEqual(resolveFrigateLiveStreamOptions({ _sub: {} }, ""), []);
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
