import { test } from "node:test";
import assert from "node:assert/strict";

import { createHaDirectMounter } from "../src/features/live/ha-direct-mounter.js";

const flushAsyncWork = () => new Promise((resolve) => setImmediate(resolve));

const createEventTarget = () => {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      const handlers = listeners.get(type) || new Set();
      handlers.add(handler);
      listeners.set(type, handlers);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    dispatch(type, detail = undefined) {
      for (const handler of [...(listeners.get(type) || [])]) {
        handler({ type, detail, target: this });
      }
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    },
  };
};

const createVideo = () => ({
  tagName: "VIDEO",
  muted: true,
  defaultMuted: true,
  volume: 1,
  readyState: 0,
  playCalls: 0,
  ...createEventTarget(),
  play() {
    this.playCalls += 1;
    return Promise.resolve();
  },
});

const createPlayer = (tagName = "HA-HLS-PLAYER") => {
  const video = createVideo();
  return {
    tagName,
    hidden: false,
    muted: true,
    defaultMuted: true,
    classList: { contains: () => false },
    shadowRoot: {
      querySelector: (selector) => (selector === "video" ? video : null),
    },
    querySelector: () => null,
    video,
  };
};

const createNode = (tagName) => {
  const node = {
    tagName: tagName.toUpperCase(),
    style: { cssText: "" },
    children: [],
    parentElement: null,
    isConnected: false,
    attributes: new Map(),
    ...createEventTarget(),
    appendChild(child) {
      if (child.parentElement) {
        child.parentElement.children = child.parentElement.children.filter(
          (candidate) => candidate !== child,
        );
      }
      this.children.push(child);
      child.parentElement = this;
      child.isConnected = this.isConnected;
      return child;
    },
    remove() {
      if (this.parentElement) {
        this.parentElement.children = this.parentElement.children.filter(
          (candidate) => candidate !== this,
        );
      }
      this.parentElement = null;
      this.isConnected = false;
    },
    setAttribute(name, value = "") {
      this.attributes.set(name, value);
    },
    toggleAttribute(name, force) {
      if (force) this.attributes.set(name, "");
      else this.attributes.delete(name);
    },
  };
  return node;
};

const createCameraStream = () => {
  const stream = createNode("ha-camera-stream");
  const player = createPlayer();
  stream.player = player;
  stream.updateComplete = Promise.resolve();
  stream.shadowRoot = {
    querySelectorAll: () => [stream.player],
  };
  return stream;
};

const createSlot = () => {
  const slot = createNode("div");
  slot.isConnected = true;
  Object.defineProperty(slot, "innerHTML", {
    configurable: true,
    get: () => "",
    set: () => {
      for (const child of slot.children) {
        child.parentElement = null;
        child.isConnected = false;
      }
      slot.children = [];
    },
  });
  return slot;
};

const withFakeDocument = async (run) => {
  const previousDocument = globalThis.document;
  const streams = [];
  globalThis.document = {
    createElement(tagName) {
      if (tagName === "ha-camera-stream") {
        const stream = createCameraStream();
        streams.push(stream);
        return stream;
      }
      return createNode(tagName);
    },
  };
  try {
    await run({ streams });
  } finally {
    globalThis.document = previousDocument;
  }
};

const createHarness = ({ hassOverride } = {}) => {
  const hass =
    hassOverride ||
    {
      states: {
        "camera.front": {
          entity_id: "camera.front",
          state: "streaming",
          attributes: { frontend_stream_type: "hls" },
        },
        "camera.back": {
          entity_id: "camera.back",
          state: "streaming",
          attributes: { frontend_stream_type: "hls" },
        },
      },
    };
  const readyTypes = [];
  const readyMedia = [];
  const resolvedStates = [];
  let currentEngine = null;
  let muted = true;
  let prepareCalls = 0;
  const mounter = createHaDirectMounter({
    getHass: () => hass,
    getStreamMuted: () => muted,
    getRotateOverlayActive: () => false,
    isCurrentEngine: (engine) => currentEngine === engine,
    assignCommittedEngine: (engine) => {
      currentEngine = engine;
    },
    onCommittedMediaReady: (engine, video) => {
      readyMedia.push({ engine, video });
    },
    onCommittedStream: (type) => readyTypes.push(type),
    applyResolvedStreamUiState: (state) => resolvedStates.push(state),
    setLiveNativeControls: () => {},
    preparePlaybackElements: () => {
      prepareCalls += 1;
      return true;
    },
  });
  return {
    hass,
    mounter,
    readyTypes,
    readyMedia,
    resolvedStates,
    get currentEngine() {
      return currentEngine;
    },
    set currentEngine(engine) {
      currentEngine = engine;
    },
    set muted(value) {
      muted = value;
    },
    get prepareCalls() {
      return prepareCalls;
    },
  };
};

test("HA Direct mounts Home Assistant's native camera-stream pipeline", async () => {
  await withFakeDocument(async ({ streams }) => {
    const harness = createHarness();
    const slot = createSlot();
    const result = await harness.mounter.tryMount(
      slot,
      { streamType: "webrtc" },
      { entity: "camera.front", commit: true },
    );
    await flushAsyncWork();

    assert.equal(result.ok, true);
    assert.equal(result.engine.fvcManagedHaDirect, true);
    assert.equal(result.engine.type, "ha_direct");
    assert.equal(slot.children[0], result.engine);
    assert.equal(streams.length, 1);
    assert.equal(streams[0].stateObj, harness.hass.states["camera.front"]);
    assert.equal(streams[0].hass, harness.hass);
    assert.equal(streams[0].muted, true);
    assert.equal(harness.prepareCalls, 1);
    assert.equal(harness.readyTypes.length, 0);
  });
});

test("HA Direct becomes ready on the visible player's loadeddata", async () => {
  await withFakeDocument(async ({ streams }) => {
    const harness = createHarness();
    const result = await harness.mounter.tryMount(
      createSlot(),
      null,
      { entity: "camera.front", commit: true },
    );
    await flushAsyncWork();

    streams[0].player.video.readyState = 2;
    streams[0].player.video.dispatch("loadeddata");

    assert.deepEqual(harness.readyTypes, ["hls"]);
    assert.equal(harness.readyMedia.at(-1).engine, result.engine);
    assert.equal(harness.readyMedia.at(-1).video, streams[0].player.video);
    assert.equal(harness.resolvedStates.at(-1).fallbackVisible, false);
  });
});

test("HA Direct retains visited camera providers and reuses them on return", async () => {
  await withFakeDocument(async ({ streams }) => {
    const harness = createHarness();
    const slot = createSlot();
    const first = await harness.mounter.tryMount(slot, null, {
      entity: "camera.front",
      commit: true,
    });
    await harness.mounter.tryMount(slot, null, {
      entity: "camera.back",
      commit: true,
    });

    assert.equal(streams.length, 2);
    assert.equal(first.engine.children.length, 2);
    assert.match(streams[0].style.cssText, /translateX\(-200%\)/);
    assert.match(streams[1].style.cssText, /translateX\(0\)/);
    assert.equal(harness.mounter.hasRetainedMount(slot), true);

    await harness.mounter.tryMount(slot, null, {
      entity: "camera.front",
      commit: true,
    });
    assert.equal(streams.length, 2);
    assert.match(streams[0].style.cssText, /translateX\(0\)/);
    assert.match(streams[1].style.cssText, /translateX\(-200%\)/);
  });
});

test("HA Direct keeps transport selection latched after the first unmute", async () => {
  await withFakeDocument(async ({ streams }) => {
    const harness = createHarness();
    const result = await harness.mounter.tryMount(createSlot(), null, {
      entity: "camera.front",
      commit: true,
    });
    await flushAsyncWork();

    result.engine.setOutputMuted(false);
    await flushAsyncWork();
    assert.equal(streams[0].muted, false);
    assert.equal(streams[0].player.video.muted, false);

    result.engine.setOutputMuted(true);
    await flushAsyncWork();
    assert.equal(streams[0].muted, false);
    assert.equal(streams[0].player.video.muted, true);
  });
});

test("HA Direct release tears down retained providers and permits a fresh deck", async () => {
  await withFakeDocument(async ({ streams }) => {
    const harness = createHarness();
    const slot = createSlot();
    const first = await harness.mounter.tryMount(slot, null, {
      entity: "camera.front",
      commit: true,
    });
    harness.mounter.release(first.engine);

    assert.equal(first.engine.parentElement, null);
    assert.equal(harness.mounter.hasRetainedMount(slot), false);
    const second = await harness.mounter.tryMount(slot, null, {
      entity: "camera.front",
      commit: true,
    });
    assert.notEqual(second.engine, first.engine);
    assert.equal(streams.length, 2);
  });
});

test("HA Direct reports unavailable camera entities without mounting", async () => {
  await withFakeDocument(async () => {
    const harness = createHarness({ hassOverride: { states: {} } });
    const result = await harness.mounter.tryMount(createSlot(), null, {
      entity: "camera.missing",
      commit: true,
    });

    assert.equal(result, false);
    assert.equal(harness.currentEngine, null);
    assert.equal(harness.resolvedStates.at(-1).fallbackVisible, false);
  });
});
