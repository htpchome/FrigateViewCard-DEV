import { test } from "node:test";
import assert from "node:assert/strict";

import { LiveAlertTakeoverController } from "../src/features/live/alert-takeover.ctrl.js";

const createHarness = ({ enabled = true } = {}) => {
  const calls = [];
  const host = {
    _viewMode: "single",
    _gridResumePending: false,
    _slideshowActive: false,
    _activeCam: { entity: "camera.front" },
    _activeGroupMemberOverride: "",
    _config: {
      cameras: [
        { entity: "camera.front", name: "Front" },
        { entity: "camera.driveway", name: "Driveway" },
        {
          entity: "camera.porch",
          name: "Porch / Package",
          group: { secondary_entity: "camera.package" },
        },
      ],
    },
    _alertCameraTakeoverEnabled: () => enabled,
    _cameraIndexByEntity: (entity) => {
      if (entity === "camera.front") return 0;
      if (entity === "camera.driveway") return 1;
      if (entity === "camera.porch" || entity === "camera.package") return 2;
      return -1;
    },
    _setLiveAlertState: (severity) => calls.push(["outline", severity]),
    _switchCamera: (index, options) => {
      calls.push(["switch", index, options]);
      host._activeCam = host._config.cameras[index];
      host._activeGroupMemberOverride = options?.groupMemberEntity || "";
    },
    _extractRealtimeMessageCamera: (message) => message.camera,
    _cameraEntityForIncomingCamera: (camera) =>
      String(camera || "").startsWith("camera.")
        ? camera
        : `camera.${camera}`,
    _extractRealtimeMessageSeverity: (message) => message.severity,
    _shouldHandleSlideshowReview: () => true,
  };
  return { host, calls, controller: new LiveAlertTakeoverController(host) };
};

test("normal live takeover presents only the latest changed HA camera", () => {
  const { controller, calls } = createHarness();

  assert.equal(
    controller.syncHaAlertState({
      reportedEntities: new Set(["camera.front", "camera.driveway"]),
      candidates: [
        { entity: "camera.front", severity: "alert", changedAt: 100 },
        {
          entity: "camera.driveway",
          severity: "detection",
          changedAt: 200,
        },
      ],
    }),
    true,
  );

  assert.deepEqual(calls, [
    ["outline", "detection"],
    [
      "switch",
      1,
      { source: "alert", origin: "live-alert-takeover" },
    ],
  ]);

  calls.length = 0;
  assert.equal(
    controller.syncHaAlertState({
      reportedEntities: new Set(["camera.front", "camera.driveway"]),
      candidates: [
        { entity: "camera.front", severity: "alert", changedAt: 100 },
        {
          entity: "camera.driveway",
          severity: "detection",
          changedAt: 200,
        },
      ],
    }),
    false,
  );
  assert.deepEqual(calls, [["outline", "detection"]]);
});

test("normal live takeover outlines an already active alerted camera", () => {
  const { controller, calls } = createHarness();

  controller.syncHaAlertState({
    reportedEntities: new Set(["camera.front"]),
    candidates: [
      { entity: "camera.front", severity: "alert", changedAt: 100 },
    ],
  });

  assert.deepEqual(calls, [["outline", "alert"]]);

  calls.length = 0;
  controller.syncHaAlertState({
    reportedEntities: new Set(["camera.front"]),
    candidates: [],
  });
  assert.deepEqual(calls, [["outline", ""]]);
});

test("normal live takeover recognizes a newer HA alert at the same severity", () => {
  const { host, controller, calls } = createHarness();
  const reportedEntities = new Set(["camera.driveway"]);

  controller.syncHaAlertState({
    reportedEntities,
    candidates: [
      { entity: "camera.driveway", severity: "alert", changedAt: 100 },
    ],
  });
  host._activeCam = host._config.cameras[0];
  calls.length = 0;

  controller.syncHaAlertState({
    reportedEntities,
    candidates: [
      { entity: "camera.driveway", severity: "alert", changedAt: 200 },
    ],
  });

  assert.deepEqual(calls, [
    ["outline", "alert"],
    [
      "switch",
      1,
      { source: "alert", origin: "live-alert-takeover" },
    ],
  ]);
});

test("normal live takeover selects the alerted member of an A/B camera", () => {
  const { controller, calls } = createHarness();

  controller.syncHaAlertState({
    reportedEntities: new Set(["camera.package"]),
    candidates: [
      { entity: "camera.package", severity: "alert", changedAt: 100 },
    ],
  });

  assert.deepEqual(calls, [
    ["outline", "alert"],
    [
      "switch",
      2,
      {
        source: "alert",
        origin: "live-alert-takeover",
        groupMemberEntity: "camera.package",
      },
    ],
  ]);
});

test("normal live takeover selects A when an unscoped A/B camera is active", () => {
  const { host, controller, calls } = createHarness();
  host._activeCam = host._config.cameras[2];

  controller.syncHaAlertState({
    reportedEntities: new Set(["camera.porch"]),
    candidates: [
      { entity: "camera.porch", severity: "detection", changedAt: 100 },
    ],
  });

  assert.deepEqual(calls, [
    ["outline", "detection"],
    [
      "switch",
      2,
      {
        source: "alert",
        origin: "live-alert-takeover",
        groupMemberEntity: "camera.porch",
      },
    ],
  ]);
});

test("normal live realtime takeover deduplicates updates but accepts new alerts", () => {
  const { host, controller, calls } = createHarness();
  const message = { camera: "driveway", severity: "detection" };

  assert.equal(
    controller.handleRealtimeMessage({ ...message, type: "new" }),
    true,
  );
  assert.equal(
    controller.handleRealtimeMessage({ ...message, type: "update" }),
    false,
  );
  assert.equal(
    controller.handleRealtimeMessage({ ...message, type: "end" }),
    false,
  );
  host._activeCam = host._config.cameras[0];
  assert.equal(
    controller.handleRealtimeMessage({ ...message, type: "new" }),
    true,
  );

  assert.deepEqual(
    calls.filter(([name]) => name === "switch"),
    [
      [
        "switch",
        1,
        { source: "alert", origin: "live-alert-takeover" },
      ],
      [
        "switch",
        1,
        { source: "alert", origin: "live-alert-takeover" },
      ],
    ],
  );
});

test("normal live realtime takeover treats same-severity new messages as alerts", () => {
  const { host, controller, calls } = createHarness();
  const message = { camera: "driveway", severity: "alert" };

  controller.handleRealtimeMessage({ ...message, type: "new" });
  host._activeCam = host._config.cameras[0];
  calls.length = 0;
  controller.handleRealtimeMessage({ ...message, type: "new" });

  assert.deepEqual(calls, [
    ["outline", "alert"],
    [
      "switch",
      1,
      { source: "alert", origin: "live-alert-takeover" },
    ],
  ]);
});

test("normal live takeover stays inactive when disabled or owned by another mode", () => {
  const disabled = createHarness({ enabled: false });
  disabled.controller.syncHaAlertState({
    reportedEntities: new Set(["camera.driveway"]),
    candidates: [
      { entity: "camera.driveway", severity: "alert", changedAt: 100 },
    ],
  });
  assert.deepEqual(disabled.calls, [["outline", ""]]);

  for (const configureOwner of [
    (host) => {
      host._viewMode = "grid";
    },
    (host) => {
      host._slideshowActive = true;
    },
    (host) => {
      host._gridResumePending = true;
    },
  ]) {
    const harness = createHarness();
    configureOwner(harness.host);
    harness.controller.syncHaAlertState({
      reportedEntities: new Set(["camera.driveway"]),
      candidates: [
        { entity: "camera.driveway", severity: "alert", changedAt: 100 },
      ],
    });
    assert.deepEqual(harness.calls, []);
  }
});

test("normal live takeover honors per-camera alert content filtering", () => {
  const { host, controller, calls } = createHarness();
  host._shouldHandleSlideshowReview = (_entity, severity) =>
    severity === "alert";

  assert.equal(
    controller.handleRealtimeMessage({
      camera: "driveway",
      severity: "detection",
      type: "new",
    }),
    false,
  );
  assert.deepEqual(calls, []);
});
