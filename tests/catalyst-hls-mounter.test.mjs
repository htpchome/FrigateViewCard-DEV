import { test } from "node:test";
import assert from "node:assert/strict";

import { createCatalystHlsMounter } from "../src/features/live/catalyst-hls-mounter.js";

const createVideo = () => {
  const listeners = new Map();
  return {
    tagName: "VIDEO",
    hidden: false,
    classList: { contains: () => false },
    style: { cssText: "" },
    readyState: 3,
    ended: false,
    playCalls: 0,
    play() {
      this.playCalls += 1;
      return Promise.resolve();
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    dispatch(type) {
      listeners.get(type)?.({ type });
    },
    destroyCalls: 0,
    destroy() {
      this.destroyCalls += 1;
    },
  };
};

test("Catalyst HLS mounter owns a native HLS-only startup", async () => {
  const hass = {
    states: { "camera.front": { entity_id: "camera.front" } },
  };
  const video = createVideo();
  const slot = {
    innerHTML: "occupied",
    appendChild(node) {
      this.child = node;
      node.parentElement = this;
    },
  };
  const calls = [];
  let currentEngine = null;
  let videoOptions = null;
  let waitOptions = null;
  const mounter = createCatalystHlsMounter({
    getHass: () => hass,
    getStreamMuted: () => true,
    getRotateOverlayActive: () => false,
    isCurrentEngine: (engine) => engine === currentEngine,
    waitForStreamStart: async (engine, waitMs, options) => {
      calls.push(["wait", engine, waitMs]);
      waitOptions = options;
      options.onVideoReady(video);
      return true;
    },
    assignCommittedEngine: (engine) => {
      currentEngine = engine;
      calls.push(["assign", engine]);
    },
    onCommittedMediaReady: (...args) => calls.push(["media", ...args]),
    onCommittedStream: (type) => calls.push(["stream", type]),
    applyResolvedStreamUiState: (state) => calls.push(["ui", state]),
    startLoadingFallbackRefresh: (options) => {
      calls.push(["start-fallback-refresh", options]);
      return () => calls.push(["stop-binding-refresh"]);
    },
    stopLoadingFallbackRefresh: () =>
      calls.push(["stop-global-refresh"]),
    setLiveNativeControls: () => {},
    prepareHlsPlayback: () => {
      calls.push(["prepare"]);
      return true;
    },
    createHlsVideo: (options) => {
      videoOptions = options;
      return video;
    },
  });

  const result = await mounter.tryMount(
    slot,
    { streamType: "webrtc" },
    { entity: "camera.front", commit: true },
  );

  assert.equal(result.ok, true);
  assert.equal(result.type, "hls");
  assert.equal(result.engine, video);
  assert.equal(video.type, "ha_direct");
  assert.equal(video.streamType, "hls");
  assert.equal(video.catalystHls, true);
  assert.equal(slot.child, video);
  assert.equal(videoOptions.entity, "camera.front");
  assert.equal(videoOptions.streamFormat, "hls");
  assert.equal(videoOptions.muted, true);
  assert.equal(await result.startupReady, true);
  assert.equal(waitOptions.minCurrentTime, 0.05);
  assert.equal(waitOptions.minDecodedFrames, 2);
  assert.equal(waitOptions.requirePresentedFrame, true);
  assert.equal(waitOptions.requireReadyState, 2);
  assert.equal(waitOptions.strict, true);
  assert.equal(waitOptions.resolveVideo(), video);
  assert.deepEqual(
    calls.find(([name]) => name === "start-fallback-refresh"),
    ["start-fallback-refresh", { preserveRenderedFrame: true }],
  );
  assert.equal(calls.some(([name]) => name === "stream"), true);
  assert.deepEqual(
    calls.find(([name]) => name === "media"),
    ["media", video, video],
  );

  mounter.release(video);
  assert.equal(video.destroyCalls, 1);
});

test("Catalyst ignores transient video errors while presented-frame startup is pending", async () => {
  const hass = {
    states: { "camera.front": { entity_id: "camera.front" } },
  };
  const video = createVideo();
  let currentEngine = null;
  let resolveStartup = null;
  let startupOptions = null;
  const calls = [];
  const mounter = createCatalystHlsMounter({
    getHass: () => hass,
    getStreamMuted: () => true,
    getRotateOverlayActive: () => false,
    isCurrentEngine: (engine) => engine === currentEngine,
    waitForStreamStart: async (_engine, _waitMs, options) => {
      startupOptions = options;
      return await new Promise((resolve) => {
        resolveStartup = resolve;
      });
    },
    assignCommittedEngine: (engine) => {
      currentEngine = engine;
    },
    onCommittedMediaReady: () => calls.push(["media"]),
    onCommittedStream: (type) => calls.push(["stream", type]),
    applyResolvedStreamUiState: (state) => calls.push(["ui", state]),
    startLoadingFallbackRefresh: () => {
      calls.push(["start-refresh"]);
      return () => calls.push(["stop-refresh"]);
    },
    stopLoadingFallbackRefresh: () => calls.push(["stop-global"]),
    setLiveNativeControls: () => {},
    createHlsVideo: () => video,
  });
  const result = await mounter.tryMount(
    {
      innerHTML: "",
      appendChild() {},
    },
    null,
    { entity: "camera.front", commit: true },
  );

  video.dispatch("error");
  assert.deepEqual(calls, [["start-refresh"]]);

  startupOptions.onVideoReady(video);
  resolveStartup(true);
  assert.equal(await result.startupReady, true);
  assert.deepEqual(calls.map(([name, value]) => [name, value]), [
    ["start-refresh", undefined],
    ["stop-refresh", undefined],
    ["media", undefined],
    ["stream", "hls"],
    [
      "ui",
      {
        shouldApply: true,
        loading: false,
        fallbackVisible: false,
        refreshFallbackImage: false,
        enableNativeControls: false,
      },
    ],
  ]);
});

test("Catalyst late recovery also requires a presented frame", async () => {
  const hass = {
    states: { "camera.front": { entity_id: "camera.front" } },
  };
  const video = createVideo();
  let currentEngine = null;
  const waitOptions = [];
  const streamTypes = [];
  const mounter = createCatalystHlsMounter({
    getHass: () => hass,
    getStreamMuted: () => true,
    getRotateOverlayActive: () => false,
    isCurrentEngine: (engine) => engine === currentEngine,
    waitForStreamStart: async (_engine, _waitMs, options) => {
      waitOptions.push(options);
      options.onVideoReady(video);
      return true;
    },
    assignCommittedEngine: (engine) => {
      currentEngine = engine;
    },
    onCommittedMediaReady: () => {},
    onCommittedStream: (type) => streamTypes.push(type),
    applyResolvedStreamUiState: () => {},
    startLoadingFallbackRefresh: () => () => {},
    stopLoadingFallbackRefresh: () => {},
    setLiveNativeControls: () => {},
    createHlsVideo: () => video,
  });
  const result = await mounter.tryMount(
    {
      innerHTML: "",
      appendChild() {},
    },
    null,
    { entity: "camera.front", commit: true },
  );
  assert.equal(await result.startupReady, true);

  video.dispatch("error");
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(streamTypes, ["hls", "snapshot", "hls"]);
  assert.equal(waitOptions.length, 2);
  assert.equal(waitOptions[1].requirePresentedFrame, true);
  assert.equal(waitOptions[1].strict, true);
  assert.equal(waitOptions[1].minDecodedFrames, 2);
});

test("Catalyst native HLS transfers ownership without restarting playback", async () => {
  const hass = {
    states: { "camera.front": { entity_id: "camera.front" } },
  };
  const video = createVideo();
  const donorSlot = {
    innerHTML: "",
    appendChild(node) {
      this.child = node;
      node.parentElement = this;
    },
  };
  let donorEngine = null;
  const donor = createCatalystHlsMounter({
    getHass: () => hass,
    getStreamMuted: () => true,
    getRotateOverlayActive: () => false,
    isCurrentEngine: (engine) => engine === donorEngine,
    waitForStreamStart: async (_engine, _waitMs, options) => {
      options.onVideoReady(video);
      return true;
    },
    assignCommittedEngine: (engine) => {
      donorEngine = engine;
    },
    onCommittedMediaReady: () => {},
    onCommittedStream: () => {},
    applyResolvedStreamUiState: () => {},
    createHlsVideo: () => video,
  });
  const mounted = await donor.tryMount(
    donorSlot,
    null,
    { entity: "camera.front", commit: true },
  );
  assert.equal(await mounted.startupReady, true);
  assert.equal(donor.isRetainableEngine(video), true);
  assert.equal(donor.detachForHandoff(video), true);

  const receiverCalls = [];
  let receiverEngine = null;
  const receiverSlot = {
    innerHTML: "occupied",
    appendChild(node) {
      this.child = node;
      node.parentElement = this;
    },
  };
  const receiver = createCatalystHlsMounter({
    getHass: () => hass,
    getStreamMuted: () => false,
    getRotateOverlayActive: () => false,
    isCurrentEngine: (engine) => engine === receiverEngine,
    waitForStreamStart: async () => true,
    assignCommittedEngine: (engine) => {
      receiverEngine = engine;
      receiverCalls.push(["assign", engine]);
    },
    onCommittedMediaReady: (...args) => receiverCalls.push(["media", ...args]),
    onCommittedStream: (type) => receiverCalls.push(["stream", type]),
    applyResolvedStreamUiState: () => receiverCalls.push(["ready"]),
  });

  assert.equal(receiver.adoptRetainedEngine(receiverSlot, video), true);
  assert.equal(receiverSlot.child, video);
  assert.equal(video.muted, false);
  assert.equal(video.playCalls, 1);
  assert.deepEqual(receiverCalls.slice(0, 3), [
    ["assign", video],
    ["media", video, video],
    ["stream", "hls"],
  ]);
  assert.equal(receiver.detachForHandoff(video), true);
  assert.equal(receiver.adoptRetainedEngine(receiverSlot, video), true);
});

test("Catalyst HLS mounter does not mount unavailable camera entities", async () => {
  const uiStates = [];
  const mounter = createCatalystHlsMounter({
    getHass: () => ({ states: {} }),
    getStreamMuted: () => true,
    getRotateOverlayActive: () => false,
    isCurrentEngine: () => false,
    waitForStreamStart: async () => true,
    assignCommittedEngine: () => {},
    applyResolvedStreamUiState: (state) => uiStates.push(state),
    prepareHlsPlayback: () => true,
  });

  assert.equal(
    await mounter.tryMount(
      { appendChild() {} },
      null,
      { entity: "camera.missing", commit: true },
    ),
    false,
  );
  assert.deepEqual(uiStates, [
    {
      loading: false,
      fallbackVisible: false,
      refreshFallbackImage: false,
    },
  ]);
});
