import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildHaCameraStreamState,
  createHaCameraStreamElement,
  createHaNativeHlsVideoElement,
  ensureHaCameraPlaybackElements,
  findActiveHaCameraStreamVideo,
  watchHaPlaybackFirstFrame,
} from "../src/integrations/home-assistant/playback.js";

test("HA camera-stream receives the real state without a forced transport", () => {
  const previousDocument = globalThis.document;
  const stream = { style: { cssText: "" } };
  globalThis.document = {
    createElement: (tagName) => {
      assert.equal(tagName, "ha-camera-stream");
      return stream;
    },
  };

  try {
    const stateObj = { entity_id: "camera.front", attributes: {} };
    const hass = { states: { "camera.front": stateObj } };
    const result = createHaCameraStreamElement({
      stateObj: buildHaCameraStreamState(hass, "camera.front"),
      muted: true,
    });

    assert.strictEqual(result.stateObj, stateObj);
    assert.equal(result.muted, true);
    assert.equal(Object.hasOwn(stateObj.attributes, "frontend_stream_type"), false);
    assert.equal(Object.hasOwn(result, "hass"), false);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("HA native HLS video uses the authenticated camera stream URL", async () => {
  const previousDocument = globalThis.document;
  const calls = [];
  const video = {
    tagName: "VIDEO",
    hidden: false,
    classList: { contains: () => false },
    style: { cssText: "", objectFit: "" },
    paused: false,
    removedSource: false,
    loaded: false,
    pause() {
      this.paused = true;
    },
    removeAttribute(name) {
      if (name === "src") this.removedSource = true;
    },
    load() {
      this.loaded = true;
    },
  };
  globalThis.document = {
    createElement: (tagName) => {
      assert.equal(tagName, "video");
      return video;
    },
  };

  try {
    const result = createHaNativeHlsVideoElement({
      hass: {
        callWS: async (message) => {
          calls.push(message);
          return { url: "/api/hls/test/master_playlist.m3u8" };
        },
        hassUrl: (path) => `https://ha.example${path}`,
      },
      entity: "camera.front",
      muted: true,
      defaultMuted: true,
      fitMode: "contain",
      styleText: "width:100%",
    });
    assert.equal(await result.hlsUrlReady, true);

    assert.equal(result, video);
    assert.deepEqual(calls, [
      { type: "camera/stream", entity_id: "camera.front" },
    ]);
    assert.equal(video.src, "https://ha.example/api/hls/test/master_playlist.m3u8");
    assert.equal(video.autoplay, true);
    assert.equal(video.playsInline, true);
    assert.equal(video.muted, true);
    assert.equal(video.defaultMuted, true);
    assert.equal(video.preload, "auto");
    assert.equal(video.style.objectFit, "contain");
    assert.equal(findActiveHaCameraStreamVideo(video), video);

    video.destroy();
    assert.equal(video.paused, true);
    assert.equal(video.removedSource, true);
    assert.equal(video.loaded, true);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("HA native HLS video can explicitly request the HLS format", async () => {
  const previousDocument = globalThis.document;
  const calls = [];
  const video = {
    style: {},
    pause() {},
    removeAttribute() {},
    load() {},
  };
  globalThis.document = { createElement: () => video };

  try {
    const result = createHaNativeHlsVideoElement({
      hass: {
        callWS: async (message) => {
          calls.push(message);
          return { url: "/api/hls/test/master_playlist.m3u8" };
        },
      },
      entity: "camera.front",
      streamFormat: "hls",
    });

    assert.equal(await result.hlsUrlReady, true);
    assert.deepEqual(calls, [
      {
        type: "camera/stream",
        entity_id: "camera.front",
        format: "hls",
      },
    ]);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("HA native HLS video ignores a stream URL after release", async () => {
  const previousDocument = globalThis.document;
  let resolveStream;
  const streamResponse = new Promise((resolve) => {
    resolveStream = resolve;
  });
  const video = {
    tagName: "VIDEO",
    classList: { contains: () => false },
    style: {},
    pause() {},
    removeAttribute() {},
    load() {},
  };
  globalThis.document = {
    createElement: () => video,
  };

  try {
    const result = createHaNativeHlsVideoElement({
      hass: {
        callWS: () => streamResponse,
        hassUrl: (path) => `https://ha.example${path}`,
      },
      entity: "camera.front",
    });

    result.destroy();
    resolveStream({ url: "/api/hls/test/master_playlist.m3u8" });

    assert.equal(await result.hlsUrlReady, false);
    assert.equal(result.src, undefined);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("HA camera playback preparation side-loads the camera stack once", async () => {
  const definitions = new Map();
  const registry = {
    get: (tagName) => definitions.get(tagName),
    whenDefined: async () => {},
  };
  let helperLoads = 0;
  let cardCreations = 0;
  const loadCardHelpers = async () => {
    helperLoads += 1;
    return {
      createCardElement: async (config) => {
        cardCreations += 1;
        assert.deepEqual(config, {
          type: "picture-glance",
          entities: [],
          camera_image: "camera.frigate_view_component_loader",
        });
        for (const tagName of [
          "ha-camera-stream",
          "ha-hls-player",
          "ha-web-rtc-player",
        ]) {
          definitions.set(tagName, class {});
        }
      },
    };
  };

  const [first, second] = await Promise.all([
    ensureHaCameraPlaybackElements({ registry, loadCardHelpers }),
    ensureHaCameraPlaybackElements({ registry, loadCardHelpers }),
  ]);
  const third = await ensureHaCameraPlaybackElements({
    registry,
    loadCardHelpers,
  });

  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(third, true);
  assert.equal(helperLoads, 1);
  assert.equal(cardCreations, 1);
});

test("HA camera playback preparation fails open when helpers are unavailable", async () => {
  const registry = {
    get: () => undefined,
    whenDefined: async () => {},
  };

  assert.equal(
    await ensureHaCameraPlaybackElements({
      registry,
      loadCardHelpers: async () => undefined,
    }),
    false,
  );
});

const createEventTarget = () => {
  const listeners = new Map();
  return {
    addEventListener(eventName, listener) {
      const eventListeners = listeners.get(eventName) || new Set();
      eventListeners.add(listener);
      listeners.set(eventName, eventListeners);
    },
    removeEventListener(eventName, listener) {
      listeners.get(eventName)?.delete(listener);
    },
    emit(eventName) {
      listeners.get(eventName)?.forEach((listener) =>
        listener({ type: eventName }),
      );
    },
    listenerCount(eventName) {
      return listeners.get(eventName)?.size || 0;
    },
  };
};

const createPendingVideo = () => {
  const callbacks = new Map();
  const canceled = [];
  let nextId = 1;
  return {
    readyState: 0,
    videoWidth: 0,
    currentTime: 0,
    callbacks,
    canceled,
    addEventListener() {},
    removeEventListener() {},
    requestVideoFrameCallback(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancelVideoFrameCallback(id) {
      canceled.push(id);
      callbacks.delete(id);
    },
  };
};

test("HA camera-stream readiness follows the active player after HA switches to HLS", async () => {
  const events = createEventTarget();
  const webRtcVideo = createPendingVideo();
  const hlsVideo = createPendingVideo();
  const webRtcPlayer = {
    hidden: false,
    classList: { contains: () => false },
    shadowRoot: { querySelector: () => webRtcVideo },
  };
  const hlsPlayer = {
    tagName: "HA-HLS-PLAYER",
    hidden: true,
    classList: { contains: () => false },
    shadowRoot: { querySelector: () => hlsVideo },
  };
  const stream = {
    ...events,
    tagName: "HA-CAMERA-STREAM",
    isConnected: true,
    updateComplete: Promise.resolve(),
    shadowRoot: {
      querySelectorAll: () => [webRtcPlayer, hlsPlayer],
    },
  };
  let readyCount = 0;

  const cleanup = watchHaPlaybackFirstFrame({
    stream,
    onReady: () => {
      readyCount += 1;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(webRtcVideo.callbacks.size, 1);
  assert.equal(hlsVideo.callbacks.size, 0);

  webRtcPlayer.hidden = true;
  hlsPlayer.hidden = false;
  stream.emit("streams");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(webRtcVideo.canceled, [1]);
  assert.equal(hlsVideo.callbacks.size, 1);
  hlsVideo.callbacks.values().next().value();
  assert.equal(readyCount, 1);
  assert.equal(stream.listenerCount("load"), 0);
  assert.equal(stream.listenerCount("streams"), 0);

  cleanup();
  assert.equal(readyCount, 1);
});
