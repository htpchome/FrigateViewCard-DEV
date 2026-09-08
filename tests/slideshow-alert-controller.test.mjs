import { test } from "node:test";
import assert from "node:assert/strict";

import { SlideshowAlertController } from "../src/features/slideshow/alert.ctrl.js";

test("handleReviewsUpdated uses SLIDESHOW_ALERT_HOLD_MS for pause window", () => {
  const now = Date.now();
  const host = {
    _slideshowActive: true,
    _isSlideshowRotationAvailable: () => true,
    _slideshowHandledReviewIds: new Set(),
    _slideshowPopupPaused: false,
    _activeCam: { entity: "camera.front_door" },
    _slideshowLastAlertAt: 0,
    _slideshowLastAlertCam: "",
    _slideshowPausedUntil: 0,
    _normalizeReviewSeverity: (review) => review?.severity || "alert",
    _shouldHandleSlideshowReview: () => true,
    _reviewStartTimeSec: (review) => Number(review?.start_time || 0),
    _slideshowStartedAtSec: 0,
    _cameraIndexByEntity: () => 0,
    _setSlideshowAlertState: () => {},
    _scheduleSlideshowRotation: () => {},
    _switchCamera: async () => {},
  };

  const controller = new SlideshowAlertController(host, {
    DAY: 86400,
    SLIDESHOW_ALERT_HOLD_MS: 10000,
    SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC: 10,
    SLIDESHOW_REVIEW_WATCH_MIN_MS: 1500,
    SLIDESHOW_REVIEW_WATCH_MAX_MS: 15000,
  });

  controller.handleReviewsUpdated(
    "camera.front_door",
    [{ id: "r1", start_time: Math.floor(now / 1000), severity: "alert" }],
    "test",
  );

  const holdMs = host._slideshowPausedUntil - now;
  assert.equal(holdMs >= 9000 && holdMs <= 11000, true);
});

test("handleHaStatusCandidate switches slideshow camera and applies hold window", () => {
  const now = Date.now();
  const calls = [];
  const host = {
    _slideshowActive: true,
    _isSlideshowRotationAvailable: () => true,
    _slideshowHandledReviewIds: new Set(),
    _slideshowPopupPaused: false,
    _activeCam: { entity: "camera.front_door" },
    _slideshowLastAlertAt: 0,
    _slideshowLastAlertCam: "",
    _slideshowPausedUntil: 0,
    _shouldHandleSlideshowReview: () => true,
    _cameraIndexByEntity: (entity) =>
      entity === "camera.driveway"
        ? 1
        : entity === "camera.front_door"
          ? 0
          : -1,
    _setSlideshowAlertState: (severity) => {
      calls.push(["state", severity]);
    },
    _scheduleSlideshowRotation: (reason) => {
      calls.push(["schedule", reason]);
    },
    _switchCamera: async (idx, options) => {
      calls.push(["switch", idx, options?.source || ""]);
    },
  };

  const controller = new SlideshowAlertController(host, {
    DAY: 86400,
    SLIDESHOW_ALERT_HOLD_MS: 10000,
    SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC: 10,
    SLIDESHOW_REVIEW_WATCH_MIN_MS: 1500,
    SLIDESHOW_REVIEW_WATCH_MAX_MS: 15000,
  });

  controller.handleHaStatusCandidate("camera.driveway", "alert");

  assert.equal(host._slideshowLastAlertCam, "camera.driveway");
  assert.equal(host._slideshowLastAlertAt >= now, true);
  const holdMs = host._slideshowPausedUntil - now;
  assert.equal(holdMs >= 9000 && holdMs <= 11000, true);
  assert.deepEqual(calls, [
    ["state", "alert"],
    ["switch", 1, "alert"],
    ["schedule", "ha-alert-switch"],
  ]);
});

test("slideshow alert takeover targets the alerted member of a camera group", () => {
  const calls = [];
  const groupedCamera = {
    entity: "camera.doorbell",
    group: { secondary_entity: "camera.package", layout: "stacked" },
  };
  const host = {
    _slideshowActive: true,
    _isSlideshowRotationAvailable: () => true,
    _slideshowHandledReviewIds: new Set(),
    _slideshowPopupPaused: false,
    _activeCam: groupedCamera,
    _activeGroupMemberOverride: "camera.doorbell",
    _config: { cameras: [groupedCamera] },
    _shouldHandleSlideshowReview: () => true,
    _cameraIndexByEntity: () => 0,
    _setSlideshowAlertState: () => {},
    _scheduleSlideshowRotation: () => {},
    _switchCamera: async (idx, options) => calls.push([idx, options]),
  };
  const controller = new SlideshowAlertController(host, {
    DAY: 86400,
    SLIDESHOW_ALERT_HOLD_MS: 10000,
    SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC: 10,
    SLIDESHOW_REVIEW_WATCH_MIN_MS: 1500,
    SLIDESHOW_REVIEW_WATCH_MAX_MS: 15000,
  });

  controller.handleHaStatusCandidate("camera.package", "alert");

  assert.deepEqual(calls, [
    [
      0,
      { source: "alert", groupMemberEntity: "camera.package" },
    ],
  ]);
});

test("disabled slideshow takeover does not switch cameras or reset rotation", () => {
  const calls = [];
  const host = {
    _slideshowActive: true,
    _isSlideshowRotationAvailable: () => true,
    _alertCameraTakeoverEnabled: () => false,
    _slideshowPopupPaused: false,
    _activeCam: { entity: "camera.front_door" },
    _shouldHandleSlideshowReview: () => true,
    _cameraIndexByEntity: () => 1,
    _setSlideshowAlertState: (severity) =>
      calls.push(["state", severity]),
    _scheduleSlideshowRotation: (reason) =>
      calls.push(["schedule", reason]),
    _switchCamera: (...args) => calls.push(["switch", ...args]),
  };
  const controller = new SlideshowAlertController(host, {
    SLIDESHOW_ALERT_HOLD_MS: 10000,
  });

  controller.handleHaStatusCandidate("camera.driveway", "alert");
  controller.handleHaStatusCandidate("camera.front_door", "detection");

  assert.deepEqual(calls, [["state", "detection"]]);
});

test("one alert cycle cannot restart its Slideshow Alert Hold Duration", () => {
  const originalNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  const calls = [];
  const host = {
    _slideshowActive: true,
    _isSlideshowRotationAvailable: () => true,
    _alertCameraTakeoverEnabled: () => true,
    _slideshowHandledReviewIds: new Set(),
    _slideshowPopupPaused: false,
    _activeCam: { entity: "camera.front_door" },
    _config: {
      cameras: [
        { entity: "camera.front_door" },
        { entity: "camera.driveway" },
      ],
    },
    _slideshowLastAlertAt: 0,
    _slideshowLastAlertCam: "",
    _slideshowPausedUntil: 0,
    _slideshowStartedAtSec: 0,
    _normalizeReviewSeverity: (review) => review?.severity || "alert",
    _shouldHandleSlideshowReview: () => true,
    _reviewStartTimeSec: (review) => Number(review?.start_time || 0),
    _cameraIndexByEntity: (entity) =>
      entity === "camera.driveway" ? 1 : 0,
    _setSlideshowAlertState: (severity) =>
      calls.push(["state", severity]),
    _scheduleSlideshowRotation: (reason) =>
      calls.push(["schedule", reason]),
    _switchCamera: async (index) => calls.push(["switch", index]),
  };
  const controller = new SlideshowAlertController(host, {
    SLIDESHOW_ALERT_HOLD_MS: 10000,
    SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC: 10,
  });

  try {
    controller.handleHaStatusCandidate("camera.driveway", "alert");
    assert.equal(host._slideshowPausedUntil, 11000);
    host._activeCam = { entity: "camera.driveway" };

    now = 2000;
    controller.handleReviewsUpdated("camera.driveway", [
      { id: "same-alert", start_time: 2, severity: "alert" },
    ]);
    controller.handleHaStatusCandidate("camera.driveway", "alert");

    assert.equal(host._slideshowPausedUntil, 11000);
    assert.deepEqual(calls, [
      ["state", "alert"],
      ["switch", 1],
      ["schedule", "ha-alert-switch"],
    ]);
  } finally {
    Date.now = originalNow;
  }
});

test("a newly alerted camera preempts an older active HA alert", () => {
  const calls = [];
  const host = {
    _slideshowActive: true,
    _isSlideshowRotationAvailable: () => true,
    _alertCameraTakeoverEnabled: () => true,
    _slideshowPopupPaused: false,
    _activeCam: { entity: "camera.front_door" },
    _config: {
      cameras: [
        { entity: "camera.front_door" },
        { entity: "camera.driveway" },
      ],
    },
    _shouldHandleSlideshowReview: () => true,
    _cameraIndexByEntity: (entity) =>
      entity === "camera.driveway" ? 1 : 0,
    _setSlideshowAlertState: () => {},
    _scheduleSlideshowRotation: (reason) =>
      calls.push(["schedule", reason]),
    _switchCamera: async (index) => calls.push(["switch", index]),
  };
  const controller = new SlideshowAlertController(host, {
    SLIDESHOW_ALERT_HOLD_MS: 10000,
  });
  const reportedEntities = new Set([
    "camera.front_door",
    "camera.driveway",
  ]);

  controller.syncHaAlertState({
    reportedEntities,
    candidates: [{ entity: "camera.front_door", severity: "alert" }],
  });
  controller.syncHaAlertState({
    reportedEntities,
    candidates: [
      { entity: "camera.front_door", severity: "alert" },
      { entity: "camera.driveway", severity: "detection" },
    ],
  });

  assert.deepEqual(calls, [
    ["schedule", "ha-active-alert"],
    ["switch", 1],
    ["schedule", "ha-alert-switch"],
  ]);
});

test("existing simultaneous HA alerts do not rotate through takeover holds", () => {
  const calls = [];
  const host = {
    _slideshowActive: true,
    _isSlideshowRotationAvailable: () => true,
    _alertCameraTakeoverEnabled: () => true,
    _slideshowPopupPaused: false,
    _activeCam: { entity: "camera.front_door" },
    _config: {
      cameras: [
        { entity: "camera.front_door" },
        { entity: "camera.driveway" },
      ],
    },
    _shouldHandleSlideshowReview: () => true,
    _cameraIndexByEntity: (entity) =>
      entity === "camera.driveway" ? 1 : 0,
    _setSlideshowAlertState: () => {},
    _scheduleSlideshowRotation: (reason) =>
      calls.push(["schedule", reason]),
    _switchCamera: async (index) => calls.push(["switch", index]),
  };
  const controller = new SlideshowAlertController(host, {
    SLIDESHOW_ALERT_HOLD_MS: 10000,
  });
  const state = {
    reportedEntities: new Set([
      "camera.front_door",
      "camera.driveway",
    ]),
    candidates: [
      { entity: "camera.front_door", severity: "alert" },
      { entity: "camera.driveway", severity: "alert" },
    ],
  };

  controller.syncHaAlertState(state);
  controller.syncHaAlertState(state);

  assert.deepEqual(calls, [["schedule", "ha-active-alert"]]);
});

test("HA alert synchronization is presentation-inert outside slideshow", () => {
  const calls = [];
  const host = {
    _slideshowActive: false,
    _isSlideshowRotationAvailable: () => true,
    _alertCameraTakeoverEnabled: () => false,
    _activeCam: { entity: "camera.front_door" },
    _setSlideshowAlertState: (severity) =>
      calls.push(["state", severity]),
  };
  const controller = new SlideshowAlertController(host, {
    SLIDESHOW_ALERT_HOLD_MS: 10000,
  });

  controller.syncHaAlertState({
    reportedEntities: new Set(["camera.front_door"]),
    candidates: [{ entity: "camera.front_door", severity: "alert" }],
  });

  assert.deepEqual(calls, []);
});
