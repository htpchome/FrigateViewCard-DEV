import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.window = globalThis.window || { customCards: [] };
globalThis.window.customCards = globalThis.window.customCards || [];
globalThis.document = globalThis.document || {
  createElement: () => ({
    style: {},
    setAttribute() {},
    removeAttribute() {},
    appendChild() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  }),
  head: { appendChild() {} },
};
globalThis.customElements = globalThis.customElements || {
  define() {},
  get() {
    return undefined;
  },
};
globalThis.HTMLElement =
  globalThis.HTMLElement ||
  class {
    attachShadow() {
      return {
        addEventListener() {},
        removeEventListener() {},
        querySelector() {
          return null;
        },
        querySelectorAll() {
          return [];
        },
      };
    }
  };
globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};

const { FrigateViewCard } = await import("../src/card/FrigateViewCard.js");

test("stream readiness reports the video element it already discovered", async () => {
  const video = {
    addEventListener() {},
    currentTime: 0.25,
    readyState: 2,
    webkitDecodedFrameCount: 1,
  };
  const streamEl = {
    querySelector: (selector) => (selector === "video" ? video : null),
    shadowRoot: null,
  };
  let readyVideo = null;

  const started = await FrigateViewCard.prototype._waitForStreamStart.call(
    {},
    streamEl,
    500,
    {
      minCurrentTime: 0.05,
      minDecodedFrames: 1,
      requireReadyState: 2,
      onVideoReady: (discoveredVideo) => {
        readyVideo = discoveredVideo;
      },
    },
  );

  assert.equal(started, true);
  assert.equal(readyVideo, video);
});

test("known ready media uses the shared live attachment path without querying", () => {
  const engine = {};
  const video = {};
  const calls = [];
  const context = {
    _engine: engine,
    _applyVideoFit: (media) => calls.push(["fit", media]),
    _liveViewResizeController: {
      attachMedia: (media) => calls.push(["resize", media]),
    },
    _liveVideoZoomController: {
      video,
      refresh: () => calls.push(["refresh"]),
    },
    _findFullscreenVideo: () => {
      throw new Error("ready media should not be queried again");
    },
    _findVideoDeep: () => {
      throw new Error("ready media should not be queried again");
    },
    _syncPictureInPictureButtons: () => calls.push(["pip"]),
  };

  FrigateViewCard.prototype._attachMainLiveVideoZoom.call(
    context,
    engine,
    video,
  );

  assert.deepEqual(calls, [
    ["fit", video],
    ["resize", video],
    ["refresh"],
    ["pip"],
  ]);
});
