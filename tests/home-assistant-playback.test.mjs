import { test } from "node:test";
import assert from "node:assert/strict";

import { watchHaPlaybackFirstFrame } from "../src/integrations/home-assistant/playback.js";

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
