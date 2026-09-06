import { test } from "node:test";
import assert from "node:assert/strict";

import { createHaDirectMounter } from "../src/features/live/ha-direct-mounter.js";

function createFakeStreamElement() {
  const listeners = new Map();
  const firstVideo = { tagName: "VIDEO", id: "first-video" };
  let video = firstVideo;
  return {
    tagName: "HA-HLS-PLAYER",
    style: { cssText: "" },
    updateComplete: Promise.resolve(),
    get video() {
      return video;
    },
    set video(nextVideo) {
      video = nextVideo;
    },
    firstVideo,
    hidden: false,
    classList: { contains: () => false },
    shadowRoot: {
      querySelector: (selector) => (selector === "video" ? video : null),
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
    dispatch(type) {
      for (const handler of listeners.get(type) || []) {
        handler({ type, target: this });
      }
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    },
    removeCalled: false,
    remove() {
      this.removeCalled = true;
    },
  };
}

const flushAsyncWork = () => new Promise((resolve) => setImmediate(resolve));

function withFakeDocument(run) {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: (tag) => {
      if (String(tag).toLowerCase() !== "ha-hls-player") {
        throw new Error(`Unexpected tag: ${tag}`);
      }
      return createFakeStreamElement();
    },
  };
  return Promise.resolve()
    .then(() => run())
    .finally(() => {
      globalThis.document = previousDocument;
    });
}

function withImmediateTimeout(run) {
  const previousSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => {
    fn();
    return 0;
  };
  return Promise.resolve()
    .then(() => run())
    .finally(() => {
      globalThis.setTimeout = previousSetTimeout;
    });
}

test("ha direct mounter mounts and schedules follow-up without blocking", async () => {
  await withFakeDocument(async () => {
    await withImmediateTimeout(async () => {
      const slot = {
        innerHTML: "occupied",
        appended: [],
        appendChild(node) {
          this.appended.push(node);
          this.lastChild = node;
        },
      };
      const hass = {
        states: {
          "camera.front": {
            entity_id: "camera.front",
            attributes: {},
          },
        },
      };
      let assignedEngine = null;
      let committedMedia = null;
      const appliedStates = [];
      let waitCalls = 0;
      const mounter = createHaDirectMounter({
        getHass: () => hass,
        getPreferredStreamType: () => "webrtc",
        getStreamMuted: () => true,
        getRotateOverlayActive: () => true,
        isCurrentEngine: (streamEl) => assignedEngine === streamEl,
        waitForStreamStart: async (_streamEl, _waitMs, options) => {
          waitCalls += 1;
          assert.equal(options.onVideoReady, undefined);
          return true;
        },
        assignCommittedEngine: (engine) => {
          assignedEngine = engine;
        },
        onCommittedMediaReady: (engine, video) => {
          committedMedia = { engine, video };
        },
        applyResolvedStreamUiState: (streamState) => {
          appliedStates.push(streamState);
        },
        setLiveNativeControls: () => {},
      });

      const result = await mounter.tryMount(
        slot,
        { streamType: "hls" },
        { entity: "camera.front", commit: true },
      );
      await flushAsyncWork();

      assert.equal(result?.ok, true);
      assert.equal(result?.type, "hls");
      assert.equal(slot.innerHTML, "");
      assert.equal(slot.lastChild, assignedEngine);
      assert.equal(assignedEngine.fitMode, "contain");
      assert.equal(waitCalls, 1);
      assert.deepEqual(committedMedia, {
        engine: assignedEngine,
        video: assignedEngine.firstVideo,
      });
      assert.equal(appliedStates.length >= 1, true);
    });
  });
});

test("ha direct mounter follows the active HLS video and releases its listeners", async () => {
  await withFakeDocument(async () => {
    await withImmediateTimeout(async () => {
      const slot = {
        innerHTML: "",
        appendChild(node) {
          this.lastChild = node;
        },
      };
      const hass = {
        states: {
          "camera.front": {
            entity_id: "camera.front",
            attributes: {},
          },
        },
      };
      let assignedEngine = null;
      const committedVideos = [];
      const mounter = createHaDirectMounter({
        getHass: () => hass,
        getPreferredStreamType: () => "hls",
        getStreamMuted: () => true,
        getRotateOverlayActive: () => false,
        isCurrentEngine: (streamEl) => assignedEngine === streamEl,
        waitForStreamStart: async () => true,
        assignCommittedEngine: (engine) => {
          assignedEngine = engine;
        },
        onCommittedMediaReady: (_engine, video) => {
          committedVideos.push(video);
        },
        applyResolvedStreamUiState: () => {},
        setLiveNativeControls: () => {},
      });

      await mounter.tryMount(slot, null, {
        entity: "camera.front",
        commit: true,
      });
      await flushAsyncWork();

      const stream = assignedEngine;
      const secondVideo = { tagName: "VIDEO", id: "second-video" };
      stream.video = secondVideo;
      stream.dispatch("streams");
      await flushAsyncWork();

      stream.video = stream.firstVideo;
      stream.dispatch("load");
      await flushAsyncWork();

      assert.deepEqual(committedVideos, [
        stream.firstVideo,
        secondVideo,
        stream.firstVideo,
      ]);
      assert.equal(stream.listenerCount("load"), 1);
      assert.equal(stream.listenerCount("streams"), 1);

      mounter.release(stream);
      stream.dispatch("streams");
      await flushAsyncWork();

      assert.equal(stream.listenerCount("load"), 0);
      assert.equal(stream.listenerCount("streams"), 0);
      assert.equal(committedVideos.length, 3);
    });
  });
});

test("ha direct mounter aborts readiness work when its engine is released", async () => {
  await withFakeDocument(async () => {
    const slot = {
      innerHTML: "",
      appendChild(node) {
        this.lastChild = node;
      },
    };
    const hass = {
      states: {
        "camera.front": {
          entity_id: "camera.front",
          attributes: {},
        },
      },
    };
    let assignedEngine = null;
    let waitOptions = null;
    const mounter = createHaDirectMounter({
      getHass: () => hass,
        getPreferredStreamType: () => "hls",
      getStreamMuted: () => true,
      getRotateOverlayActive: () => false,
      isCurrentEngine: (streamEl) => assignedEngine === streamEl,
      waitForStreamStart: async (_streamEl, _waitMs, options) => {
        waitOptions = options;
        await new Promise((resolve) =>
          options.abortSignal.addEventListener("abort", resolve, { once: true }),
        );
        return false;
      },
      assignCommittedEngine: (engine) => {
        assignedEngine = engine;
      },
      onCommittedMediaReady: () => {},
      applyResolvedStreamUiState: () => {},
      setLiveNativeControls: () => {},
    });

    await mounter.tryMount(slot, null, {
      entity: "camera.front",
      commit: true,
    });
    await flushAsyncWork();

    const stream = assignedEngine;
    assert.equal(waitOptions.abortSignal.aborted, false);
    assert.equal(waitOptions.resolveVideo(), stream.firstVideo);

    mounter.release(stream);
    await flushAsyncWork();

    assert.equal(waitOptions.abortSignal.aborted, true);
    assert.equal(stream.listenerCount("load"), 0);
    assert.equal(stream.listenerCount("streams"), 0);
  });
});

test("ha direct mounter applies unavailable state when no camera state exists", async () => {
  const appliedStates = [];
  const mounter = createHaDirectMounter({
    getHass: () => ({ states: {} }),
    getPreferredStreamType: () => "webrtc",
    getStreamMuted: () => false,
    getRotateOverlayActive: () => false,
    isCurrentEngine: () => false,
    waitForStreamStart: async () => true,
    assignCommittedEngine: () => {},
    onCommittedMediaReady: () => {},
    applyResolvedStreamUiState: (streamState) => {
      appliedStates.push(streamState);
    },
    setLiveNativeControls: () => {},
  });

  const result = await mounter.tryMount(
    { innerHTML: "", appendChild() {} },
    null,
    { entity: "camera.front", commit: true },
  );

  assert.equal(result, false);
  assert.deepEqual(appliedStates, [
    {
      loading: false,
      fallbackVisible: false,
      refreshFallbackImage: false,
    },
  ]);
});

test("ha direct mounter replaces WebRTC with HLS when no video frame starts", async () => {
  const previousDocument = globalThis.document;
  const previousMediaStream = globalThis.MediaStream;
  const previousPeerConnection = globalThis.RTCPeerConnection;
  let assignedEngine = null;
  let unsubscribeCalls = 0;
  let subscriptionCalls = 0;
  const committedTypes = [];
  const readinessTargets = [];

  class FakePeerConnection {
    constructor() {
      this.connectionState = "new";
      this.iceConnectionState = "new";
    }

    addTransceiver() {
      return { stop() {} };
    }

    getTransceivers() {
      return [];
    }

    async createOffer() {
      return { type: "offer", sdp: "ha-direct-offer" };
    }

    async setLocalDescription() {
      this.ontrack?.({
        track: { kind: "video", stop() {} },
        streams: [],
      });
    }

    close() {}
  }

  globalThis.document = {
    createElement(tag) {
      if (tag === "video") {
        return {
          tagName: "VIDEO",
          style: {},
          dataset: {},
          classList: { add() {} },
          setAttribute() {},
          removeAttribute() {},
          play: () => Promise.resolve(),
          pause() {},
        };
      }
      if (tag === "ha-hls-player") return createFakeStreamElement();
      throw new Error(`Unexpected tag: ${tag}`);
    },
  };
  globalThis.MediaStream = class {
    addTrack() {}
    getTracks() {
      return [];
    }
  };
  globalThis.RTCPeerConnection = FakePeerConnection;

  const hass = {
    states: {
      "camera.front": { entity_id: "camera.front", attributes: {} },
    },
    callWS: async () => ({ configuration: { iceServers: [] } }),
    connection: {
      subscribeMessage(callback, _message, options) {
        subscriptionCalls += 1;
        assert.deepEqual(options, { resubscribe: false });
        queueMicrotask(() =>
          callback({ type: "answer", answer: "ha-direct-answer" }),
        );
        return Promise.resolve(() => {
          unsubscribeCalls += 1;
        });
      },
    },
  };
  const slot = {
    innerHTML: "",
    appendChild(node) {
      this.lastChild = node;
    },
  };
  const mounter = createHaDirectMounter({
    getHass: () => hass,
    getPreferredStreamType: () => "webrtc",
    getStreamMuted: () => true,
    getRotateOverlayActive: () => false,
    isCurrentEngine: (engine) => assignedEngine === engine,
    waitForStreamStart: async (engine) => {
      readinessTargets.push(engine?.tagName || engine?.streamType || "");
      return engine?.tagName === "HA-HLS-PLAYER";
    },
    assignCommittedEngine: (engine) => {
      assignedEngine = engine;
    },
    onCommittedMediaReady: () => {},
    onCommittedStream: (type) => committedTypes.push(type),
    applyResolvedStreamUiState: () => {},
    setLiveNativeControls: () => {},
    scheduleResumeLive: () => {},
  });

  try {
    const result = await mounter.tryMount(slot, null, {
      entity: "camera.front",
      commit: true,
    });
    await flushAsyncWork();
    await flushAsyncWork();

    assert.equal(result.type, "webrtc");
    assert.equal(subscriptionCalls, 1);
    assert.equal(unsubscribeCalls, 1);
    assert.equal(assignedEngine.tagName, "HA-HLS-PLAYER");
    assert.equal(assignedEngine.removeCalled, false);
    assert.deepEqual(committedTypes, ["hls"]);
    assert.equal(readinessTargets.includes("webrtc"), true);
    assert.equal(readinessTargets.includes("HA-HLS-PLAYER"), true);
  } finally {
    mounter.release(assignedEngine);
    globalThis.document = previousDocument;
    globalThis.MediaStream = previousMediaStream;
    globalThis.RTCPeerConnection = previousPeerConnection;
  }
});

test("ha direct mounter serializes WebRTC teardown before the next offer", async () => {
  const previousDocument = globalThis.document;
  const previousMediaStream = globalThis.MediaStream;
  const previousPeerConnection = globalThis.RTCPeerConnection;
  let assignedEngine = null;
  let resolveFirstUnsubscribe = null;
  const subscriptionCalls = [];
  const hlsPlayers = [];

  class FakePeerConnection {
    constructor() {
      this.connectionState = "new";
      this.iceConnectionState = "new";
    }

    addTransceiver() {
      return { stop() {} };
    }

    getTransceivers() {
      return [];
    }

    async createOffer() {
      return { type: "offer", sdp: "ha-direct-offer" };
    }

    async setLocalDescription() {
      this.ontrack?.({
        track: { kind: "video", stop() {} },
        streams: [],
      });
    }

    async setRemoteDescription() {}

    close() {}
  }

  globalThis.document = {
    createElement(tag) {
      if (tag === "video") {
        return {
          tagName: "VIDEO",
          style: {},
          dataset: {},
          classList: { add() {} },
          setAttribute() {},
          removeAttribute() {},
          play: () => Promise.resolve(),
          pause() {},
        };
      }
      if (tag === "ha-hls-player") {
        const player = createFakeStreamElement();
        hlsPlayers.push(player);
        return player;
      }
      throw new Error(`Unexpected tag: ${tag}`);
    },
  };
  globalThis.MediaStream = class {
    addTrack() {}
    getTracks() {
      return [];
    }
  };
  globalThis.RTCPeerConnection = FakePeerConnection;

  const hass = {
    states: {
      "camera.front": { entity_id: "camera.front", attributes: {} },
      "camera.back": { entity_id: "camera.back", attributes: {} },
    },
    callWS: async () => ({ configuration: { iceServers: [] } }),
    connection: {
      subscribeMessage(callback, message, options) {
        const callIndex = subscriptionCalls.length;
        subscriptionCalls.push({ callback, message, options });
        queueMicrotask(() =>
          callback({ type: "answer", answer: `answer-${callIndex}` }),
        );
        return Promise.resolve(() => {
          if (callIndex !== 0) return Promise.resolve();
          return new Promise((resolve) => {
            resolveFirstUnsubscribe = resolve;
          });
        });
      },
    },
  };
  const slot = {
    innerHTML: "",
    appendChild(node) {
      this.lastChild = node;
    },
  };
  const mounter = createHaDirectMounter({
    getHass: () => hass,
    getPreferredStreamType: () => "webrtc",
    getStreamMuted: () => true,
    getRotateOverlayActive: () => false,
    isCurrentEngine: (engine) => assignedEngine === engine,
    waitForStreamStart: async (engine) =>
      engine?.tagName !== "HA-HLS-PLAYER",
    assignCommittedEngine: (engine) => {
      assignedEngine = engine;
    },
    onCommittedMediaReady: () => {},
    onCommittedStream: () => {},
    applyResolvedStreamUiState: () => {},
    setLiveNativeControls: () => {},
    scheduleResumeLive: () => {},
  });

  try {
    await mounter.tryMount(slot, null, {
      entity: "camera.front",
      commit: true,
    });
    await flushAsyncWork();
    await flushAsyncWork();
    assert.equal(subscriptionCalls.length, 1);
    assert.equal(hlsPlayers[0].removeCalled, true);

    mounter.release(assignedEngine);
    await mounter.tryMount(slot, null, {
      entity: "camera.back",
      commit: true,
    });
    await flushAsyncWork();
    assert.equal(subscriptionCalls.length, 1);

    resolveFirstUnsubscribe();
    await flushAsyncWork();
    await flushAsyncWork();

    assert.equal(subscriptionCalls.length, 2);
    assert.equal(subscriptionCalls[1].message.entity_id, "camera.back");
  } finally {
    mounter.release(assignedEngine);
    globalThis.document = previousDocument;
    globalThis.MediaStream = previousMediaStream;
    globalThis.RTCPeerConnection = previousPeerConnection;
  }
});
