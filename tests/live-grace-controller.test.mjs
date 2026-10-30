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

const createNode = () => ({
  children: [],
  parentNode: null,
  style: { cssText: "" },
  setAttribute() {},
  appendChild(child) {
    if (child.parentNode) {
      child.parentNode.children = child.parentNode.children.filter(
        (candidate) => candidate !== child,
      );
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  },
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(
      (candidate) => candidate !== this,
    );
    this.parentNode = null;
  },
});

const createMseEngine = (entity) => {
  const video = createNode();
  video.play = () => Promise.resolve();
  video.setAttribute = () => {};
  video.removeAttribute = () => {};
  return {
    entity,
    type: "frigate_go2rtc",
    streamType: "mse",
    video,
    ws: { readyState: 1 },
    reusable: true,
    resumeCalls: 0,
    destroyCalls: 0,
    destroy() {
      this.destroyCalls += 1;
    },
    activateRecovery() {},
    deactivateRecovery() {},
    setRecoveryHandler() {},
    setActivityHandler() {},
    isReusable() {
      return this.reusable;
    },
    resumeAtLiveEdge() {
      this.resumeCalls += 1;
    },
  };
};

test("MSE grace reuse preserves exact camera identity across three retained switches", (t) => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => createNode() };
  t.after(() => {
    globalThis.document = previousDocument;
  });

  const root = createNode();
  const liveSlot = createNode();
  let activeEngine = createMseEngine("camera.one");
  let activeType = "mse";
  const controller = createLiveGraceController({
    graceMs: 20000,
    graceMax: 3,
    getShadowRoot: () => root,
    getScopeKey: () => ({}),
    getPendingMountDestroyers: () => [],
    setPendingMountDestroyers: () => {},
    getEngine: () => activeEngine,
    setEngine: (engine) => {
      activeEngine = engine;
    },
    getActiveStreamType: () => activeType,
    getStreamMuted: () => true,
    setActiveStreamType: (type) => {
      activeType = type;
    },
    setEngineMountedMuted: () => {},
    setStreamLoading: () => {},
    setStreamFallbackVisible: () => {},
    attachVideoFit: () => {},
  });
  const first = activeEngine;

  controller.cleanupEngine({ preserveLiveEntity: "camera.one" });
  activeEngine = createMseEngine("camera.two");
  const second = activeEngine;
  controller.cleanupEngine({ preserveLiveEntity: "camera.two" });
  activeEngine = createMseEngine("camera.three");
  const third = activeEngine;
  controller.cleanupEngine({ preserveLiveEntity: "camera.three" });

  const firstEntry = controller.takeGraceMseEntry("camera.one");
  assert.equal(firstEntry.engine, first);
  assert.equal(
    controller.adoptGraceMseEngine(liveSlot, firstEntry.engine, "camera.one"),
    true,
  );
  assert.equal(activeEngine, first);
  assert.equal(first.resumeCalls, 1);

  controller.cleanupEngine({ preserveLiveEntity: "camera.one" });
  const secondEntry = controller.takeGraceMseEntry("camera.two");
  assert.equal(secondEntry.engine, second);
  assert.equal(
    controller.adoptGraceMseEngine(liveSlot, secondEntry.engine, "camera.two"),
    true,
  );
  assert.equal(activeEngine, second);
  controller.cleanupEngine({ preserveLiveEntity: "camera.two" });
  const thirdEntry = controller.takeGraceMseEntry("camera.three");
  assert.equal(thirdEntry.engine, third);
  assert.equal(
    controller.adoptGraceMseEngine(liveSlot, thirdEntry.engine, "camera.three"),
    true,
  );
  assert.equal(activeEngine, third);
  assert.equal(first.destroyCalls, 0);
  assert.equal(second.destroyCalls, 0);
  assert.equal(third.destroyCalls, 0);

  controller.clearGracePool();
});

test("rapid camera switches retain an in-progress MSE connection by entity", async (t) => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => createNode() };
  t.after(() => {
    globalThis.document = previousDocument;
  });

  const root = createNode();
  const liveSlot = createNode();
  const pendingEngine = createMseEngine("camera.one");
  const pending = [{
    type: "mse",
    entity: "camera.one",
    promise: Promise.resolve({
      ok: true,
      type: "mse",
      engine: pendingEngine,
    }),
    destroy() {
      throw new Error("retained pending MSE must not be destroyed");
    },
  }];
  let activeEngine = null;
  let remainingPending = pending;
  const controller = createLiveGraceController({
    graceMs: 20000,
    graceMax: 3,
    getShadowRoot: () => root,
    getPendingMountDestroyers: () => remainingPending,
    setPendingMountDestroyers: (value) => {
      remainingPending = value;
    },
    getEngine: () => activeEngine,
    setEngine: (engine) => {
      activeEngine = engine;
    },
    getActiveStreamType: () => "mse",
    getStreamMuted: () => true,
    setActiveStreamType: () => {},
    setEngineMountedMuted: () => {},
    setStreamLoading: () => {},
    setStreamFallbackVisible: () => {},
    attachVideoFit: () => {},
  });

  controller.cleanupEngine({ preserveLiveEntity: "camera.one" });
  assert.deepEqual(remainingPending, []);
  const entry = controller.takeGraceMseEntry("camera.one");
  assert.ok(entry?.promise);
  assert.equal(await entry.promise, pendingEngine);
  assert.equal(
    controller.adoptGraceMseEngine(liveSlot, pendingEngine, "camera.one"),
    true,
  );
  assert.equal(activeEngine, pendingEngine);
  assert.equal(pendingEngine.destroyCalls, 0);

  controller.clearGracePool();
});

test("MSE grace cache rejects an engine bound to another camera", (t) => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => createNode() };
  t.after(() => {
    globalThis.document = previousDocument;
  });

  const wrongEngine = createMseEngine("camera.two");
  let activeEngine = wrongEngine;
  const controller = createLiveGraceController({
    graceMs: 20000,
    graceMax: 3,
    getShadowRoot: () => createNode(),
    getPendingMountDestroyers: () => [],
    setPendingMountDestroyers: () => {},
    getEngine: () => activeEngine,
    setEngine: (engine) => {
      activeEngine = engine;
    },
    getActiveStreamType: () => "mse",
  });

  controller.cleanupEngine({ preserveLiveEntity: "camera.one" });

  assert.equal(controller.takeGraceMseEntry("camera.one"), null);
  assert.equal(wrongEngine.destroyCalls, 1);
  assert.equal(activeEngine, null);
});

test("MSE grace cache rejects a retained engine whose media pipeline closed", (t) => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => createNode() };
  t.after(() => {
    globalThis.document = previousDocument;
  });

  const unhealthyEngine = createMseEngine("camera.one");
  unhealthyEngine.reusable = false;
  let activeEngine = unhealthyEngine;
  const controller = createLiveGraceController({
    graceMs: 20000,
    graceMax: 3,
    getShadowRoot: () => createNode(),
    getPendingMountDestroyers: () => [],
    setPendingMountDestroyers: () => {},
    getEngine: () => activeEngine,
    setEngine: (engine) => {
      activeEngine = engine;
    },
    getActiveStreamType: () => "mse",
  });

  controller.cleanupEngine({ preserveLiveEntity: "camera.one" });

  assert.equal(controller.takeGraceMseEntry("camera.one"), null);
  assert.equal(unhealthyEngine.destroyCalls, 1);
  assert.equal(activeEngine, null);
});
