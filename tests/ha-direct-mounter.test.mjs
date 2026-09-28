import { test } from "node:test";
import assert from "node:assert/strict";

import { createHaDirectMounter } from "../src/features/live/ha-direct-mounter.js";
import { createLiveGraceController } from "../src/features/live/live-grace-controller.js";

const flushAsyncWork = () => new Promise((resolve) => setImmediate(resolve));

const createFakeVideo = () => ({
  tagName: "VIDEO",
  paused: false,
  ended: false,
  seeking: false,
  readyState: 4,
  videoWidth: 1920,
  currentTime: 1,
  muted: true,
  defaultMuted: true,
  controls: false,
  style: { cssText: "" },
  dataset: {},
  classList: { add() {} },
  setAttribute() {},
  removeAttribute() {},
  play: () => Promise.resolve(),
});

const createFakeHaCameraStream = () => {
  const listeners = new Map();
  const video = createFakeVideo();
  const player = {
    tagName: "HA-HLS-PLAYER",
    hidden: false,
    classList: { contains: () => false },
    shadowRoot: { querySelector: () => video },
    querySelector: () => null,
  };
  return {
    tagName: "HA-CAMERA-STREAM",
    style: { cssText: "" },
    updateComplete: Promise.resolve(),
    isConnected: true,
    shadowRoot: {
      querySelectorAll: () => [player],
    },
    querySelector: () => null,
    addEventListener(type, handler) {
      const handlers = listeners.get(type) || new Set();
      handlers.add(handler);
      listeners.set(type, handlers);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    dispatch(type, detail) {
      for (const handler of listeners.get(type) || []) {
        handler({ type, target: this, detail });
      }
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    },
    testVideo: video,
  };
};

const withFakeDocument = async (run) => {
  const previousDocument = globalThis.document;
  const streams = [];
  globalThis.document = {
    createElement(tag) {
      if (tag === "ha-camera-stream") {
        const stream = createFakeHaCameraStream();
        streams.push(stream);
        return stream;
      }
      if (tag === "div") {
        return {
          isConnected: true,
          style: { cssText: "" },
          children: [],
          setAttribute() {},
          appendChild(child) {
            this.children.push(child);
            child.parentElement = this;
            return child;
          },
          remove() {
            this.isConnected = false;
          },
        };
      }
      throw new Error(`Unexpected tag: ${tag}`);
    },
  };
  try {
    await run({ streams });
  } finally {
    globalThis.document = previousDocument;
  }
};

const createSlot = () => ({
  innerHTML: "occupied",
  children: [],
  appendChild(node) {
    this.children = [node];
    this.lastChild = node;
    node.parentElement = this;
    return node;
  },
});

const createMounterHarness = ({ waitForStreamStart } = {}) => {
  const stateObj = { entity_id: "camera.front", attributes: {} };
  const hass = { states: { "camera.front": stateObj } };
  const states = [];
  const streamTypes = [];
  const committedMedia = [];
  let assignedEngine = null;
  const mounter = createHaDirectMounter({
    getHass: () => hass,
    getPreferredStreamType: () => "webrtc",
    getStreamMuted: () => true,
    getRotateOverlayActive: () => false,
    isCurrentEngine: (engine) => assignedEngine === engine,
    waitForStreamStart:
      waitForStreamStart ||
      (async (_engine, _waitMs, options) => {
        options.onVideoReady?.(options.resolveVideo());
        return true;
      }),
    assignCommittedEngine: (engine) => {
      assignedEngine = engine;
    },
    onCommittedMediaReady: (engine, video) => {
      committedMedia.push({ engine, video });
    },
    onCommittedStream: (type) => streamTypes.push(type),
    applyResolvedStreamUiState: (state) => states.push(state),
    setLiveNativeControls: () => {},
  });
  return {
    committedMedia,
    get assignedEngine() {
      return assignedEngine;
    },
    hass,
    mounter,
    stateObj,
    states,
    streamTypes,
  };
};

test("HA Direct mounts Home Assistant's native camera manager", async () => {
  await withFakeDocument(async ({ streams }) => {
    const harness = createMounterHarness();
    const slot = createSlot();
    const result = await harness.mounter.tryMount(
      slot,
      { streamType: "webrtc" },
      { entity: "camera.front", commit: true },
    );
    await flushAsyncWork();

    assert.equal(result.ok, true);
    assert.equal(streams.length, 1);
    assert.equal(slot.lastChild, harness.assignedEngine);
    assert.equal(harness.assignedEngine.tagName, "HA-CAMERA-STREAM");
    assert.equal(harness.assignedEngine.stateObj, harness.stateObj);
    assert.equal(harness.assignedEngine.hass, harness.hass);
    assert.equal(harness.assignedEngine.allowExoPlayer, true);
    assert.equal(harness.assignedEngine.fitMode, "contain");
    assert.equal(harness.assignedEngine.muted, true);
    assert.equal(harness.streamTypes.at(-1), "hls");
    assert.equal(harness.states.at(-1).loading, false);
    assert.equal(
      harness.committedMedia.at(-1).video,
      harness.assignedEngine.testVideo,
    );
  });
});

test("HA Direct readiness observes HA media without initiating a child transport", async () => {
  await withFakeDocument(async () => {
    let waitOptions = null;
    const harness = createMounterHarness({
      waitForStreamStart: async (_engine, _waitMs, options) => {
        waitOptions = options;
        return await new Promise((resolve) =>
          options.abortSignal.addEventListener(
            "abort",
            () => resolve(false),
            { once: true },
          ),
        );
      },
    });
    await harness.mounter.tryMount(createSlot(), null, {
      entity: "camera.front",
      commit: true,
    });
    await flushAsyncWork();

    assert.equal(waitOptions.resolveVideo(), harness.assignedEngine.testVideo);
    assert.equal(harness.assignedEngine.listenerCount("load"), 1);
    assert.equal(harness.assignedEngine.listenerCount("streams"), 1);

    harness.mounter.release(harness.assignedEngine);
    await flushAsyncWork();

    assert.equal(waitOptions.abortSignal.aborted, true);
    assert.equal(harness.assignedEngine.listenerCount("load"), 0);
    assert.equal(harness.assignedEngine.listenerCount("streams"), 0);
  });
});

test("HA Direct reports unavailable without constructing a camera manager", async () => {
  await withFakeDocument(async ({ streams }) => {
    const appliedStates = [];
    const mounter = createHaDirectMounter({
      getHass: () => ({ states: {} }),
      getPreferredStreamType: () => "webrtc",
      getStreamMuted: () => true,
      getRotateOverlayActive: () => false,
      isCurrentEngine: () => false,
      waitForStreamStart: async () => false,
      assignCommittedEngine: () => {},
      applyResolvedStreamUiState: (state) => appliedStates.push(state),
      setLiveNativeControls: () => {},
    });
    const result = await mounter.tryMount(createSlot(), null, {
      entity: "camera.front",
      commit: true,
    });

    assert.equal(result, false);
    assert.equal(streams.length, 0);
    assert.deepEqual(appliedStates, [
      {
        loading: false,
        fallbackVisible: false,
        refreshFallbackImage: false,
      },
    ]);
  });
});

test("HA Direct handoff retains and rebinds the complete HA camera manager", async () => {
  await withFakeDocument(async () => {
    const harness = createMounterHarness();
    await harness.mounter.tryMount(createSlot(), null, {
      entity: "camera.front",
      commit: true,
    });
    await flushAsyncWork();
    const engine = harness.assignedEngine;

    assert.equal(harness.mounter.detachWebRtcForHandoff(engine), true);
    assert.equal(engine.listenerCount("load"), 0);
    engine.muted = false;
    engine.style.cssText = "offscreen";
    assert.equal(harness.mounter.adoptRetainedWebRtcEngine(engine), true);
    assert.equal(engine.listenerCount("load"), 1);
    assert.equal(engine.muted, true);
    assert.match(engine.style.cssText, /width:100%/);
  });
});

test("HA Direct grace moves and restores the complete HA camera manager", async () => {
  await withFakeDocument(async () => {
    const engine = createFakeHaCameraStream();
    engine.type = "ha_direct";
    engine.streamType = "hls";
    let currentEngine = engine;
    let activeType = "hls";
    const shadowRoot = {
      children: [],
      appendChild(child) {
        this.children.push(child);
        child.parentElement = this;
        return child;
      },
    };
    const controller = createLiveGraceController({
      graceMs: 20_000,
      graceMax: 2,
      getShadowRoot: () => shadowRoot,
      getScopeKey: () => null,
      getPendingMountDestroyers: () => [],
      setPendingMountDestroyers: () => {},
      getPendingWebRtcTakeoverTimer: () => null,
      setPendingWebRtcTakeoverTimer: () => {},
      clearRotateOverlayAudioSync: () => {},
      clearRotateVideoFullscreenStyle: () => {},
      getEngine: () => currentEngine,
      setEngine: (nextEngine) => {
        currentEngine = nextEngine;
      },
      getActiveStreamType: () => activeType,
      getStreamMuted: () => false,
      setEngineMountedMuted: () => {},
      getRotateOverlayActive: () => false,
      attachVideoFit: () => {},
      setActiveStreamType: (type) => {
        activeType = type;
      },
      setStreamLoading: () => {},
      setStreamFallbackVisible: () => {},
      setLiveNativeControls: () => {},
      releaseHaDirectEngine: () => {},
      adoptHaDirectWebRtcEngine: (retainedEngine) => {
        retainedEngine.style.cssText = "width:100%;height:100%";
        return true;
      },
      scheduleResumeLive: () => {},
      resetMseDiagnostics: () => {},
      markMseChunk: () => {},
    });

    controller.cleanupEngine({ preserveLiveEntity: "camera.front" });
    assert.equal(currentEngine, null);
    assert.equal(shadowRoot.children[0].children[0], engine);
    assert.match(shadowRoot.children[0].style.cssText, /width:100%/);
    assert.doesNotMatch(shadowRoot.children[0].style.cssText, /1px/);
    assert.match(engine.style.cssText, /width:100%/);

    const entry = controller.takeGraceHaDirectEntry("camera.front", "hls");
    assert.equal(entry.engine, engine);
    const slot = createSlot();
    assert.equal(controller.adoptGraceHaDirectEngine(slot, engine), true);
    assert.equal(slot.lastChild, engine);
    assert.equal(currentEngine, engine);
    assert.equal(engine.muted, false);
    assert.match(engine.style.cssText, /width:100%/);

    controller.clearGracePool();
  });
});
