import assert from "node:assert/strict";
import { test } from "node:test";
import { createLiveGraceController } from "../src/features/live/live-grace-controller.js";

test("normal HA Direct cleanup releases presentation but never detaches the session provider", () => {
  const calls = [];
  const engine = { type: "ha_direct", haDirectProvider: true,
    remove: () => { throw new Error("The session owns this provider"); } };
  const controller = createLiveGraceController({
    getEngine: () => engine,
    releaseHaDirectEngine: (value) => calls.push(["release-presentation", value]),
    setEngine: (value) => calls.push(["assign", value]),
  });
  controller.cleanupEngine();
  assert.deepEqual(calls, [["release-presentation", engine], ["assign", null]]);
  assert.equal(controller.takeGraceHaDirectEntry, undefined);
  assert.equal(controller.getHaDirectDeckHost, undefined);
  controller.clearGracePool();
  assert.equal(calls.length, 2);
});

test("camera eviction is delegated to the normal HA Direct session owner", () => {
  const calls = [];
  const controller = createLiveGraceController({ evictHaDirectEntity: (entity) => calls.push(entity) });
  controller.evictEntity("camera.one");
  assert.deepEqual(calls, ["camera.one"]);
});
