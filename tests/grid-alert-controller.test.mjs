import { test } from "node:test";
import assert from "node:assert/strict";

import { GridAlertController } from "../src/features/grid/alert.ctrl.js";

function createHost({
  gridAvailable = true,
  viewMode = "grid",
  severityByMessage = "alert",
  shouldHandle = true,
  takeoverEnabled = false,
} = {}) {
  const host = {
    _viewMode: viewMode,
    _gridResumePending: false,
    _config: { alerts_reviews_days: 3 },
    _isGridModeAvailable: () => gridAvailable,
    _extractRealtimeMessageCamera: () => "front_door",
    _cameraEntityForIncomingCamera: () => "camera.front_door",
    _extractRealtimeMessageSeverity: () => severityByMessage,
    _shouldHandleSlideshowReview: () => shouldHandle,
    _isRealtimeEventMessage: () => true,
    _cameraIndexByEntity: () => 0,
    _scheduleGridRefresh: () => {},
    _effectiveRealtimePollSeconds: () => 5,
    _gridRotationMs: () => 30000,
    _alertCameraTakeoverEnabled: () => takeoverEnabled,
  };
  host._isGridSessionActive = () =>
    host._viewMode === "grid" || host._gridResumePending;
  return host;
}

test("handleRealtimeMessage forwards parsed severity to alert candidate", () => {
  const host = createHost({ severityByMessage: "alert", shouldHandle: true });
  const controller = new GridAlertController(host, {
    DAY: 86400,
    SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC: 10,
  });
  const calls = [];

  controller.handleAlertCandidate = (entity, severity) => {
    calls.push([entity, severity]);
  };

  controller.handleRealtimeMessage({ type: "new", camera: "front_door" });

  assert.deepEqual(calls, [["camera.front_door", "alert"]]);
});

test("handleRealtimeMessage only probes Reviews when severity is missing", () => {
  const host = createHost({ severityByMessage: "", shouldHandle: true });
  const controller = new GridAlertController(host, {
    DAY: 86400,
    SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC: 10,
  });
  const calls = [];

  controller.handleAlertCandidate = () => {
    calls.push(["candidate"]);
  };
  controller.scheduleAlertWatch = (delayMs) => {
    calls.push(["watch", delayMs]);
  };

  controller.handleRealtimeMessage({ type: "update", camera: "front_door" });

  assert.deepEqual(calls, [["watch", 180]]);
});

test("handleRealtimeMessage ignores detections excluded by camera config", () => {
  const host = createHost({
    severityByMessage: "detection",
    shouldHandle: false,
  });
  const controller = new GridAlertController(host, {
    DAY: 86400,
    SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC: 10,
  });
  const calls = [];
  controller.handleAlertCandidate = (...args) => calls.push(args);

  controller.handleRealtimeMessage({ type: "new", camera: "front_door" });

  assert.deepEqual(calls, []);
});

test("handleRealtimeMessage schedules probe when camera parsing fails", () => {
  const host = createHost({ severityByMessage: "alert", shouldHandle: true });
  host._extractRealtimeMessageCamera = () => "";
  const controller = new GridAlertController(host, {
    DAY: 86400,
    SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC: 10,
  });
  const calls = [];

  controller.scheduleAlertWatch = (delayMs) => {
    calls.push(["watch", delayMs]);
  };

  controller.handleRealtimeMessage({ type: "update" });

  assert.deepEqual(calls, [["watch", 180]]);
});

test("handleAlertCandidate immediately begins a Grid page alert hold", () => {
  const host = createHost({ severityByMessage: "alert", shouldHandle: true });
  const controller = new GridAlertController(host, {
    DAY: 86400,
    SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC: 10,
  });
  const calls = [];

  host._beginGridAlertPageHold = (entity) => calls.push(["hold", entity]);
  controller.markAlertCamera = () => true;

  controller.handleAlertCandidate("camera.front_door", "alert");

  assert.deepEqual(calls, [["hold", "camera.front_door"]]);
});

test("Grid owns enabled alert takeover and promotes the alerted camera", () => {
  const host = createHost({ takeoverEnabled: true });
  const controller = new GridAlertController(host, {
    DAY: 86400,
    SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC: 10,
  });
  const calls = [];

  host._focusGridPageForCamera = () => {
    calls.push(["focus"]);
    return true;
  };
  host._scheduleGridRefresh = () => calls.push(["refresh"]);
  host._beginGridAlertTakeover = (entity, severity) => {
    calls.push(["takeover", entity, severity]);
  };

  controller.handleAlertCandidate("camera.front_door", "detection");

  assert.deepEqual(calls, [
    ["takeover", "camera.front_door", "detection"],
  ]);
  assert.equal(controller.cellSeverity("camera.front_door"), "detection");
  controller.clearTimers();
});

test("an ongoing alert cannot relaunch takeover after Grid resumes", () => {
  const host = createHost({ takeoverEnabled: true });
  const controller = new GridAlertController(host, {
    DAY: 86400,
    SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC: 10,
  });
  const calls = [];
  host._beginGridAlertTakeover = (...args) => calls.push(args);

  controller.handleAlertCandidate("camera.front_door", "alert");
  controller._lastAlertAt = 0;
  controller.handleAlertCandidate("camera.front_door", "alert");

  assert.deepEqual(calls, [["camera.front_door", "alert"]]);
  controller.clearTimers();
});

test("Grid permits a later takeover only after the alert lifecycle clears", () => {
  const host = createHost({ takeoverEnabled: true });
  const controller = new GridAlertController(host, {
    DAY: 86400,
    SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC: 10,
  });
  const calls = [];
  host._beginGridAlertTakeover = (...args) => calls.push(args);

  controller.handleAlertCandidate("camera.front_door", "alert");
  controller.syncHaAlertState({
    reportedEntities: new Set(["camera.front_door"]),
    activeEntities: new Set(["camera.front_door"]),
  });
  controller.handleRealtimeMessage({ type: "end" });
  controller._lastAlertAt = 0;
  controller.handleAlertCandidate("camera.front_door", "alert");
  assert.equal(calls.length, 1);

  controller.syncHaAlertState({
    reportedEntities: new Set(["camera.front_door"]),
    activeEntities: new Set(),
  });
  controller._lastAlertAt = 0;
  controller.handleAlertCandidate("camera.front_door", "alert");

  assert.equal(calls.length, 2);
  controller.clearTimers();
});

test("Grid continues owning alerts during a temporary single-camera takeover", () => {
  const host = createHost({ takeoverEnabled: true, viewMode: "single" });
  host._gridResumePending = true;
  const controller = new GridAlertController(host, {
    DAY: 86400,
    SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC: 10,
  });
  const calls = [];
  host._beginGridAlertTakeover = (...args) => calls.push(args);

  controller.handleAlertCandidate("camera.front_door", "alert");

  assert.deepEqual(calls, [["camera.front_door", "alert"]]);
  controller.clearTimers();
});
