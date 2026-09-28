import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isFrigateCameraEntityState,
  resolveFrigateCameraRuntimeState,
  setFrigateCameraRuntimeSuspended,
} from "../src/integrations/home-assistant/frigate-camera-runtime.js";

const frigateState = (state, supportedFeatures) => ({
  state,
  attributes: {
    client_id: "frigate-main",
    camera_name: "front",
    supported_features: supportedFeatures,
  },
});

test("Frigate runtime state recognizes only the integration suspension signature", () => {
  const suspended = resolveFrigateCameraRuntimeState({
    entity: "camera.front",
    state: frigateState("idle", 0),
  });
  assert.deepEqual(suspended, {
    entity: "camera.front",
    rawState: "idle",
    supportedFeatures: 0,
    frigate: true,
    controllable: true,
    suspended: true,
    unavailable: false,
  });

  assert.equal(
    resolveFrigateCameraRuntimeState({
      entity: "camera.front",
      state: frigateState("recording", 1),
    }).suspended,
    false,
  );
  assert.equal(
    resolveFrigateCameraRuntimeState({
      entity: "camera.front",
      state: {
        state: "idle",
        attributes: { supported_features: 0 },
      },
    }).suspended,
    false,
  );
  assert.equal(
    resolveFrigateCameraRuntimeState({
      entity: "camera.front",
      state: frigateState("unavailable", 0),
    }).controllable,
    false,
  );
});

test("Frigate camera identity requires integration and camera attributes", () => {
  assert.equal(isFrigateCameraEntityState(frigateState("idle", 0)), true);
  assert.equal(
    isFrigateCameraEntityState({
      state: "idle",
      attributes: { client_id: "frigate-main" },
    }),
    false,
  );
});

test("Frigate runtime mutation uses Home Assistant camera services", async () => {
  const calls = [];
  const hass = {
    callService: async (...args) => calls.push(args),
  };

  await setFrigateCameraRuntimeSuspended({
    hass,
    entity: "camera.front",
    suspended: true,
  });
  await setFrigateCameraRuntimeSuspended({
    hass,
    entity: "camera.front",
    suspended: false,
  });

  assert.deepEqual(calls, [
    ["camera", "turn_off", {}, { entity_id: "camera.front" }],
    ["camera", "turn_on", {}, { entity_id: "camera.front" }],
  ]);
});
