import assert from "node:assert/strict";
import test from "node:test";

import {
  HA_LOW_LATENCY_HLS_CONFIG,
  createHaLowLatencyHlsVideoElement,
  ensureHaLowLatencyHlsPlayback,
} from "../src/integrations/home-assistant/low-latency-hls.js";

const createVideo = () => ({
  style: { cssText: "", objectFit: "" },
  pauseCalls: 0,
  loadCalls: 0,
  removedSource: false,
  pause() {
    this.pauseCalls += 1;
  },
  load() {
    this.loadCalls += 1;
  },
  removeAttribute(name) {
    if (name === "src") this.removedSource = true;
  },
});

test("HA Catalyst HLS explicitly enables low-latency HLS.js", async () => {
  const previousDocument = globalThis.document;
  const calls = [];
  const video = createVideo();
  class FakeHls {
    static isSupported() {
      return true;
    }

    constructor(config) {
      this.config = config;
      calls.push(["construct", config]);
    }

    loadSource(url) {
      calls.push(["source", url]);
    }

    attachMedia(media) {
      calls.push(["attach", media]);
    }

    destroy() {
      calls.push(["destroy"]);
    }
  }
  globalThis.document = {
    createElement: (tagName) => {
      assert.equal(tagName, "video");
      return video;
    },
  };

  try {
    const result = createHaLowLatencyHlsVideoElement({
      hass: {
        callWS: async (message) => {
          calls.push(["ws", message]);
          return { url: "/api/hls/test/master_playlist.m3u8" };
        },
        hassUrl: (path) => `https://ha.example${path}`,
      },
      entity: "camera.front",
      muted: true,
      defaultMuted: true,
      fitMode: "contain",
      styleText: "width:100%",
      loadHlsCtor: async () => FakeHls,
    });

    assert.equal(await result.hlsUrlReady, true);
    assert.equal(result, video);
    assert.equal(video.autoplay, true);
    assert.equal(video.playsInline, true);
    assert.equal(video.muted, true);
    assert.equal(video.defaultMuted, true);
    assert.equal(video.preload, "auto");
    assert.equal(video.style.cssText, "width:100%");
    assert.equal(video.style.objectFit, "contain");
    assert.equal(video.catalystHlsPlaybackMode, "ll-hls-js");
    assert.deepEqual(calls[0], [
      "ws",
      {
        type: "camera/stream",
        entity_id: "camera.front",
        format: "hls",
      },
    ]);
    assert.deepEqual(calls[1], [
      "construct",
      HA_LOW_LATENCY_HLS_CONFIG,
    ]);
    assert.deepEqual(calls[2], [
      "source",
      "https://ha.example/api/hls/test/master_playlist.m3u8",
    ]);
    assert.deepEqual(calls[3], ["attach", video]);

    video.destroy();
    assert.deepEqual(calls.at(-1), ["destroy"]);
    assert.equal(video.pauseCalls, 1);
    assert.equal(video.removedSource, true);
    assert.equal(video.loadCalls, 1);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("HA Catalyst HLS retains native playback when HLS.js is unavailable", async () => {
  const previousDocument = globalThis.document;
  const video = createVideo();
  globalThis.document = { createElement: () => video };

  try {
    const result = createHaLowLatencyHlsVideoElement({
      hass: {
        callWS: async () => ({ url: "/api/hls/native.m3u8" }),
        hassUrl: (path) => `https://ha.example${path}`,
      },
      entity: "camera.front",
      loadHlsCtor: async () => null,
    });

    assert.equal(await result.hlsUrlReady, true);
    assert.equal(video.catalystHlsPlaybackMode, "native-hls");
    assert.equal(video.src, "https://ha.example/api/hls/native.m3u8");
  } finally {
    globalThis.document = previousDocument;
  }
});

test("HA Catalyst HLS loader uses the local integrity-pinned asset", async () => {
  const script = { removeCalls: 0, remove() { this.removeCalls += 1; } };
  const LoadedHls = class {};
  const windowRef = {};
  const preparation = ensureHaLowLatencyHlsPlayback({
    resolveHlsJsUrl: () =>
      "https://ha.example/local/frigate-view-card-hls-1.5.17.js",
    documentRef: {
      createElement: (tagName) => {
        assert.equal(tagName, "script");
        return script;
      },
      head: {
        appendChild(node) {
          windowRef.Hls = LoadedHls;
          node.onload();
        },
      },
    },
    windowRef,
  });

  assert.equal(await preparation, LoadedHls);
  assert.equal(
    script.src,
    "https://ha.example/local/frigate-view-card-hls-1.5.17.js",
  );
  assert.match(script.integrity, /^sha384-/);
  assert.equal(script.crossOrigin, "anonymous");
  assert.equal(script.referrerPolicy, "no-referrer");
  assert.equal(script.removeCalls, 1);
});
