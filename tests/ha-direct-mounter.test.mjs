import { test } from "node:test";
import assert from "node:assert/strict";

import { createHaDirectMounter } from "../src/features/live/ha-direct-mounter.js";

function createFakeStreamElement() {
  const listeners = new Map();
  const firstVideo = { tagName: "VIDEO", id: "first-video" };
  const firstPlayer = createFakePlayer(firstVideo);
  let players = [firstPlayer];
  return {
    style: { cssText: "" },
    updateComplete: Promise.resolve(),
    get players() {
      return players;
    },
    set players(nextPlayers) {
      players = nextPlayers;
    },
    firstVideo,
    shadowRoot: {
      querySelectorAll: () => players,
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

function createFakePlayer(video, hidden = false) {
  return {
    hidden,
    classList: {
      contains: (name) => name === "hidden" && hidden,
    },
    updateComplete: Promise.resolve(),
    shadowRoot: {
      querySelector: (selector) => (selector === "video" ? video : null),
    },
    querySelector: () => null,
  };
}

const flushAsyncWork = () => new Promise((resolve) => setImmediate(resolve));

function withFakeDocument(run) {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: (tag) => {
      if (String(tag).toLowerCase() !== "ha-camera-stream") {
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

test("ha direct mounter follows HA's visible player and releases its listeners", async () => {
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
        getPreferredStreamType: () => "webrtc",
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
      const firstPlayer = stream.players[0];
      const secondVideo = { tagName: "VIDEO", id: "second-video" };
      const secondPlayer = createFakePlayer(secondVideo);
      firstPlayer.hidden = true;
      firstPlayer.classList.contains = (name) => name === "hidden";
      stream.players = [firstPlayer, secondPlayer];
      stream.dispatch("streams");
      await flushAsyncWork();

      secondPlayer.hidden = true;
      secondPlayer.classList.contains = (name) => name === "hidden";
      firstPlayer.hidden = false;
      firstPlayer.classList.contains = () => false;
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
