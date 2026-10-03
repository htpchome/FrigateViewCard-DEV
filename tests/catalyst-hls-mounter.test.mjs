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

const createHlsPlayer = (video) => {
  const listeners = new Map();
  return {
    tagName: "HA-HLS-PLAYER",
    hidden: false,
    classList: { contains: () => false },
    style: { cssText: "" },
    shadowRoot: {
      querySelector: (selector) => (selector === "video" ? video : null),
    },
    querySelector: () => null,
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

test("Catalyst HLS mounter owns an ha-hls-player-only startup", async () => {
  const hass = {
    states: { "camera.front": { entity_id: "camera.front" } },
  };
  const video = createVideo();
  const player = createHlsPlayer(video);
  const slot = {
    innerHTML: "occupied",
    appendChild(node) {
      this.child = node;
      node.parentElement = this;
    },
  };
  const calls = [];
  let currentEngine = null;
  let playerOptions = null;
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
    startLoadingFallbackRefresh: () => {
      calls.push(["start-fallback-refresh"]);
      return () => calls.push(["stop-binding-refresh"]);
    },
    stopLoadingFallbackRefresh: () =>
      calls.push(["stop-global-refresh"]),
    setLiveNativeControls: () => {},
    preparePlaybackElements: () => {
      calls.push(["prepare"]);
      return true;
    },
    createHlsPlayer: (options) => {
      playerOptions = options;
      return player;
    },
  });

  const result = await mounter.tryMount(
    slot,
    { streamType: "webrtc" },
    { entity: "camera.front", commit: true },
  );

  assert.equal(result.ok, true);
  assert.equal(result.type, "hls");
  assert.equal(result.engine, player);
  assert.equal(player.type, "ha_direct");
  assert.equal(player.streamType, "hls");
  assert.equal(player.catalystHls, true);
  assert.equal(slot.child, player);
  assert.equal(playerOptions.entity, "camera.front");
  assert.equal(playerOptions.muted, true);
  assert.equal(await result.startupReady, true);
  assert.equal(waitOptions.requireReadyState, 2);
  assert.equal(waitOptions.resolveVideo(), video);
  assert.equal(calls.some(([name]) => name === "stream"), true);
  assert.deepEqual(
    calls.find(([name]) => name === "media"),
    ["media", player, video],
  );

  mounter.release(player);
  assert.equal(player.destroyCalls, 1);
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
    preparePlaybackElements: () => true,
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
