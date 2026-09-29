import assert from "node:assert/strict";
import test from "node:test";

import {
  createHaDirectPlaybackDiagnostic,
  HA_DIRECT_DIAGNOSTICS_STORAGE_KEY,
  isHaDirectDiagnosticsEnabled,
} from "../src/integrations/home-assistant/playback-diagnostics.js";

test("HA Direct diagnostics stay disabled unless explicitly enabled", () => {
  const storage = { getItem: () => null };
  const target = {};

  assert.equal(isHaDirectDiagnosticsEnabled({ storage, target }), false);
  const diagnostic = createHaDirectPlaybackDiagnostic(
    { entity: "camera.front" },
    { storage, target },
  );
  assert.equal(diagnostic.enabled, false);
});

test("HA Direct diagnostics record safe relative timing and export attempts", () => {
  let elapsed = 100;
  const messages = [];
  const marks = [];
  const storage = {
    getItem: (key) =>
      key === HA_DIRECT_DIAGNOSTICS_STORAGE_KEY ? "1" : null,
  };
  const target = {};
  const diagnostic = createHaDirectPlaybackDiagnostic(
    {
      entity: "camera.front",
      requestedStreamType: "webrtc",
    },
    {
      storage,
      target,
      now: () => elapsed,
      wallClock: () => "2026-09-29T00:00:00.000Z",
      performanceApi: { mark: (name) => marks.push(name) },
      logger: { info: (...args) => messages.push(args) },
    },
  );

  elapsed = 112.34;
  diagnostic.mark("client-config", {
    ready: true,
    ignoredObject: { token: "secret" },
  });
  elapsed = 140;
  diagnostic.finish("ready", { transport: "hls" });
  diagnostic.finish("ignored");

  assert.equal(diagnostic.enabled, true);
  assert.equal(target.__fvcHaDirectDiagnostics.attempts.length, 1);
  assert.deepEqual(target.__fvcHaDirectDiagnostics.attempts[0], {
    id: diagnostic.attemptId,
    entity: "camera.front",
    requestedStreamType: "webrtc",
    startedAt: "2026-09-29T00:00:00.000Z",
    status: "ready",
    marks: [
      { atMs: 0, stage: "attempt-start" },
      { atMs: 12.3, stage: "client-config", ready: true },
      {
        atMs: 40,
        stage: "attempt-finished",
        status: "ready",
        transport: "hls",
      },
    ],
  });
  assert.equal(
    JSON.parse(target.__fvcHaDirectDiagnostics.export())[0].status,
    "ready",
  );
  assert.equal(messages.length, 3);
  assert.equal(marks.length, 3);
});

test("HA Direct diagnostics can be enabled without storage for Chrome", () => {
  const target = { __FVC_HA_DIRECT_DIAGNOSTICS__: true };
  assert.equal(
    isHaDirectDiagnosticsEnabled({
      storage: { getItem: () => null },
      target,
    }),
    true,
  );
});

test("HA Direct diagnostics assign attempt IDs without mutable module state", () => {
  const target = { __FVC_HA_DIRECT_DIAGNOSTICS__: true };
  const options = {
    target,
    storage: { getItem: () => null },
    now: () => 0,
    logger: { info: () => {} },
  };

  const first = createHaDirectPlaybackDiagnostic({}, options);
  const second = createHaDirectPlaybackDiagnostic({}, options);

  assert.equal(first.attemptId, 1);
  assert.equal(second.attemptId, 2);
  target.__fvcHaDirectDiagnostics.clear();
  assert.equal(
    createHaDirectPlaybackDiagnostic({}, options).attemptId,
    1,
  );
});
