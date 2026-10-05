import { test } from "node:test";
import assert from "node:assert/strict";

import { FrigateCameraRuntimeController } from "../src/features/live/camera-runtime.ctrl.js";
import { applyActiveStreamTypeForCard } from "../src/features/live/stream.state.js";

const cameraState = (state, supportedFeatures) => ({
  state,
  attributes: {
    client_id: "frigate-main",
    camera_name: "front",
    supported_features: supportedFeatures,
  },
});

const createHost = () => {
  const calls = [];
  const host = {
    _config: { camera_suspend_access: "admin_only" },
    _activeCam: { entity: "camera.front" },
    _activeGroupMemberOverride: "",
    _activeStreamType: "webrtc",
    _started: true,
    _hass: {
      user: { is_admin: true },
      states: {
        "camera.front": cameraState("recording", 1),
      },
      callService: async (...args) => calls.push(["service", ...args]),
    },
    _$: () => null,
    _stopTwoWayTalkSession: (options) => {
      calls.push(["talk", options]);
    },
    _cancelPendingMount: (reason) => calls.push(["cancel", reason]),
    _clearLiveEngineSlot: () => calls.push(["clear-slot"]),
    _liveGraceController: {
      evictEntity: (entity) => calls.push(["evict", entity]),
    },
    _setStreamLoading: (loading) => calls.push(["loading", loading]),
    _stopStreamFallbackLoadingRefresh: () => calls.push(["stop-fallback"]),
    _setStreamFallbackVisible: (visible) =>
      calls.push(["fallback", visible]),
    _setActiveStreamType: (type) => {
      host._activeStreamType = type;
      calls.push(["stream", type]);
    },
    _scheduleResumeLive: (reason) => calls.push(["resume", reason]),
    _toast: (message, options) => calls.push(["toast", message, options]),
  };
  return { calls, host };
};

test("camera suspension access defaults to administrators", async () => {
  const { calls, host } = createHost();
  host._hass.user = { is_admin: false };
  delete host._config.camera_suspend_access;
  const controller = new FrigateCameraRuntimeController(host);

  assert.match(controller.buildControlMarkup(), / hidden>/);
  assert.equal(controller.openConfirmation(), false);
  assert.equal(await controller.toggle(), false);
  assert.equal(calls.some(([type]) => type === "service"), false);
});

test("camera suspension access can allow every Home Assistant user", async () => {
  const { calls, host } = createHost();
  host._hass.user = { is_admin: false };
  host._config.camera_suspend_access = "everyone";
  const controller = new FrigateCameraRuntimeController(host, {
    confirmationTimeoutMs: 100,
  });

  assert.doesNotMatch(controller.buildControlMarkup(), / hidden>/);
  assert.equal(await controller.toggle(), true);
  assert.deepEqual(calls.find(([type]) => type === "service"), [
    "service",
    "camera",
    "turn_off",
    {},
    { entity_id: "camera.front" },
  ]);
  controller.dispose();
});

test("disabled camera suspension access hides and rejects controls for administrators", async () => {
  const { calls, host } = createHost();
  host._config.camera_suspend_access = "disabled";
  const controller = new FrigateCameraRuntimeController(host);

  assert.match(controller.buildControlMarkup(), / hidden>/);
  assert.equal(controller.openConfirmation(), false);
  assert.equal(await controller.toggle(), false);
  assert.equal(calls.some(([type]) => type === "service"), false);
});

test("grid mode hides and rejects the camera suspension control", async () => {
  const { calls, host } = createHost();
  host._viewMode = "grid";
  const controller = new FrigateCameraRuntimeController(host);

  assert.match(controller.buildControlMarkup(), / hidden>/);
  assert.equal(controller.openConfirmation(), false);
  assert.equal(await controller.toggle(), false);
  assert.equal(calls.some(([type]) => type === "service"), false);
});

test("suspended Frigate state tears down active live without touching browse data", () => {
  const { calls, host } = createHost();
  const controller = new FrigateCameraRuntimeController(host);
  controller.reconcileHass();
  calls.length = 0;

  host._hass.states["camera.front"] = cameraState("idle", 0);
  controller.reconcileHass();

  assert.deepEqual(calls.slice(0, 4), [
    ["talk", { restoreLive: false }],
    ["cancel", "camera-suspended"],
    ["clear-slot"],
    ["evict", "camera.front"],
  ]);
  assert.equal(host._activeStreamType, "suspended");
  assert.equal("_events" in host, false);
});

test("resumed Frigate state schedules live recovery", () => {
  const { calls, host } = createHost();
  host._hass.states["camera.front"] = cameraState("idle", 0);
  const controller = new FrigateCameraRuntimeController(host);
  controller.reconcileHass();
  calls.length = 0;

  host._hass.states["camera.front"] = cameraState("recording", 1);
  controller.reconcileHass();

  assert.equal(
    calls.some(
      ([type, reason]) => type === "resume" && reason === "camera-resumed",
    ),
    true,
  );
});

test("camera power control waits for Home Assistant state confirmation", async () => {
  const { calls, host } = createHost();
  const controller = new FrigateCameraRuntimeController(host, {
    confirmationTimeoutMs: 100,
  });
  controller.reconcileHass();

  assert.equal(await controller.toggle(), true);
  assert.deepEqual(calls.find(([type]) => type === "service"), [
    "service",
    "camera",
    "turn_off",
    {},
    { entity_id: "camera.front" },
  ]);

  host._hass.states["camera.front"] = cameraState("idle", 0);
  controller.reconcileHass();
  assert.equal(
    calls.some(
      ([type, message]) => type === "toast" && message === "Camera suspended",
    ),
    true,
  );
  controller.dispose();
});

test("a confirmed resume stays online through an ambiguous idle update", async () => {
  const { calls, host } = createHost();
  host._hass.states["camera.front"] = cameraState("idle", 0);
  const controller = new FrigateCameraRuntimeController(host, {
    confirmationTimeoutMs: 100,
  });
  controller.reconcileHass();

  assert.equal(await controller.toggle(), true);
  host._hass.states["camera.front"] = cameraState("recording", 1);
  controller.reconcileHass();
  assert.equal(controller.isAvailable("camera.front"), true);

  calls.length = 0;
  host._hass.states["camera.front"] = cameraState("idle", 0);
  const runtime = controller.reconcileHass();

  assert.equal(runtime.suspended, false);
  assert.equal(controller.isSuspended("camera.front"), false);
  assert.equal(controller.isAvailable("camera.front"), true);
  assert.equal(
    calls.some(
      ([type, reason]) =>
        type === "cancel" && reason === "camera-suspended",
    ),
    false,
  );
  controller.dispose();
});

test("committed live playback overrides stale states from the same Frigate client", () => {
  const { host } = createHost();
  host._hass.states["camera.front"] = cameraState("unavailable", 1);
  host._hass.states["camera.back"] = cameraState("unavailable", 1);
  host._hass.states["camera.remote"] = {
    ...cameraState("unavailable", 1),
    attributes: {
      ...cameraState("unavailable", 1).attributes,
      client_id: "frigate-remote",
    },
  };
  const controller = new FrigateCameraRuntimeController(host);

  assert.equal(controller.isAvailable("camera.front"), false);

  host._engine = { video: {} };
  assert.equal(controller.isAvailable("camera.front"), false);
  host._committedLiveAvailabilityEntity = "camera.front";
  host._committedLiveAvailabilityEngine = host._engine;
  assert.equal(controller.isAvailable("camera.front"), true);
  assert.equal(controller.isAvailable("camera.back"), true);
  assert.equal(controller.isAvailable("camera.remote"), false);

  host._hass.states["camera.front"] = cameraState("recording", 1);
  assert.equal(controller.isAvailable("camera.back"), false);

  host._hass.states["camera.front"] = cameraState("unavailable", 1);
  host._activeStreamType = "snapshot";
  assert.equal(controller.isAvailable("camera.front"), false);

  host._activeStreamType = "hls";
  host._hass.states["camera.front"] = cameraState("idle", 0);
  assert.equal(controller.isAvailable("camera.front"), false);
});

for (const type of ["webrtc", "hls"]) {
  test(`${type} outage revokes selected camera live status without releasing its connection`, () => {
    const { host, calls } = createHost();
    host._hass.states["camera.back"] = cameraState("recording", 1);
    const controller = new FrigateCameraRuntimeController(host);
    const engine = {
      haDirectProvider: true,
      haDirectProviderReady: true,
      haDirectReadyState: host._hass.states["camera.front"],
    };
    host._engine = engine;
    controller.reconcileHass();
    applyActiveStreamTypeForCard({ card: host, type });
    assert.equal(controller.isAvailable(), true);

    // HA reports the outage before buffered HLS stops or native ICE fails.
    host._hass.states["camera.front"] = cameraState("unavailable", 1);
    host._hass.states["camera.back"] = cameraState("unavailable", 1);
    controller.reconcileHass();
    assert.equal(controller.isAvailable(), false);
    assert.equal(controller.isAvailable("camera.back"), false);
    assert.equal(host._activeStreamType, "--");
    assert.equal(host._committedLiveAvailabilityEngine, null);
    assert.equal(host._engine, engine);
    assert.deepEqual(calls.filter(([action]) =>
      ["cancel", "clear-slot", "evict", "resume"].includes(action)), []);

    // A view/editor handoff can re-publish the retained record's old readiness.
    applyActiveStreamTypeForCard({ card: host, type });
    assert.equal(host._activeStreamType, "--");
    assert.equal(controller.isAvailable(), false);

    // Actual recovered media can still beat HA's delayed state publication.
    engine.haDirectReadyState = host._hass.states["camera.front"];
    applyActiveStreamTypeForCard({ card: host, type });
    controller.reconcileHass();
    assert.equal(controller.isAvailable(), true);
    assert.equal(controller.isAvailable("camera.back"), true);
    assert.equal(host._activeStreamType, type);

    host._hass.states["camera.front"] = cameraState("recording", 1);
    controller.reconcileHass();
    host._hass.states["camera.front"] = cameraState("unavailable", 1);
    controller.reconcileHass();
    assert.equal(controller.isAvailable(), false);
    assert.equal(host._activeStreamType, "--");
    controller.dispose();
  });
}

test("a retained HA provider that is no longer ready is not live availability evidence", () => {
  const { host } = createHost();
  host._hass.states["camera.front"] = cameraState("unavailable", 1);
  host._engine = {
    haDirectProvider: true,
    haDirectProviderReady: true,
    haDirectReadyState: host._hass.states["camera.front"],
  };
  const controller = new FrigateCameraRuntimeController(host);
  applyActiveStreamTypeForCard({ card: host, type: "hls" });
  assert.equal(controller.isAvailable(), true);
  host._engine.haDirectProviderReady = false;
  assert.equal(controller.isAvailable(), false);
  controller.dispose();
});
