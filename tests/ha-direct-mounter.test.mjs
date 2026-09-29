import { test } from "node:test";
import assert from "node:assert/strict";

import { createHaDirectMounter } from "../src/features/live/ha-direct-mounter.js";

const flushAsyncWork = () => new Promise((resolve) => setImmediate(resolve));

const deferred = () => {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const createFakeVideo = (id) => ({
  tagName: "VIDEO",
  id,
  style: { cssText: "" },
  muted: true,
  defaultMuted: true,
  readyState: 4,
  videoWidth: 1920,
  currentTime: 1,
  paused: false,
  ended: false,
  seeking: false,
  removeCalled: false,
  play: () => Promise.resolve(),
  pause() {},
  remove() {
    this.removeCalled = true;
  },
});

const createFakeHlsPlayer = () => {
  const listeners = new Map();
  const video = createFakeVideo("hls-video");
  return {
    tagName: "HA-HLS-PLAYER",
    style: { cssText: "" },
    classList: { contains: () => false },
    hidden: false,
    isConnected: false,
    updateComplete: Promise.resolve(),
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
    dispatch(type, detail = {}) {
      for (const handler of listeners.get(type) || []) {
        handler({ type, detail, target: this });
      }
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    },
    removeCalled: false,
    remove() {
      this.removeCalled = true;
      this.isConnected = false;
    },
    video,
  };
};

const createSlot = () => ({
  innerHTML: "occupied",
  children: [],
  appendChild(node) {
    node.isConnected = true;
    node.parentElement = this;
    this.children.push(node);
    return node;
  },
});

const withFakeDocument = async (run) => {
  const previousDocument = globalThis.document;
  const players = [];
  globalThis.document = {
    createElement(tagName) {
      assert.equal(tagName, "ha-hls-player");
      const player = createFakeHlsPlayer();
      players.push(player);
      return player;
    },
  };
  try {
    await run(players);
  } finally {
    globalThis.document = previousDocument;
  }
};

const createHarness = ({
  hlsStart = deferred(),
  upgradeStart = deferred(),
  signalingStarted = true,
  upgradeAvailable = true,
} = {}) => {
  const slot = createSlot();
  const hlsState = hlsStart;
  const upgradeState = upgradeStart;
  const committedTypes = [];
  const committedMedia = [];
  const appliedStates = [];
  const readinessCalls = [];
  const upgradeCalls = [];
  const upgradeVideo = createFakeVideo("upgrade-video");
  let assignedEngine = null;
  let upgradeDestroyCalls = 0;
  let fallbackRefreshStops = 0;

  const upgradeEngine = {
    type: "ha_direct",
    streamType: "webrtc",
    video: upgradeVideo,
    failure: new Promise(() => {}),
    destroy() {
      upgradeDestroyCalls += 1;
    },
  };
  const mounter = createHaDirectMounter({
    getHass: () => ({
      states: {
        "camera.front": { entity_id: "camera.front", attributes: {} },
      },
    }),
    getStreamMuted: () => true,
    getRotateOverlayActive: () => false,
    isCurrentEngine: (engine) => assignedEngine === engine,
    waitForStreamStart: (engine, timeoutMs, options) => {
      readinessCalls.push({ engine, timeoutMs, options });
      return engine?.tagName === "HA-HLS-PLAYER"
        ? hlsState.promise
        : upgradeState.promise;
    },
    assignCommittedEngine: (engine) => {
      assignedEngine = engine;
    },
    onCommittedMediaReady: (engine, video) => {
      committedMedia.push({ engine, video });
    },
    onCommittedStream: (type) => committedTypes.push(type),
    applyResolvedStreamUiState: (state) => appliedStates.push(state),
    startLoadingFallbackRefresh: () => () => {
      fallbackRefreshStops += 1;
    },
    setLiveNativeControls: () => {},
    scheduleResumeLive: () => {},
    preparePlaybackElements: () => true,
    createPlaybackDiagnostic: () => ({
      mark: () => {},
      finish: () => {},
    }),
    createUpgradePlayback: upgradeAvailable
      ? (options) => {
          upgradeCalls.push(options);
          return {
            engine: upgradeEngine,
            start: async () => signalingStarted,
          };
        }
      : () => null,
  });

  return {
    slot,
    hlsState,
    upgradeState,
    committedTypes,
    committedMedia,
    appliedStates,
    readinessCalls,
    upgradeCalls,
    upgradeEngine,
    get assignedEngine() {
      return assignedEngine;
    },
    get upgradeDestroyCalls() {
      return upgradeDestroyCalls;
    },
    get fallbackRefreshStops() {
      return fallbackRefreshStops;
    },
    mounter,
  };
};

test("HA Direct mounts HLS before starting the optional upgrade", async () => {
  await withFakeDocument(async (players) => {
    const harness = createHarness();
    const result = await harness.mounter.tryMount(
      harness.slot,
      { streamType: "webrtc" },
      { entity: "camera.front", commit: true },
    );
    const hlsPlayer = players[0];

    assert.equal(result.ok, true);
    assert.equal(result.type, "hls");
    assert.strictEqual(harness.slot.children[0], hlsPlayer);
    assert.strictEqual(harness.assignedEngine, result.engine);
    assert.equal(result.engine.streamType, "hls");
    assert.equal(harness.upgradeCalls.length, 0);

    harness.hlsState.resolve(true);
    assert.equal(await result.startupReady, true);
    await flushAsyncWork();

    assert.deepEqual(harness.committedTypes, ["hls"]);
    assert.equal(harness.upgradeCalls.length, 1);
    assert.strictEqual(harness.slot.children[1], harness.upgradeEngine.video);
    assert.match(hlsPlayer.style.cssText, /z-index:1/);
    assert.match(harness.upgradeEngine.video.style.cssText, /z-index:0/);

    harness.upgradeState.resolve(true);
    await flushAsyncWork();
    await flushAsyncWork();

    assert.equal(result.engine.streamType, "webrtc");
    assert.equal(hlsPlayer.removeCalled, true);
    assert.deepEqual(harness.committedTypes, ["hls", "webrtc"]);
    assert.strictEqual(
      harness.committedMedia.at(-1).video,
      harness.upgradeEngine.video,
    );
  });
});

test("a failed upgrade leaves the playing HLS session untouched", async () => {
  await withFakeDocument(async (players) => {
    const harness = createHarness({ signalingStarted: false });
    const result = await harness.mounter.tryMount(harness.slot, null, {
      entity: "camera.front",
      commit: true,
    });
    const hlsPlayer = players[0];

    harness.hlsState.resolve(true);
    await result.startupReady;
    await flushAsyncWork();

    assert.equal(result.engine.streamType, "hls");
    assert.equal(hlsPlayer.removeCalled, false);
    assert.equal(harness.upgradeEngine.video.removeCalled, true);
    assert.equal(harness.upgradeDestroyCalls, 1);
    assert.deepEqual(harness.committedTypes, ["hls"]);
  });
});

test("releasing a starting session aborts HLS and never opens an upgrade", async () => {
  await withFakeDocument(async (players) => {
    const harness = createHarness();
    const result = await harness.mounter.tryMount(harness.slot, null, {
      entity: "camera.front",
      commit: true,
    });
    const hlsPlayer = players[0];
    const hlsWait = harness.readinessCalls[0];

    harness.mounter.release(result.engine);
    harness.hlsState.resolve(true);
    assert.equal(await result.startupReady, false);

    assert.equal(hlsWait.options.abortSignal.aborted, true);
    assert.equal(hlsPlayer.removeCalled, true);
    assert.equal(harness.upgradeCalls.length, 0);
  });
});

test("an unavailable upgrade capability commits HLS without another connection", async () => {
  await withFakeDocument(async () => {
    const harness = createHarness({ upgradeAvailable: false });
    const result = await harness.mounter.tryMount(harness.slot, null, {
      entity: "camera.front",
      commit: true,
    });

    harness.hlsState.resolve(true);
    assert.equal(await result.startupReady, true);
    await flushAsyncWork();

    assert.equal(result.engine.streamType, "hls");
    assert.deepEqual(harness.committedTypes, ["hls"]);
    assert.equal(harness.readinessCalls.length, 1);
  });
});

test("HA Direct reports an unavailable entity without creating media", async () => {
  const states = [];
  const mounter = createHaDirectMounter({
    getHass: () => ({ states: {} }),
    getStreamMuted: () => true,
    applyResolvedStreamUiState: (state) => states.push(state),
    preparePlaybackElements: () => true,
    createPlaybackDiagnostic: () => ({ mark: () => {}, finish: () => {} }),
  });

  const result = await mounter.tryMount(createSlot(), null, {
    entity: "camera.missing",
    commit: true,
  });

  assert.equal(result, false);
  assert.deepEqual(states, [
    {
      loading: false,
      fallbackVisible: false,
      refreshFallbackImage: false,
    },
  ]);
});
