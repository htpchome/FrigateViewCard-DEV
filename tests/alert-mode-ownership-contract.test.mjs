import { test } from "node:test";
import assert from "node:assert/strict";

import { GridAlertController } from "../src/features/grid/alert.ctrl.js";
import { LiveAlertTakeoverController } from "../src/features/live/alert-takeover.ctrl.js";
import { SlideshowAlertController } from "../src/features/slideshow/alert.ctrl.js";

const PAGES_WITH_SHARED_MODES = ["single-view", "wide-view", "card-view"];

const createModeHarness = ({
  pageId,
  owner,
  takeoverEnabled = true,
} = {}) => {
  const calls = [];
  const host = {
    _pageId: pageId,
    _viewMode: owner === "grid" ? "grid" : "single",
    _gridResumePending: false,
    _slideshowActive: owner === "slideshow",
    _slideshowPopupPaused: false,
    _slideshowLastAlertAt: 0,
    _slideshowLastAlertCam: "",
    _slideshowPausedUntil: 0,
    _slideshowPendingAlertCam: "",
    _slideshowPendingAlertType: "",
    _activeCam: { entity: "camera.front" },
    _activeGroupMemberOverride: "",
    _config: {
      cameras: [
        { entity: "camera.front" },
        { entity: "camera.driveway" },
      ],
    },
    _isGridModeAvailable: () => true,
    _isGridSessionActive: () => host._viewMode === "grid",
    _isSlideshowRotationAvailable: () => true,
    _alertCameraTakeoverEnabled: () => takeoverEnabled,
    _cameraIndexByEntity: (entity) =>
      entity === "camera.driveway" ? 1 : entity === "camera.front" ? 0 : -1,
    _gridAlertHoldMs: () => 30000,
    _gridRotationMs: () => 10000,
    _shouldHandleSlideshowReview: () => true,
    _beginGridAlertPageHold: (entity) =>
      calls.push(["grid-page-hold", entity]),
    _beginGridAlertTakeover: (entity, severity) =>
      calls.push(["grid-takeover", entity, severity]),
    _setSlideshowAlertState: (severity) =>
      calls.push(["slideshow-outline", severity]),
    _scheduleSlideshowRotation: (reason) =>
      calls.push(["slideshow-schedule", reason]),
    _setLiveAlertState: (severity) =>
      calls.push(["live-outline", severity]),
    _switchCamera: (index, options) =>
      calls.push(["switch", index, options]),
  };
  const grid = new GridAlertController(host, {
    DAY: 86400,
    SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC: 10,
  });
  const slideshow = new SlideshowAlertController(host, {
    SLIDESHOW_ALERT_HOLD_MS: 15000,
  });
  const live = new LiveAlertTakeoverController(host);

  const presentAlertThroughEveryOwner = () => {
    grid.handleAlertCandidate("camera.driveway", "detection");
    slideshow.handleHaStatusCandidate("camera.driveway", "detection");
    live.syncHaAlertState({
      reportedEntities: new Set(["camera.driveway"]),
      candidates: [
        {
          entity: "camera.driveway",
          severity: "detection",
          changedAt: 100,
        },
      ],
    });
  };

  return { calls, grid, host, presentAlertThroughEveryOwner };
};

test("Grid exclusively owns alert presentation on every shared-mode page", () => {
  for (const pageId of PAGES_WITH_SHARED_MODES) {
    const withoutTakeover = createModeHarness({
      pageId,
      owner: "grid",
      takeoverEnabled: false,
    });
    const withTakeover = createModeHarness({
      pageId,
      owner: "grid",
      takeoverEnabled: true,
    });
    try {
      withoutTakeover.presentAlertThroughEveryOwner();
      withTakeover.presentAlertThroughEveryOwner();

      assert.deepEqual(withoutTakeover.calls, [
        ["grid-page-hold", "camera.driveway"],
      ]);
      assert.deepEqual(withTakeover.calls, [
        ["grid-takeover", "camera.driveway", "detection"],
      ]);
    } finally {
      withoutTakeover.grid.clearTimers();
      withTakeover.grid.clearTimers();
    }
  }
});

test("Slideshow exclusively owns alert takeover and its hold on every shared-mode page", () => {
  const originalNow = Date.now;
  Date.now = () => 1000;
  try {
    for (const pageId of PAGES_WITH_SHARED_MODES) {
      const harness = createModeHarness({ pageId, owner: "slideshow" });
      harness.presentAlertThroughEveryOwner();

      assert.equal(harness.host._slideshowPausedUntil, 16000);
      assert.deepEqual(harness.calls, [
        ["slideshow-outline", "detection"],
        ["switch", 1, { source: "alert" }],
        ["slideshow-schedule", "ha-alert-switch"],
      ]);
      harness.grid.clearTimers();
    }
  } finally {
    Date.now = originalNow;
  }
});

test("normal live takeover remains page-independent and inactive during shared modes", () => {
  for (const pageId of PAGES_WITH_SHARED_MODES) {
    const harness = createModeHarness({ pageId, owner: "live" });
    harness.presentAlertThroughEveryOwner();

    assert.deepEqual(harness.calls, [
      ["live-outline", "detection"],
      [
        "switch",
        1,
        { source: "alert", origin: "live-alert-takeover" },
      ],
    ]);
    harness.grid.clearTimers();
  }
});
