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
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
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
  let nativeOptions = null;
  let waitOptions = null;
  const mounter = createCatalystHlsMounter({
    getHass: () => hass,
    getStreamMuted: () => true,
    getRotateOverlayActive: () => false,
    isCurrentEngine: (engine) => engine === currentEngine,
    waitForStreamStart: async (engine, waitMs, options) => {
      calls.push(["wait", engine, waitMs]);
      waitOptions = options;
      return true;
    },
    assignCommittedEngine: (engine) => {
      currentEngine = engine;
      calls.push(["assign", engine]);
    },
    onCommittedMediaReady: (...args) => calls.push(["media", ...args]),
    onCommittedStream: (type) => calls.push(["stream", type]),
    applyResolvedStreamUiState: (state) => calls.push(["ui", state]),
    startLoadingFallbackRefresh: () => {
      calls.push(["start-fallback-refresh"]);
      return () => calls.push(["stop-binding-refresh"]);
    },
    stopLoadingFallbackRefresh: () =>
      calls.push(["stop-global-refresh"]),
    setLiveNativeControls: () => {},
    createNativeHlsVideo: async (options) => {
      nativeOptions = options;
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
  assert.equal(nativeOptions.entity, "camera.front");
  assert.equal(nativeOptions.muted, true);
  assert.equal(await result.startupReady, true);
  assert.equal(waitOptions.requireReadyState, 2);
  assert.equal(waitOptions.resolveVideo(), video);
  assert.equal(calls.some(([name]) => name === "stream"), true);

  mounter.release(video);
  assert.equal(video.destroyCalls, 1);
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
