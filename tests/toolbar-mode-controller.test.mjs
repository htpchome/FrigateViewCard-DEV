import { test } from "node:test";
import assert from "node:assert/strict";

import { GridPageController } from "../src/features/grid/page.ctrl.js";
import { GridMediaController } from "../src/features/grid/media.ctrl.js";
import { SlideshowPageController } from "../src/features/slideshow/page.ctrl.js";

test("grid mode refuses activation while another toolbar mode is active", () => {
  const calls = [];
  const host = {
    _viewMode: "single",
    _gridResumePending: false,
    _isPreviewPageActive: () => false,
    _toolbarButtonStates: () => ({ gridDisabled: true }),
    _syncToolbarButtons: () => calls.push("syncToolbar"),
    _setViewMode: (mode) => calls.push(["setViewMode", mode]),
  };
  const controller = new GridPageController(host);

  controller.toggleGridMode();

  assert.deepEqual(calls, ["syncToolbar"]);
  assert.equal(host._viewMode, "single");
});

test("grid mode retains background live transport state for a reconnect-free exit", () => {
  const restoredTypes = [];
  const host = {
    _viewMode: "single",
    _activeStreamType: "webrtc",
    _lastLiveStreamHint: "webrtc",
    _setActiveStreamType: (type) => restoredTypes.push(type),
  };
  const controller = new GridPageController(host);

  controller.prepareLiveForGrid();
  host._viewMode = "grid";
  assert.equal(controller.captureBackgroundLiveStreamType("mse"), true);
  assert.equal(controller.captureBackgroundLiveStreamType("grid"), false);
  host._viewMode = "single";
  const restored = controller.restoreLiveAfterGrid();

  assert.deepEqual(restoredTypes, ["mse"]);
  assert.equal(restored, true);
});

test("cold startup Grid exits to the first configured camera", () => {
  const restoredTypes = [];
  const handoffResult = {
    ok: true,
    type: "webrtc",
    engine: { id: "grid-camera-one" },
    slot: { id: "grid-camera-one-slot" },
  };
  const host = {
    _viewMode: "single",
    _activeCamIdx: 3,
    _activeGroupMemberOverride: "camera.package",
    _activeStreamType: "--",
    _lastLiveStreamHint: "",
    _engine: null,
    _config: { cameras: [{ entity: "camera.front" }] },
    _gridMediaController: {
      takeGridLiveHandoff: (entity) => {
        assert.equal(entity, "camera.front");
        return handoffResult;
      },
    },
    _setActiveStreamType: (type) => restoredTypes.push(type),
  };
  const controller = new GridPageController(host);

  controller.prepareLiveForGrid();
  host._viewMode = "grid";
  const handoff = controller.takeColdStartLiveHandoff();
  const restored = controller.restoreLiveAfterGrid();

  assert.equal(handoff, handoffResult);
  assert.equal(restored, false);
  assert.equal(host._activeCamIdx, 0);
  assert.equal(host._activeGroupMemberOverride, "");
  assert.deepEqual(restoredTypes, ["--"]);
});

test("custom cold-start Grid exits through its first included physical camera", () => {
  const groupedCamera = {
    entity: "camera.doorbell",
    group: {
      secondary_entity: "camera.package",
      layout: "stacked",
    },
  };
  const takenEntities = [];
  const host = {
    _activeCamIdx: 0,
    _activeGroupMemberOverride: "",
    _activeStreamType: "--",
    _lastLiveStreamHint: "",
    _engine: null,
    _config: {
      cameras: [groupedCamera, { entity: "camera.driveway" }],
      grid_order: {
        mode: "custom",
        included: ["camera.package", "camera.driveway"],
        excluded: ["camera.doorbell"],
      },
    },
    _gridMediaController: {
      takeGridLiveHandoff: (entity) => {
        takenEntities.push(entity);
        return { engine: {}, slot: {}, type: "webrtc" };
      },
    },
    _setActiveStreamType: () => {},
  };
  const controller = new GridPageController(host);

  assert.equal(controller._displayCameras().length, 2);
  assert.equal(controller.takeColdStartLiveHandoff()?.type, "webrtc");
  assert.equal(controller.restoreLiveAfterGrid(), false);
  assert.deepEqual(takenEntities, ["camera.package"]);
  assert.equal(host._activeCamIdx, 0);
  assert.equal(host._activeGroupMemberOverride, "camera.package");
});

test("non-cold Grid keeps its retained main live engine instead of taking a cell", () => {
  let handoffCalls = 0;
  const host = {
    _activeStreamType: "webrtc",
    _engine: { id: "retained-main-engine" },
    _config: { cameras: [{ entity: "camera.front" }] },
    _gridMediaController: {
      takeGridLiveHandoff: () => {
        handoffCalls += 1;
        return {};
      },
    },
  };
  const controller = new GridPageController(host);

  controller.prepareLiveForGrid();

  assert.equal(controller.takeColdStartLiveHandoff(), null);
  assert.equal(handoffCalls, 0);
});

test("Grid releases a retained main connection when it will mount the same camera live", () => {
  const handoffResult = {
    ok: true,
    type: "webrtc",
    engine: { id: "grid-back-engine" },
    slot: { id: "grid-back-slot" },
  };
  const calls = [];
  const host = {
    _viewMode: "single",
    _activeCamIdx: 1,
    _activeGroupMemberOverride: "",
    _activeCam: { entity: "camera.back" },
    _activeStreamType: "webrtc",
    _lastLiveStreamHint: "webrtc",
    _engine: { id: "single-back-engine" },
    _mountInProgress: false,
    _config: {
      cameras: [
        { entity: "camera.front" },
        { entity: "camera.back" },
      ],
    },
    _gridMediaController: {
      shouldUseLive: (entity) => {
        calls.push(["shouldUseLive", entity]);
        return true;
      },
      takeGridLiveHandoff: (entity) => {
        calls.push(["takeGridLiveHandoff", entity]);
        return entity === "camera.back" ? handoffResult : null;
      },
    },
    _setActiveStreamType: (type) => calls.push(["setStreamType", type]),
  };
  const controller = new GridPageController(host);

  const preparation = controller.prepareLiveForGrid();

  assert.deepEqual(preparation, {
    releaseMainLive: true,
    returnEntity: "camera.back",
  });
  host._engine = null;
  host._viewMode = "grid";
  assert.equal(controller.takeColdStartLiveHandoff(), handoffResult);
  host._viewMode = "single";
  assert.equal(controller.restoreLiveAfterGrid(), false);
  assert.equal(host._activeCamIdx, 1);
  assert.equal(host._activeGroupMemberOverride, "");
  assert.deepEqual(calls, [
    ["shouldUseLive", "camera.back"],
    ["takeGridLiveHandoff", "camera.back"],
    ["setStreamType", "webrtc"],
  ]);
});

test("Grid retains the main connection when the active camera is snapshot-only", () => {
  const host = {
    _activeCam: { entity: "camera.front" },
    _activeStreamType: "webrtc",
    _engine: { id: "single-front-engine" },
    _mountInProgress: false,
    _config: {
      cameras: [
        { entity: "camera.front" },
        { entity: "camera.back" },
      ],
    },
    _gridMediaController: {
      shouldUseLive: () => false,
    },
  };
  const controller = new GridPageController(host);

  assert.deepEqual(controller.prepareLiveForGrid(), {
    releaseMainLive: false,
    returnEntity: "",
  });
});

test("Grid media hands off a mounted camera engine only once", () => {
  const result = {
    ok: true,
    type: "webrtc",
    engine: { id: "camera-one-engine" },
    slot: { id: "camera-one-slot" },
  };
  let takeCalls = 0;
  const liveHandoffs = new Map([
    [
      "camera.front",
      {
        take: () => {
          takeCalls += 1;
          return result;
        },
      },
    ],
  ]);
  const host = {
    _gridEngine: {
      pages: new Map([["0", { liveHandoffs }]]),
    },
  };
  const controller = new GridMediaController(host);

  assert.equal(controller.takeGridLiveHandoff("camera.front"), result);
  assert.equal(controller.takeGridLiveHandoff("camera.front"), null);
  assert.equal(takeCalls, 1);
});

test("Grid media activates the selected page directly through its Grid slot", () => {
  const slot = { id: "grid-slot" };
  const host = {
    shadowRoot: {
      querySelector: (selector) =>
        selector === "#grid-engine" ? slot : null,
    },
  };
  const controller = new GridMediaController(host);
  const calls = [];
  controller.mountGridEngine = (target) => calls.push(target);

  assert.equal(controller.activateCurrentGridPage(), true);
  assert.deepEqual(calls, [slot]);
});

test("Grid button exit lets the view transition claim live media before teardown", () => {
  const calls = [];
  const host = {
    _viewMode: "grid",
    _gridResumePending: false,
    _isPreviewPageActive: () => false,
    _setViewMode: (mode) => calls.push(["setViewMode", mode]),
    _gridMediaController: {
      teardownGridEngine: () => calls.push(["teardownGridEngine"]),
    },
  };
  const controller = new GridPageController(host);

  controller.toggleGridMode();

  assert.deepEqual(calls, [["setViewMode", "single"]]);
});

test("Grid stops its active presentation when navigation leaves the page", () => {
  const calls = [];
  const host = {
    _viewMode: "grid",
    _gridResumePending: false,
    _setViewMode: (mode) => calls.push(["setViewMode", mode]),
  };
  const controller = new GridPageController(host);

  assert.equal(
    controller.handlePageChange("single-view", "mobile-view"),
    true,
  );
  assert.deepEqual(calls, [["setViewMode", "single"]]);
});

test("Grid cancels a pending alert-return session when navigation leaves", () => {
  const calls = [];
  const host = {
    _viewMode: "single",
    _gridResumePending: true,
    _syncToolbarButtons: () => calls.push(["syncToolbar"]),
  };
  const controller = new GridPageController(host);
  controller.stopGridModeState = () => {
    calls.push(["stopGridModeState"]);
    host._gridResumePending = false;
  };

  assert.equal(
    controller.handlePageChange("card-view", "preview"),
    true,
  );
  assert.equal(host._gridResumePending, false);
  assert.deepEqual(calls, [
    ["stopGridModeState"],
    ["syncToolbar"],
  ]);
});

test("Grid preserves its state when navigation remains on the same page", () => {
  const calls = [];
  const host = {
    _viewMode: "grid",
    _gridResumePending: false,
    _setViewMode: (mode) => calls.push(["setViewMode", mode]),
  };
  const controller = new GridPageController(host);

  assert.equal(
    controller.handlePageChange("single-view", "single-view"),
    false,
  );
  assert.deepEqual(calls, []);
});

test("Grid rotation pauses in the Home Assistant config preview without changing the Grid", () => {
  const calls = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  global.setTimeout = () => {
    calls.push("schedule");
    return { id: "new-rotation" };
  };
  global.clearTimeout = (timer) => calls.push(["clear", timer]);
  try {
    const existingTimer = { id: "existing-rotation" };
    const host = {
      _viewMode: "grid",
      _gridRotationT: existingTimer,
      _gridRotationStart: 0,
      _config: {
        grid_mode_enabled: true,
        grid_rotation_seconds: 10,
        cameras: Array.from({ length: 8 }, (_, index) => ({
          entity: `camera.${index + 1}`,
        })),
      },
      _isEditorPreviewContext: () => true,
      _mountEngine: () => calls.push("mount"),
    };
    const controller = new GridPageController(host);

    controller.scheduleGridRotation();
    controller.advanceGridRotation();

    assert.deepEqual(calls, [["clear", existingTimer]]);
    assert.equal(host._gridRotationT, null);
    assert.equal(host._gridRotationStart, 0);
    assert.equal(host._viewMode, "grid");
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test("Grid rotation still schedules normally outside the config preview", () => {
  const calls = [];
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (_callback, delay) => {
    calls.push(delay);
    return { id: "rotation" };
  };
  try {
    const host = {
      _viewMode: "grid",
      _gridRotationT: null,
      _config: {
        grid_mode_enabled: true,
        grid_rotation_seconds: 10,
        cameras: Array.from({ length: 8 }, (_, index) => ({
          entity: `camera.${index + 1}`,
        })),
      },
      _isEditorPreviewContext: () => false,
    };
    const controller = new GridPageController(host);

    controller.scheduleGridRotation();

    assert.deepEqual(calls, [10000]);
    assert.deepEqual(host._gridRotationT, { id: "rotation" });
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test("Grid alert immediately opens its page, holds it, then advances into normal rotation", () => {
  const calls = [];
  const timers = [];
  const originalNow = Date.now;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let now = 1000;
  Date.now = () => now;
  global.setTimeout = (callback, delay) => {
    const timer = { callback, delay, id: timers.length + 1 };
    timers.push(timer);
    return timer;
  };
  global.clearTimeout = (timer) => calls.push(["clear", timer?.id]);
  try {
    const host = {
      _viewMode: "grid",
      _gridRotationStart: 0,
      _gridPinnedRotationStart: 0,
      _gridRotationT: null,
      _gridAlertReturnT: null,
      _gridRefreshT: null,
      _config: {
        grid_mode_enabled: true,
        grid_rotation_seconds: 10,
        cameras: Array.from({ length: 8 }, (_, index) => ({
          entity: `camera.${index + 1}`,
        })),
      },
      _isLikelyMobileClient: () => false,
      _isEditorPreviewContext: () => false,
      _gridAlertHoldMs: () => 30000,
      _mountEngine: (...args) => calls.push(["mount", ...args]),
      _gridMediaController: {
        activateCurrentGridPage: () => {
          calls.push(["activateGridPage", host._gridRotationStart]);
          return true;
        },
      },
    };
    const controller = new GridPageController(host);

    controller.scheduleGridRotation();
    now = 5000;
    assert.equal(controller.beginAlertPageHold("camera.5"), true);

    assert.equal(host._gridRotationStart, 4);
    assert.equal(host._gridPinnedRotationStart, 4);
    assert.deepEqual(calls.at(-1), ["activateGridPage", 4]);
    assert.equal(timers[1].delay, 30000);

    timers[1].callback();

    assert.equal(host._gridRotationStart, 0);
    assert.deepEqual(calls.at(-1), ["mount", null, { quiet: true }]);
    assert.equal(timers[2].delay, 10000);
  } finally {
    Date.now = originalNow;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test("Grid alert takeover temporarily stages one camera and resumes its page timer", async () => {
  const calls = [];
  const timers = [];
  const originalNow = Date.now;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  Date.now = () => 1000;
  global.setTimeout = (callback, delay) => {
    const timer = { callback, delay, id: timers.length + 1 };
    timers.push(timer);
    return timer;
  };
  global.clearTimeout = (timer) => calls.push(["clear", timer?.id]);
  try {
    let controller;
    const host = {
      _viewMode: "grid",
      _gridResumePending: false,
      _gridRotationStart: 0,
      _gridPinnedRotationStart: 0,
      _gridRotationT: null,
      _gridAlertReturnT: null,
      _gridRefreshT: null,
      _config: {
        grid_mode_enabled: true,
        grid_rotation_seconds: 10,
        cameras: Array.from({ length: 8 }, (_, index) => ({
          entity: `camera.${index + 1}`,
        })),
      },
      _isLikelyMobileClient: () => false,
      _isEditorPreviewContext: () => false,
      _alertCameraTakeoverEnabled: () => true,
      _cameraIndexByEntity: (entity) =>
        Number(String(entity).split(".").at(-1)) - 1,
      _gridAlertHoldMs: () => 30000,
      _setSlideshowAlertState: (severity) =>
        calls.push(["severity", severity]),
      _syncToolbarButtons: () => calls.push(["syncToolbar"]),
      _switchCamera: async (index, options) => {
        calls.push(["switchCamera", index, options]);
        host._viewMode = "single";
      },
      _setViewMode: (mode, options) => {
        calls.push(["setViewMode", mode, options]);
        host._viewMode = mode;
        if (mode === "grid") controller.scheduleGridRotation();
      },
    };
    controller = new GridPageController(host);

    controller.scheduleGridRotation();
    assert.equal(timers[0].delay, 10000);

    const takeover = controller.beginAlertTakeover("camera.5", "detection");
    assert.equal(host._viewMode, "single");
    assert.equal(host._gridResumePending, true);
    assert.equal(host._gridPinnedRotationStart, 4);
    assert.equal(timers[1].delay, 30000);
    assert.deepEqual(
      calls.find(([name]) => name === "switchCamera"),
      [
        "switchCamera",
        4,
        {
          source: "alert",
          origin: "grid-alert-takeover",
          gridAlertTakeover: true,
          keepGridResume: true,
        },
      ],
    );
    assert.equal(await takeover, true);

    timers[1].callback();

    assert.equal(host._viewMode, "grid");
    assert.equal(host._gridResumePending, false);
    assert.equal(timers[2].delay, 10000);
    assert.equal(
      calls.some(
        ([name, mode, options]) =>
          name === "setViewMode" &&
          mode === "grid" &&
          options?.resumeGridSession === true,
      ),
      true,
    );
  } finally {
    Date.now = originalNow;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test("slideshow refuses activation while another toolbar mode is active", () => {
  const calls = [];
  const host = {
    _slideshowActive: false,
    _toolbarButtonStates: () => ({ slideshowDisabled: true }),
    _syncToolbarButtons: () => calls.push("syncToolbar"),
    _isSlideshowRotationAvailable: () => true,
  };
  const controller = new SlideshowPageController(host);

  controller.toggleRotation();

  assert.deepEqual(calls, ["syncToolbar"]);
  assert.equal(host._slideshowActive, false);
  assert.equal(controller.startRotation(), false);
});

test("slideshow interaction restart schedules only one interval", async () => {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalDateNow = Date.now;
  const scheduled = [];
  Date.now = () => 1000;
  global.setTimeout = (callback, delay) => {
    const timer = { callback, delay };
    scheduled.push(timer);
    return timer;
  };
  global.clearTimeout = () => {};
  try {
    const countdowns = [];
    const host = {
      _slideshowActive: true,
      _slideshowPopupPaused: false,
      _slideshowPausedUntil: 0,
      _slideshowPauseT: null,
      _slideshowSwitchT: null,
      _isSlideshowRotationAvailable: () => true,
      _slideshowRotationMs: () => 5000,
      _setSlideshowCountdown: (delay) => countdowns.push(delay),
    };
    const controller = new SlideshowPageController(host);
    let advances = 0;
    controller.advanceRotation = async () => {
      advances += 1;
    };

    controller.pauseForInteraction();

    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delay, 5000);
    assert.deepEqual(countdowns, [5000]);
    assert.equal(host._slideshowPauseT, null);
    assert.equal(host._slideshowSwitchT, scheduled[0]);

    scheduled[0].callback();
    await Promise.resolve();
    assert.equal(advances, 1);
    assert.equal(scheduled.length, 1);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    Date.now = originalDateNow;
  }
});

test("slideshow stops its session when navigation leaves the page", () => {
  const calls = [];
  const host = { _slideshowActive: true };
  const controller = new SlideshowPageController(host);
  controller.stopRotation = (reason, sync) => {
    calls.push([reason, sync]);
    host._slideshowActive = false;
  };

  assert.equal(
    controller.handlePageChange("mobile-view", "preview"),
    true,
  );
  assert.deepEqual(calls, [["page-navigation", false]]);
  assert.equal(host._slideshowActive, false);
  assert.equal(
    controller.handlePageChange("preview", "preview"),
    false,
  );
});

test("slideshow rotates through physical members of a camera group", async () => {
  const calls = [];
  const groupedCamera = {
    entity: "camera.doorbell",
    group: {
      secondary_entity: "camera.package",
      layout: "side_by_side",
    },
  };
  const host = {
    _slideshowActive: true,
    _slideshowPopupPaused: false,
    _slideshowPendingAlertCam: "",
    _slideshowPendingAlertType: "",
    _activeGroupMemberOverride: "camera.doorbell",
    _activeCam: groupedCamera,
    _activeCamIdx: 0,
    _config: { cameras: [groupedCamera] },
    _isSlideshowRotationAvailable: () => true,
    _switchCamera: async (...args) => calls.push(["switchCamera", ...args]),
    _slideshowRotationMs: () => 5000,
    _setSlideshowAlertState: (state) =>
      calls.push(["setSlideshowAlertState", state]),
  };
  const controller = new SlideshowPageController(host);
  controller.scheduleRotation = (reason) =>
    calls.push(["scheduleRotation", reason]);

  await controller.advanceRotation();

  assert.deepEqual(calls, [
    [
      "switchCamera",
      0,
      { source: "slideshow", groupMemberEntity: "camera.package" },
    ],
    ["setSlideshowAlertState", ""],
    ["scheduleRotation", "advance"],
  ]);
});
