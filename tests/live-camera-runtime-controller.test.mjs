import { test } from "node:test";
import assert from "node:assert/strict";

import { FrigateCameraRuntimeController } from "../src/features/live/camera-runtime.ctrl.js";

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
