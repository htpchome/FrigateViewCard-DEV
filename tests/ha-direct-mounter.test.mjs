import { test } from "node:test";
import assert from "node:assert/strict";

import { createHaDirectMounter } from "../src/features/live/ha-direct-mounter.js";

const flushAsyncWork = () => new Promise((resolve) => setImmediate(resolve));

const createFakeVideo = (id) => {
  const listeners = new Map();
  return {
    id,
    tagName: "VIDEO",
    muted: true,
    defaultMuted: true,
    volume: 0,
    paused: false,
    ended: false,
    seeking: false,
    readyState: 4,
    currentTime: 1,
    videoWidth: 1920,
    playCalls: 0,
    play() {
      this.playCalls += 1;
      return Promise.resolve();
    },
    addEventListener(type, handler) {
      const handlers = listeners.get(type) || new Set();
      handlers.add(handler);
      listeners.set(type, handlers);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    dispatch(type) {
      for (const handler of [...(listeners.get(type) || [])]) {
        handler({ type, target: this });
      }
    },
  };
};

const createFakePlayer = (type, video, activeTypeRef) => ({
  tagName: type === "webrtc" ? "HA-WEB-RTC-PLAYER" : "HA-HLS-PLAYER",
  hidden: false,
  classList: {
    contains: (name) => name === "hidden" && activeTypeRef.value !== type,
  },
  shadowRoot: {
    querySelector: (selector) => (selector === "video" ? video : null),
  },
  querySelector: () => null,
});

const createFakeCameraStream = () => {
  const listeners = new Map();
  const activeTypeRef = { value: "hls" };
  const hlsVideo = createFakeVideo("hls-video");
  const webRtcVideo = createFakeVideo("webrtc-video");
  const players = [
    createFakePlayer("hls", hlsVideo, activeTypeRef),
    createFakePlayer("webrtc", webRtcVideo, activeTypeRef),
  ];
  return {
    tagName: "HA-CAMERA-STREAM",
    style: { cssText: "" },
    updateComplete: Promise.resolve(),
    isConnected: true,
    stateObj: null,
    hlsVideo,
    webRtcVideo,
    shadowRoot: {
      querySelectorAll: (selector) =>
        selector === "ha-web-rtc-player,ha-hls-player" ? players : [],
    },
    setActive(type) {
      activeTypeRef.value = type;
    },
    addEventListener(type, handler) {
      const handlers = listeners.get(type) || new Set();
      handlers.add(handler);
      listeners.set(type, handlers);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    dispatch(type, detail = {}) {
      for (const handler of [...(listeners.get(type) || [])]) {
        handler({ type, target: this, detail });
      }
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    },
    remove() {
      this.isConnected = false;
      this.parentElement = null;
    },
  };
};

const withFakeDocument = async (run) => {
  const previousDocument = globalThis.document;
  const streams = [];
  globalThis.document = {
    createElement: (tag) => {
      assert.equal(tag, "ha-camera-stream");
      const stream = createFakeCameraStream();
      streams.push(stream);
      return stream;
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

const createHarness = ({ waitForStreamStart } = {}) => {
  const hass = {
    states: {
      "camera.front": { entity_id: "camera.front", attributes: {} },
      "camera.back": { entity_id: "camera.back", attributes: {} },
    },
  };
  let currentEngine = null;
  const committedStreams = [];
  const committedMedia = [];
  const uiStates = [];
  const waits = [];
  const mounter = createHaDirectMounter({
    getHass: () => hass,
    getPreferredStreamType: () => "webrtc",
    getStreamMuted: () => true,
    getRotateOverlayActive: () => false,
    getCurrentEngine: () => currentEngine,
    isCurrentEngine: (engine) => currentEngine === engine,
    waitForStreamStart: async (engine, waitMs, options) => {
      waits.push({ engine, waitMs, options });
      if (waitForStreamStart) {
        return waitForStreamStart(engine, waitMs, options, waits.length);
      }
      options.onVideoReady?.(options.resolveVideo());
      return true;
    },
    assignCommittedEngine: (engine) => {
      currentEngine = engine;
    },
    onCommittedMediaReady: (engine, video) => {
      committedMedia.push({ engine, video });
    },
    onCommittedStream: (type) => committedStreams.push(type),
    applyResolvedStreamUiState: (state) => uiStates.push(state),
    setLiveNativeControls: () => {},
  });
  return {
    committedMedia,
    committedStreams,
    getCurrentEngine: () => currentEngine,
    hass,
    mounter,
    setCurrentEngine: (engine) => {
      currentEngine = engine;
    },
    uiStates,
    waits,
  };
};

test("HA Direct mounts one native camera manager and commits its visible HLS frame", async () => {
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
    assert.equal(result.type, "hls");
    assert.equal(streams.length, 1);
    assert.equal(slot.lastChild, streams[0]);
    assert.equal(streams[0].stateObj, harness.hass.states["camera.front"]);
    assert.equal(streams[0].fitMode, "contain");
    assert.equal(streams[0].muted, true);
    assert.equal(harness.waits.length, 1);
    assert.equal(harness.waits[0].options.requirePresentedFrame, true);
    assert.deepEqual(harness.committedStreams, ["hls"]);
    assert.equal(harness.committedMedia.at(-1).video, streams[0].hlsVideo);
  });
});

test("HA Direct retargets the connected manager instead of creating or caching another", async () => {
  await withFakeDocument(async ({ streams }) => {
    const harness = createHarness();
    const slot = createSlot();
    await harness.mounter.tryMount(slot, null, {
      entity: "camera.front",
      commit: true,
    });
    await flushAsyncWork();
    const manager = harness.getCurrentEngine();

    assert.equal(harness.mounter.canRetarget(manager, "camera.back"), true);
    const result = await harness.mounter.tryMount(slot, null, {
      entity: "camera.back",
      commit: true,
    });
    await flushAsyncWork();

    assert.equal(result.engine, manager);
    assert.equal(streams.length, 1);
    assert.equal(slot.lastChild, manager);
    assert.equal(manager.stateObj, harness.hass.states["camera.back"]);
    assert.equal(harness.waits.length, 2);
    assert.equal(harness.mounter.canRetarget(manager, "camera.back"), false);
  });
});

test("HA Direct follows native HLS to WebRTC promotion without replacing its manager", async () => {
  await withFakeDocument(async ({ streams }) => {
    const harness = createHarness();
    const slot = createSlot();
    await harness.mounter.tryMount(slot, null, {
      entity: "camera.front",
      commit: true,
    });
    await flushAsyncWork();
    const manager = streams[0];

    manager.setActive("webrtc");
    manager.dispatch("streams", { hasVideo: true });
    await flushAsyncWork();

    assert.equal(streams.length, 1);
    assert.equal(slot.lastChild, manager);
    assert.equal(harness.waits.length, 2);
    assert.deepEqual(harness.committedStreams, ["hls", "webrtc"]);
    assert.equal(harness.committedMedia.at(-1).video, manager.webRtcVideo);
  });
});

test("HA Direct keeps transport selection unmuted after output is muted again", async () => {
  await withFakeDocument(async ({ streams }) => {
    const harness = createHarness();
    await harness.mounter.tryMount(createSlot(), null, {
      entity: "camera.front",
      commit: true,
    });
    await flushAsyncWork();
    const manager = streams[0];

    manager.setOutputMuted(false);
    await flushAsyncWork();
    assert.equal(manager.muted, false);
    assert.equal(manager.hlsVideo.muted, false);
    assert.equal(manager.webRtcVideo.muted, false);

    manager.setOutputMuted(true);
    await flushAsyncWork();
    assert.equal(manager.muted, false);
    assert.equal(manager.hlsVideo.muted, true);
    assert.equal(manager.webRtcVideo.muted, true);
  });
});

test("HA Direct camera retarget resets selection and output mute for the new camera", async () => {
  await withFakeDocument(async ({ streams }) => {
    const harness = createHarness();
    const slot = createSlot();
    await harness.mounter.tryMount(slot, null, {
      entity: "camera.front",
      commit: true,
    });
    await flushAsyncWork();
    const manager = streams[0];
    manager.setOutputMuted(false);
    await flushAsyncWork();

    await harness.mounter.tryMount(slot, null, {
      entity: "camera.back",
      commit: true,
    });
    await flushAsyncWork();

    assert.equal(manager.muted, true);
    assert.equal(manager.hlsVideo.muted, true);
    assert.equal(manager.webRtcVideo.muted, true);
  });
});

test("HA Direct preserves the snapshot on timeout and clears it after recovery", async () => {
  await withFakeDocument(async ({ streams }) => {
    const harness = createHarness({
      waitForStreamStart: async () => false,
    });
    await harness.mounter.tryMount(createSlot(), null, {
      entity: "camera.front",
      commit: true,
    });
    streams[0].hlsVideo.readyState = 0;
    streams[0].hlsVideo.videoWidth = 0;
    await flushAsyncWork();

    assert.equal(harness.committedStreams.at(-1), "snapshot");
    streams[0].hlsVideo.readyState = 4;
    streams[0].hlsVideo.videoWidth = 1920;
    streams[0].hlsVideo.dispatch("playing");
    await flushAsyncWork();

    assert.equal(harness.committedStreams.at(-1), "hls");
  });
});

test("HA Direct release aborts readiness and removes manager listeners", async () => {
  await withFakeDocument(async ({ streams }) => {
    let waitOptions = null;
    const harness = createHarness({
      waitForStreamStart: async (_engine, _waitMs, options) => {
        waitOptions = options;
        await new Promise((resolve) =>
          options.abortSignal.addEventListener("abort", resolve, { once: true }),
        );
        return false;
      },
    });
    await harness.mounter.tryMount(createSlot(), null, {
      entity: "camera.front",
      commit: true,
    });
    await flushAsyncWork();

    assert.equal(streams[0].listenerCount("load"), 1);
    assert.equal(streams[0].listenerCount("streams"), 1);
    harness.mounter.release(streams[0]);
    await flushAsyncWork();

    assert.equal(waitOptions.abortSignal.aborted, true);
    assert.equal(streams[0].listenerCount("load"), 0);
    assert.equal(streams[0].listenerCount("streams"), 0);
    assert.equal(streams[0].setOutputMuted, null);
  });
});

test("HA Direct reports unavailable camera state without creating a manager", async () => {
  await withFakeDocument(async ({ streams }) => {
    const harness = createHarness();
    const result = await harness.mounter.tryMount(createSlot(), null, {
      entity: "camera.missing",
      commit: true,
    });

    assert.equal(result, false);
    assert.equal(streams.length, 0);
    assert.equal(harness.uiStates.at(-1).fallbackVisible, false);
    assert.equal(harness.uiStates.at(-1).loading, false);
  });
});
