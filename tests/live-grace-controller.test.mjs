import { test } from "node:test";
import assert from "node:assert/strict";

import { createLiveGraceController } from "../src/features/live/live-grace-controller.js";

const originalDocument = globalThis.document;

function withFakeDocument(run) {
  const hostChildren = [];
  globalThis.document = {
    createElement() {
      return {
        isConnected: false,
        style: { cssText: "" },
        children: [],
        setAttribute() {},
        appendChild(child) {
          if (child.parentElement && child.parentElement !== this) {
            child.disconnectedCallback?.();
          }
          this.children.push(child);
          child.parentElement = this;
          child.connectedCallback?.();
          return child;
        },
        remove() {
          this.isConnected = false;
        },
      };
    },
  };

  const shadowRoot = {
    appendChild(node) {
      node.isConnected = true;
      hostChildren.push(node);
      return node;
    },
  };

  return Promise.resolve(run({ shadowRoot, hostChildren })).finally(() => {
    globalThis.document = originalDocument;
  });
}

test("mse grace controller preserves pending mse promise across cleanup", async () => {
  await withFakeDocument(async ({ shadowRoot }) => {
    let pendingDestroyers = [];
    let engine = null;
    const controller = createLiveGraceController({
      graceMs: 20,
      graceMax: 2,
      getShadowRoot: () => shadowRoot,
      getScopeKey: () => ({ id: "scope" }),
      getPendingMountDestroyers: () => pendingDestroyers,
      setPendingMountDestroyers: (next) => {
        pendingDestroyers = next;
      },
      getPendingWebRtcTakeoverTimer: () => null,
      setPendingWebRtcTakeoverTimer: () => {},
      clearRotateOverlayAudioSync: () => {},
      clearRotateVideoFullscreenStyle: () => {},
      getEngine: () => engine,
      setEngine: (next) => {
        engine = next;
      },
      getActiveStreamType: () => "snapshot",
      getStreamMuted: () => true,
      setEngineMountedMuted: () => {},
      getRotateOverlayActive: () => false,
      attachVideoFit: () => {},
      setActiveStreamType: () => {},
      setStreamLoading: () => {},
      setStreamFallbackVisible: () => {},
      setLiveNativeControls: () => {},
    });

    const gracePromise = Promise.resolve({
      ok: true,
      type: "mse",
      engine: {
        video: { style: { cssText: "" }, play: () => Promise.resolve() },
        ws: { readyState: 1 },
      },
    });
    let destroyed = false;
    pendingDestroyers = [
      {
        type: "mse",
        entity: "camera.front",
        promise: gracePromise,
        destroy() {
          destroyed = true;
        },
      },
    ];

    controller.cleanupEngine({ preserveMseEntity: "camera.front" });
    const entry = controller.takeGraceMseEntry("camera.front");

    assert.equal(destroyed, false);
    assert.equal(pendingDestroyers.length, 0);
    assert.equal(typeof entry?.promise?.then, "function");
    const resolvedEngine = await entry.promise;
    assert.ok(resolvedEngine?.video);
  });
});

test("mse grace controller preserves current mse engine across cleanup", async () => {
  await withFakeDocument(async ({ shadowRoot }) => {
    let engine = {
      video: { style: { cssText: "" }, play: () => Promise.resolve() },
      ws: { readyState: 1 },
      destroy() {},
    };
    const controller = createLiveGraceController({
      graceMs: 20,
      graceMax: 2,
      getShadowRoot: () => shadowRoot,
      getScopeKey: () => ({ id: "scope" }),
      getPendingMountDestroyers: () => [],
      setPendingMountDestroyers: () => {},
      getPendingWebRtcTakeoverTimer: () => null,
      setPendingWebRtcTakeoverTimer: () => {},
      clearRotateOverlayAudioSync: () => {},
      clearRotateVideoFullscreenStyle: () => {},
      getEngine: () => engine,
      setEngine: (next) => {
        engine = next;
      },
      getActiveStreamType: () => "mse",
      getStreamMuted: () => true,
      setEngineMountedMuted: () => {},
      getRotateOverlayActive: () => false,
      attachVideoFit: () => {},
      setActiveStreamType: () => {},
      setStreamLoading: () => {},
      setStreamFallbackVisible: () => {},
      setLiveNativeControls: () => {},
    });

    controller.cleanupEngine({ preserveMseEntity: "camera.front" });
    const entry = controller.takeGraceMseEntry("camera.front");

    assert.equal(engine, null);
    assert.equal(entry?.engine?.ws?.readyState, 1);
    controller.clearGracePool();
  });
});

test("grace controller evicts retained connections for one camera", async () => {
  await withFakeDocument(async ({ shadowRoot }) => {
    let destroyed = 0;
    let engine = {
      video: {
        style: { cssText: "" },
        play: () => Promise.resolve(),
      },
      ws: { readyState: 1 },
      destroy: () => {
        destroyed += 1;
      },
      deactivateRecovery() {},
    };
    const controller = createLiveGraceController({
      graceMs: 1000,
      graceMax: 2,
      getShadowRoot: () => shadowRoot,
      getScopeKey: () => ({ id: "scope" }),
      getPendingMountDestroyers: () => [],
      setPendingMountDestroyers: () => {},
      getPendingWebRtcTakeoverTimer: () => null,
      setPendingWebRtcTakeoverTimer: () => {},
      clearRotateOverlayAudioSync: () => {},
      clearRotateVideoFullscreenStyle: () => {},
      getEngine: () => engine,
      setEngine: (next) => {
        engine = next;
      },
      getActiveStreamType: () => "mse",
      getStreamMuted: () => true,
      setEngineMountedMuted: () => {},
      getRotateOverlayActive: () => false,
      attachVideoFit: () => {},
      setActiveStreamType: () => {},
      setStreamLoading: () => {},
      setStreamFallbackVisible: () => {},
      setLiveNativeControls: () => {},
    });

    controller.cleanupEngine({ preserveLiveEntity: "camera.front" });
    assert.equal(engine, null);
    controller.evictEntity("camera.front");
    assert.equal(destroyed, 1);
    assert.equal(controller.takeGraceMseEntry("camera.front"), null);
  });
});

test("MSE adoption rebinds diagnostics and recovery to the receiving owner", async () => {
  await withFakeDocument(async ({ shadowRoot }) => {
    const video = {
      style: { cssText: "" },
      dataset: {},
      classList: { add() {} },
      setAttribute() {},
      removeAttribute() {},
      play: () => Promise.resolve(),
    };
    const cachedEngine = {
      type: "frigate_go2rtc",
      streamType: "mse",
      video,
      ws: { readyState: 1 },
      recoveryHandler: null,
      activityHandler: null,
      activateRecovery() {},
      setRecoveryHandler(handler) {
        this.recoveryHandler = handler;
      },
      setActivityHandler(handler) {
        this.activityHandler = handler;
      },
    };
    let engine = null;
    let diagnosticsResetAt = 0;
    const activityTimes = [];
    const recoveryReasons = [];
    const controller = createLiveGraceController({
      graceMs: 100,
      graceMax: 2,
      getShadowRoot: () => shadowRoot,
      getScopeKey: () => ({ id: "receiver" }),
      getPendingMountDestroyers: () => [],
      setPendingMountDestroyers: () => {},
      getPendingWebRtcTakeoverTimer: () => null,
      setPendingWebRtcTakeoverTimer: () => {},
      clearRotateOverlayAudioSync: () => {},
      clearRotateVideoFullscreenStyle: () => {},
      getEngine: () => engine,
      setEngine: (next) => {
        engine = next;
      },
      getActiveStreamType: () => "mse",
      getStreamMuted: () => true,
      setEngineMountedMuted: () => {},
      getRotateOverlayActive: () => false,
      attachVideoFit: () => {},
      setActiveStreamType: () => {},
      setStreamLoading: () => {},
      setStreamFallbackVisible: () => {},
      setLiveNativeControls: () => {},
      scheduleResumeLive: (reason) => recoveryReasons.push(reason),
      resetMseDiagnostics: (connectedAt) => {
        diagnosticsResetAt = connectedAt;
      },
      markMseChunk: (chunkAt) => activityTimes.push(chunkAt),
    });
    const slot = {
      innerHTML: "occupied",
      appendChild(node) {
        this.child = node;
      },
    };

    assert.equal(controller.isMseEngineReusable(cachedEngine), true);
    assert.equal(controller.adoptGraceMseEngine(slot, cachedEngine), true);
    assert.equal(engine, cachedEngine);
    assert.equal(slot.child, video);
    assert.equal(diagnosticsResetAt > 0, true);

    cachedEngine.activityHandler(1234);
    cachedEngine.recoveryHandler("mse-ws-closed");
    assert.deepEqual(activityTimes, [1234]);
    assert.deepEqual(recoveryReasons, ["mse-ws-closed"]);

    cachedEngine.ws.readyState = 3;
    assert.equal(controller.isMseEngineReusable(cachedEngine), false);
  });
});

test("live grace controller preserves and re-adopts a WebRTC engine", async () => {
  await withFakeDocument(async ({ shadowRoot }) => {
    const video = {
      style: { cssText: "" },
      dataset: {},
      classList: { add() {} },
      setAttribute() {},
      removeAttribute() {},
      play: () => Promise.resolve(),
    };
    const cachedEngine = {
      video,
      pc: {
        connectionState: "connected",
        iceConnectionState: "connected",
      },
      ws: { readyState: 3 },
      signalingComplete: true,
      destroyCalls: 0,
      recoveryActive: true,
      recoveryHandler: null,
      activateRecovery() {
        this.recoveryActive = true;
      },
      deactivateRecovery() {
        this.recoveryActive = false;
      },
      setRecoveryHandler(handler) {
        this.recoveryHandler = handler;
      },
      destroy() {
        this.destroyCalls += 1;
      },
    };
    let engine = cachedEngine;
    let activeStreamType = "webrtc";
    const recoveryReasons = [];
    const controller = createLiveGraceController({
      graceMs: 100,
      graceMax: 2,
      getShadowRoot: () => shadowRoot,
      getScopeKey: () => ({ id: "scope" }),
      getPendingMountDestroyers: () => [],
      setPendingMountDestroyers: () => {},
      getPendingWebRtcTakeoverTimer: () => null,
      setPendingWebRtcTakeoverTimer: () => {},
      clearRotateOverlayAudioSync: () => {},
      clearRotateVideoFullscreenStyle: () => {},
      getEngine: () => engine,
      setEngine: (next) => {
        engine = next;
      },
      getActiveStreamType: () => activeStreamType,
      getStreamMuted: () => false,
      setEngineMountedMuted: () => {},
      getRotateOverlayActive: () => false,
      attachVideoFit: () => {},
      setActiveStreamType: (next) => {
        activeStreamType = next;
      },
      setStreamLoading: () => {},
      setStreamFallbackVisible: () => {},
      setLiveNativeControls: () => {},
      scheduleResumeLive: (reason) => recoveryReasons.push(reason),
    });

    controller.cleanupEngine({ preserveLiveEntity: "camera.front" });
    const entry = controller.takeGraceWebRtcEntry("camera.front");

    assert.equal(engine, null);
    assert.equal(entry?.engine, cachedEngine);
    assert.equal(cachedEngine.destroyCalls, 0);
    assert.equal(cachedEngine.recoveryActive, false);

    const slot = {
      innerHTML: "occupied",
      appendChild(node) {
        this.child = node;
      },
    };
    assert.equal(controller.adoptGraceWebRtcEngine(slot, entry.engine), true);
    assert.equal(engine, cachedEngine);
    assert.equal(activeStreamType, "webrtc");
    assert.equal(slot.child, video);
    assert.equal(cachedEngine.destroyCalls, 0);
    assert.equal(cachedEngine.recoveryActive, true);
    cachedEngine.recoveryHandler("webrtc-connection-lost");
    assert.deepEqual(recoveryReasons, ["webrtc-connection-lost"]);
  });
});

test("live grace controller shares its cache limit across MSE and WebRTC", async () => {
  await withFakeDocument(async ({ shadowRoot }) => {
    let engine = null;
    let activeStreamType = "";
    const destroyed = [];
    const makeVideo = () => ({
      style: { cssText: "" },
      play: () => Promise.resolve(),
    });
    const controller = createLiveGraceController({
      graceMs: 100,
      graceMax: 2,
      getShadowRoot: () => shadowRoot,
      getScopeKey: () => ({ id: "scope" }),
      getPendingMountDestroyers: () => [],
      setPendingMountDestroyers: () => {},
      getPendingWebRtcTakeoverTimer: () => null,
      setPendingWebRtcTakeoverTimer: () => {},
      clearRotateOverlayAudioSync: () => {},
      clearRotateVideoFullscreenStyle: () => {},
      getEngine: () => engine,
      setEngine: (next) => {
        engine = next;
      },
      getActiveStreamType: () => activeStreamType,
      getStreamMuted: () => true,
      setEngineMountedMuted: () => {},
      getRotateOverlayActive: () => false,
      attachVideoFit: () => {},
      setActiveStreamType: () => {},
      setStreamLoading: () => {},
      setStreamFallbackVisible: () => {},
      setLiveNativeControls: () => {},
    });
    const stash = (entity, type) => {
      activeStreamType = type;
      engine = {
        video: makeVideo(),
        ws: { readyState: 1 },
        ...(type === "webrtc"
          ? {
              pc: {
                connectionState: "connected",
                iceConnectionState: "connected",
              },
            }
          : {}),
        destroy() {
          destroyed.push(entity);
        },
      };
      controller.cleanupEngine({ preserveLiveEntity: entity });
    };

    stash("camera.one", "mse");
    stash("camera.two", "webrtc");
    stash("camera.three", "webrtc");

    assert.deepEqual(destroyed, ["camera.one"]);
    assert.equal(controller.takeGraceMseEntry("camera.one"), null);
    assert.ok(controller.takeGraceWebRtcEntry("camera.two")?.engine);
    assert.ok(controller.takeGraceWebRtcEntry("camera.three")?.engine);
  });
});

test("live grace controller retains HA-direct WebRTC without entering the Frigate pool", async () => {
  await withFakeDocument(async ({ shadowRoot }) => {
    const video = {
      style: { cssText: "" },
      dataset: {},
      classList: { add() {} },
      setAttribute() {},
      removeAttribute() {},
      paused: false,
      ended: false,
      seeking: false,
      readyState: 4,
      videoWidth: 1920,
      playbackRate: 1,
      play: () => Promise.resolve(),
    };
    const cachedEngine = {
      type: "ha_direct",
      streamType: "webrtc",
      video,
      hasLiveVideoTrack: () => true,
      hasRecentMediaActivity: () => true,
      pc: {
        connectionState: "connected",
        iceConnectionState: "connected",
      },
      destroyCalls: 0,
      destroy() {
        this.destroyCalls += 1;
      },
    };
    let engine = cachedEngine;
    let activeStreamType = "webrtc";
    let retainedOptions = null;
    let ownershipAdoptions = 0;
    const controller = createLiveGraceController({
      graceMs: 100,
      graceMax: 2,
      getShadowRoot: () => shadowRoot,
      getScopeKey: () => ({ id: "scope" }),
      getPendingMountDestroyers: () => [],
      setPendingMountDestroyers: () => {},
      getPendingWebRtcTakeoverTimer: () => null,
      setPendingWebRtcTakeoverTimer: () => {},
      clearRotateOverlayAudioSync: () => {},
      clearRotateVideoFullscreenStyle: () => {},
      getEngine: () => engine,
      setEngine: (next, options) => {
        engine = next;
        retainedOptions = options;
      },
      getActiveStreamType: () => activeStreamType,
      getStreamMuted: () => true,
      setEngineMountedMuted: () => {},
      getRotateOverlayActive: () => false,
      attachVideoFit: () => {},
      setActiveStreamType: (next) => {
        activeStreamType = next;
      },
      setStreamLoading: () => {},
      setStreamFallbackVisible: () => {},
      setLiveNativeControls: () => {},
      releaseHaDirectEngine: () => {
        throw new Error("retained HA engine must not be released");
      },
      adoptHaDirectWebRtcEngine: (candidate) => {
        assert.equal(engine, candidate);
        ownershipAdoptions += 1;
        return true;
      },
    });

    controller.cleanupEngine({ preserveLiveEntity: "camera.front" });

    assert.equal(engine, null);
    assert.deepEqual(retainedOptions, { retainPrevious: true });
    assert.equal(controller.takeGraceWebRtcEntry("camera.front"), null);
    const entry = controller.takeGraceHaDirectEntry("camera.front");
    assert.equal(entry?.engine, cachedEngine);

    const slot = {
      innerHTML: "occupied",
      appendChild(node) {
        this.child = node;
      },
    };
    assert.equal(
      controller.adoptGraceHaDirectEngine(slot, cachedEngine),
      true,
    );
    assert.equal(engine, cachedEngine);
    assert.equal(activeStreamType, "webrtc");
    assert.equal(slot.child, video);
    assert.equal(cachedEngine.destroyCalls, 0);
    assert.equal(ownershipAdoptions, 1);
  });
});

test("live grace controller keeps retained Catalyst HLS live without expiry", async () => {
  await withFakeDocument(async ({ shadowRoot }) => {
    const calls = [];
    const catalystEngine = {
      type: "ha_direct",
      streamType: "hls",
      catalystHls: true,
      ended: false,
      readyState: 4,
      style: { cssText: "" },
      play: () => {
        calls.push(["play"]);
        return Promise.resolve();
      },
      pause: () => calls.push(["pause"]),
      remove: () => calls.push(["remove"]),
    };
    let engine = catalystEngine;
    let assignOptions = null;
    const controller = createLiveGraceController({
      graceMs: 100,
      graceMax: 2,
      catalystRetainedMax: 2,
      getShadowRoot: () => shadowRoot,
      getScopeKey: () => ({ id: "scope" }),
      getPendingMountDestroyers: () => [],
      setPendingMountDestroyers: () => {},
      getPendingWebRtcTakeoverTimer: () => null,
      setPendingWebRtcTakeoverTimer: () => {},
      clearRotateOverlayAudioSync: () => {},
      clearRotateVideoFullscreenStyle: () => {},
      getEngine: () => engine,
      setEngine: (next, options) => {
        engine = next;
        assignOptions = options;
      },
      getActiveStreamType: () => "hls",
      getStreamMuted: () => true,
      setEngineMountedMuted: () => {},
      getRotateOverlayActive: () => false,
      attachVideoFit: () => {},
      setActiveStreamType: () => {},
      setStreamLoading: () => {},
      setStreamFallbackVisible: () => {},
      setLiveNativeControls: () => {},
      releaseHaDirectEngine: () => {
        throw new Error("Catalyst must remain outside normal HA Direct grace");
      },
      isCatalystHlsEngineReusable: (candidate) =>
        candidate === catalystEngine,
      suspendCatalystHlsEngine: (candidate) => {
        calls.push(["suspend", candidate]);
        return true;
      },
      adoptCatalystHlsEngine: (slot, candidate) => {
        calls.push(["adopt", slot, candidate]);
        engine = candidate;
        return true;
      },
      releaseCatalystHlsEngine: (candidate) =>
        calls.push(["release", candidate]),
    });

    controller.cleanupEngine({ preserveLiveEntity: "camera.front" });

    assert.equal(engine, null);
    assert.deepEqual(assignOptions, { retainPrevious: true });
    assert.equal(
      controller.takeGraceHaDirectEntry("camera.front", "hls"),
      null,
    );
    assert.deepEqual(calls, [["suspend", catalystEngine], ["play"]]);

    const slot = { id: "engine" };
    const entry = controller.takeGraceCatalystHlsEntry("camera.front");
    assert.equal(entry?.engine, catalystEngine);
    assert.equal(
      controller.adoptGraceCatalystHlsEngine(slot, catalystEngine),
      true,
    );
    assert.equal(engine, catalystEngine);
    assert.deepEqual(calls.at(-1), ["adopt", slot, catalystEngine]);

    controller.cleanupEngine({ preserveLiveEntity: "camera.front" });
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(
      calls.some(([name]) => name === "release"),
      false,
    );
    assert.equal(
      controller.hasRetainedCatalystHlsEngine("camera.front"),
      true,
    );
    assert.equal(
      controller.takeGraceCatalystHlsEntry("camera.front")?.engine,
      catalystEngine,
    );
    assert.equal(calls.some(([name]) => name === "release"), false);
  });
});

test("Catalyst retained-player pool evicts its oldest player at its own limit", async () => {
  await withFakeDocument(async ({ shadowRoot }) => {
    const released = [];
    let engine = null;
    const createEngine = (id) => ({
      id,
      type: "ha_direct",
      streamType: "hls",
      catalystHls: true,
      ended: false,
      readyState: 4,
      style: { cssText: "" },
      play: () => Promise.resolve(),
      pause() {},
      remove() {},
    });
    const controller = createLiveGraceController({
      graceMs: 1000,
      graceMax: 3,
      catalystRetainedMax: 1,
      getShadowRoot: () => shadowRoot,
      getScopeKey: () => ({ id: "scope" }),
      getPendingMountDestroyers: () => [],
      setPendingMountDestroyers: () => {},
      getPendingWebRtcTakeoverTimer: () => null,
      setPendingWebRtcTakeoverTimer: () => {},
      clearRotateOverlayAudioSync: () => {},
      clearRotateVideoFullscreenStyle: () => {},
      getEngine: () => engine,
      setEngine: (next) => {
        engine = next;
      },
      getActiveStreamType: () => "hls",
      getStreamMuted: () => true,
      setEngineMountedMuted: () => {},
      getRotateOverlayActive: () => false,
      attachVideoFit: () => {},
      setActiveStreamType: () => {},
      setStreamLoading: () => {},
      setStreamFallbackVisible: () => {},
      setLiveNativeControls: () => {},
      isCatalystHlsEngineReusable: () => true,
      suspendCatalystHlsEngine: () => true,
      adoptCatalystHlsEngine: () => true,
      releaseCatalystHlsEngine: (candidate) =>
        released.push(candidate.id),
    });

    engine = createEngine("front");
    controller.cleanupEngine({ preserveLiveEntity: "camera.front" });
    engine = createEngine("driveway");
    controller.cleanupEngine({ preserveLiveEntity: "camera.driveway" });

    assert.deepEqual(released, ["front"]);
    assert.equal(controller.takeGraceCatalystHlsEntry("camera.front"), null);
    assert.equal(
      controller.takeGraceCatalystHlsEntry("camera.driveway")?.engine?.id,
      "driveway",
    );
  });
});

test("live grace controller rejects HA-direct WebRTC that is not immediately reusable", async () => {
  await withFakeDocument(async ({ shadowRoot }) => {
    const releasedEngines = [];
    let hasLiveVideoTrack = true;
    let hasRecentMediaActivity = true;
    const video = {
      style: { cssText: "" },
      paused: false,
      ended: false,
      seeking: false,
      readyState: 4,
      videoWidth: 1920,
      playbackRate: 1,
      remove() {},
    };
    const cachedEngine = {
      type: "ha_direct",
      streamType: "webrtc",
      video,
      hasLiveVideoTrack: () => hasLiveVideoTrack,
      hasRecentMediaActivity: () => hasRecentMediaActivity,
      pc: {
        connectionState: "connecting",
        iceConnectionState: "connected",
      },
    };
    let engine = cachedEngine;
    const controller = createLiveGraceController({
      graceMs: 100,
      graceMax: 2,
      getShadowRoot: () => shadowRoot,
      getScopeKey: () => ({ id: "scope" }),
      getPendingMountDestroyers: () => [],
      setPendingMountDestroyers: () => {},
      getPendingWebRtcTakeoverTimer: () => null,
      setPendingWebRtcTakeoverTimer: () => {},
      clearRotateOverlayAudioSync: () => {},
      clearRotateVideoFullscreenStyle: () => {},
      getEngine: () => engine,
      setEngine: (next) => {
        engine = next;
      },
      getActiveStreamType: () => "webrtc",
      getStreamMuted: () => true,
      setEngineMountedMuted: () => {},
      getRotateOverlayActive: () => false,
      attachVideoFit: () => {},
      setActiveStreamType: () => {},
      setStreamLoading: () => {},
      setStreamFallbackVisible: () => {},
      setLiveNativeControls: () => {},
      releaseHaDirectEngine: (releasedEngine) => {
        releasedEngines.push(releasedEngine);
      },
    });

    assert.equal(controller.isHaDirectEngineReusable(cachedEngine), false);
    cachedEngine.pc.connectionState = "connected";
    video.readyState = 1;
    video.videoWidth = 0;
    assert.equal(controller.isHaDirectEngineReusable(cachedEngine), false);
    video.readyState = 4;
    video.videoWidth = 1920;
    hasRecentMediaActivity = false;
    assert.equal(controller.isHaDirectEngineReusable(cachedEngine), false);
    hasRecentMediaActivity = true;
    hasLiveVideoTrack = false;
    assert.equal(controller.isHaDirectEngineReusable(cachedEngine), false);
    controller.cleanupEngine({ preserveLiveEntity: "camera.front" });

    assert.equal(engine, null);
    assert.equal(
      controller.takeGraceHaDirectEntry("camera.front", "webrtc"),
      null,
    );
    assert.deepEqual(releasedEngines, [cachedEngine]);
  });
});

test("live grace controller releases HA-direct HLS instead of reparenting it", async () => {
  await withFakeDocument(async ({ shadowRoot, hostChildren }) => {
    let removeCalls = 0;
    let connectedCalls = 0;
    let disconnectedCalls = 0;
    let cancelTakeoverCalls = 0;
    const hlsEngine = {
      type: "ha_direct",
      streamType: "hls",
      tagName: "HA-HLS-PLAYER",
      style: { cssText: "" },
      parentElement: { id: "active-live-slot" },
      cancelPendingTakeover() {
        cancelTakeoverCalls += 1;
      },
      connectedCallback() {
        connectedCalls += 1;
      },
      disconnectedCallback() {
        disconnectedCalls += 1;
      },
      remove() {
        removeCalls += 1;
        this.disconnectedCallback();
      },
    };
    let engine = hlsEngine;
    const releasedEngines = [];
    let assignOptions = null;
    const controller = createLiveGraceController({
      graceMs: 100,
      graceMax: 2,
      getShadowRoot: () => shadowRoot,
      getScopeKey: () => ({ id: "scope" }),
      getPendingMountDestroyers: () => [],
      setPendingMountDestroyers: () => {},
      getPendingWebRtcTakeoverTimer: () => null,
      setPendingWebRtcTakeoverTimer: () => {},
      clearRotateOverlayAudioSync: () => {},
      clearRotateVideoFullscreenStyle: () => {},
      getEngine: () => engine,
      setEngine: (next, options) => {
        engine = next;
        assignOptions = options;
      },
      getActiveStreamType: () => "hls",
      getStreamMuted: () => true,
      setEngineMountedMuted: () => {},
      getRotateOverlayActive: () => false,
      attachVideoFit: () => {},
      setActiveStreamType: () => {},
      setStreamLoading: () => {},
      setStreamFallbackVisible: () => {},
      setLiveNativeControls: () => {},
      releaseHaDirectEngine: (released) => {
        releasedEngines.push(released);
      },
      adoptHaDirectWebRtcEngine: () => {
        throw new Error("HLS must not enter WebRTC handoff ownership");
      },
    });

    assert.equal(controller.isHaDirectEngineReusable(hlsEngine), false);
    controller.cleanupEngine({ preserveLiveEntity: "camera.front" });

    assert.equal(engine, null);
    assert.deepEqual(assignOptions, { retainPrevious: true });
    assert.equal(cancelTakeoverCalls, 1);
    assert.deepEqual(releasedEngines, [hlsEngine]);
    assert.equal(removeCalls, 1);
    assert.equal(connectedCalls, 0);
    assert.equal(disconnectedCalls, 1);
    assert.equal(hostChildren.length, 0);
    assert.equal(controller.takeGraceWebRtcEntry("camera.front"), null);
    assert.equal(
      controller.takeGraceHaDirectEntry("camera.front", "hls"),
      null,
    );
  });
});
