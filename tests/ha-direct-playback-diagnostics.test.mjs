import assert from "node:assert/strict";
import test from "node:test";

import {
  createHaDirectPlaybackDiagnostic,
  HA_DIRECT_DIAGNOSTICS_STORAGE_KEY,
  isHaDirectDiagnosticsEnabled,
  watchHaHlsStartupDiagnostic,
} from "../src/integrations/home-assistant/playback-diagnostics.js";

test("HA Direct diagnostics stay disabled unless explicitly enabled", () => {
  const storage = { getItem: () => null };
  const target = {};

  assert.equal(isHaDirectDiagnosticsEnabled({ storage, target }), false);
  const diagnostic = createHaDirectPlaybackDiagnostic(
    { entity: "camera.front" },
    { storage, target },
  );
  assert.equal(diagnostic.enabled, false);
});

test("HA Direct diagnostics record safe relative timing and export attempts", () => {
  let elapsed = 100;
  const messages = [];
  const marks = [];
  const storage = {
    getItem: (key) =>
      key === HA_DIRECT_DIAGNOSTICS_STORAGE_KEY ? "1" : null,
  };
  const target = {};
  const diagnostic = createHaDirectPlaybackDiagnostic(
    {
      entity: "camera.front",
      requestedStreamType: "webrtc",
    },
    {
      storage,
      target,
      now: () => elapsed,
      wallClock: () => "2026-09-29T00:00:00.000Z",
      performanceApi: { mark: (name) => marks.push(name) },
      logger: { info: (...args) => messages.push(args) },
    },
  );

  elapsed = 112.34;
  diagnostic.mark("client-config", {
    ready: true,
    ignoredObject: { token: "secret" },
  });
  elapsed = 140;
  diagnostic.finish("ready", { transport: "hls" });
  diagnostic.finish("ignored");

  assert.equal(diagnostic.enabled, true);
  assert.equal(target.__fvcHaDirectDiagnostics.attempts.length, 1);
  assert.deepEqual(target.__fvcHaDirectDiagnostics.attempts[0], {
    id: diagnostic.attemptId,
    entity: "camera.front",
    requestedStreamType: "webrtc",
    startedAt: "2026-09-29T00:00:00.000Z",
    status: "ready",
    marks: [
      { atMs: 0, stage: "attempt-start" },
      { atMs: 12.3, stage: "client-config", ready: true },
      {
        atMs: 40,
        stage: "attempt-finished",
        status: "ready",
        transport: "hls",
      },
    ],
  });
  assert.equal(
    JSON.parse(target.__fvcHaDirectDiagnostics.export())[0].status,
    "ready",
  );
  assert.equal(messages.length, 3);
  assert.equal(marks.length, 3);
});

test("HA Direct diagnostics can be enabled without storage for Chrome", () => {
  const target = { __FVC_HA_DIRECT_DIAGNOSTICS__: true };
  assert.equal(
    isHaDirectDiagnosticsEnabled({
      storage: { getItem: () => null },
      target,
    }),
    true,
  );
});

test("HA Direct diagnostics assign attempt IDs without mutable module state", () => {
  const target = { __FVC_HA_DIRECT_DIAGNOSTICS__: true };
  const options = {
    target,
    storage: { getItem: () => null },
    now: () => 0,
    logger: { info: () => {} },
  };

  const first = createHaDirectPlaybackDiagnostic({}, options);
  const second = createHaDirectPlaybackDiagnostic({}, options);

  assert.equal(first.attemptId, 1);
  assert.equal(second.attemptId, 2);
  target.__fvcHaDirectDiagnostics.clear();
  assert.equal(
    createHaDirectPlaybackDiagnostic({}, options).attemptId,
    1,
  );
});

test("HA HLS startup diagnostics record player, resource, and video milestones", () => {
  const createEventTarget = () => {
    const listeners = new Map();
    return {
      addEventListener(type, handler) {
        const handlers = listeners.get(type) || new Set();
        handlers.add(handler);
        listeners.set(type, handlers);
      },
      removeEventListener(type, handler) {
        listeners.get(type)?.delete(handler);
      },
      dispatch(type, detail) {
        for (const handler of listeners.get(type) || []) {
          handler({ type, detail });
        }
      },
      listenerCount(type) {
        return listeners.get(type)?.size || 0;
      },
    };
  };
  const player = createEventTarget();
  const video = Object.assign(createEventTarget(), {
    readyState: 0,
    networkState: 2,
    currentTime: 0,
    videoWidth: 0,
    videoHeight: 0,
    paused: true,
    error: null,
  });
  const marks = [];
  let intervalCallback = null;
  let clearedInterval = null;
  let resources = [
    {
      name: "https://example.test/api/hls/old/master_playlist.m3u8",
      startTime: 1,
      duration: 900,
      transferSize: 999,
    },
  ];
  const cleanup = watchHaHlsStartupDiagnostic({
    player,
    diagnostic: {
      enabled: true,
      mark: (stage, detail) => marks.push({ stage, detail }),
    },
    resolveVideo: () => video,
    performanceApi: { getEntriesByType: () => resources },
    setIntervalFn: (callback) => {
      intervalCallback = callback;
      return 42;
    },
    clearIntervalFn: (id) => {
      clearedInterval = id;
    },
  });

  resources = [
    ...resources,
    {
      name: "https://example.test/api/hls/token/master_playlist.m3u8",
      startTime: 5,
      duration: 18.24,
      transferSize: 321,
    },
  ];
  intervalCallback();
  player.dispatch("streams", { hasAudio: true, hasVideo: true });
  video.readyState = 2;
  video.videoWidth = 1920;
  video.videoHeight = 1080;
  video.dispatch("loadeddata");
  video.dispatch("loadeddata");
  video.paused = false;
  video.currentTime = 0.12;
  video.dispatch("playing");
  cleanup();

  assert.deepEqual(
    marks.map(({ stage }) => stage),
    [
      "hls-video-discovered",
      "hls-resource-finished",
      "hls-player-streams-event",
      "hls-video-loadeddata",
      "hls-video-playing",
    ],
  );
  assert.deepEqual(marks[1].detail, {
    resourceType: "master-playlist",
    durationMs: 18.2,
    transferSize: 321,
  });
  assert.equal(clearedInterval, 42);
  assert.equal(player.listenerCount("streams"), 0);
  assert.equal(video.listenerCount("playing"), 0);
});
