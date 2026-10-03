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
    error: null,
    currentTime: 12,
    videoWidth: 1920,
    webkitDecodedFrameCount: 24,
    playCalls: 0,
    pauseCalls: 0,
    paused: false,
    play() {
      this.playCalls += 1;
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      this.pauseCalls += 1;
      this.paused = true;
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    emit(type) {
      listeners.get(type)?.();
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
  const resumeReasons = [];
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
    scheduleResumeLive: (reason) => resumeReasons.push(reason),
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
  assert.equal(waitOptions.requireReadyState, 2);
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

  video.emit("error");
  assert.deepEqual(resumeReasons, ["hls-error"]);

  mounter.release(video);
  assert.equal(video.destroyCalls, 1);
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
  assert.equal(video.pauseCalls, 0);

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
    waitForStreamStart: async (_engine, _waitMs, options) => {
      options.onVideoReady(video);
      return true;
    },
    assignCommittedEngine: (engine) => {
      receiverEngine = engine;
      receiverCalls.push(["assign", engine]);
    },
    onCommittedMediaReady: (...args) => receiverCalls.push(["media", ...args]),
    onCommittedStream: (type) => receiverCalls.push(["stream", type]),
    applyResolvedStreamUiState: (state) =>
      receiverCalls.push(["ui", state]),
  });

  assert.equal(receiver.adoptRetainedEngine(receiverSlot, video), true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(receiverSlot.child, video);
  assert.equal(video.muted, false);
  assert.equal(video.playCalls, 1);
  assert.deepEqual(receiverCalls[0], ["assign", video]);
  assert.deepEqual(receiverCalls[1], [
    "ui",
    {
      loading: true,
      fallbackVisible: true,
      refreshFallbackImage: true,
    },
  ]);
  assert.equal(
    receiverCalls.some(
      ([name, type]) => name === "stream" && type === "hls",
    ),
    true,
  );
  assert.deepEqual(
    receiverCalls.find(([name]) => name === "media"),
    ["media", video, video],
  );
  assert.equal(receiver.detachForHandoff(video), true);
  assert.equal(receiver.adoptRetainedEngine(receiverSlot, video), true);
});

test("Catalyst native HLS stays live while retained and reuses without a progress watchdog", async () => {
  const video = createVideo();
  let currentEngine = video;
  const resumeReasons = [];
  const uiStates = [];
  const fallbackRefreshOptions = [];
  const pendingStreams = [];
  const mounter = createCatalystHlsMounter({
    getHass: () => ({
      states: { "camera.front": { entity_id: "camera.front" } },
    }),
    getStreamMuted: () => true,
    getRotateOverlayActive: () => false,
    isCurrentEngine: (engine) => engine === currentEngine,
    waitForStreamStart: async () => {
      throw new Error("retained live HLS must not run a progress watchdog");
    },
    assignCommittedEngine: (engine) => {
      currentEngine = engine;
    },
    onCommittedMediaReady: () => {},
    onCommittedStream: () => {},
    onPendingStream: () => pendingStreams.push("pending"),
    applyResolvedStreamUiState: (state) => uiStates.push(state),
    startLoadingFallbackRefresh: (options) => {
      fallbackRefreshOptions.push(options);
      return () => {};
    },
    scheduleResumeLive: (reason) => resumeReasons.push(reason),
  });

  video.type = "ha_direct";
  video.streamType = "hls";
  video.catalystHls = true;
  assert.equal(mounter.suspendRetainedEngine(video), true);
  assert.equal(video.catalystDormant, true);
  assert.equal(video.autoplay, true);
  assert.equal(video.preload, "auto");
  assert.equal(video.pauseCalls, 0);
  assert.equal(video.playCalls, 1);

  const slot = {
    innerHTML: "occupied",
    appendChild(node) {
      this.child = node;
    },
  };
  assert.equal(mounter.adoptRetainedEngine(slot, video), true);
  assert.equal(video.catalystDormant, false);
  assert.equal(video.autoplay, true);
  assert.equal(video.preload, "auto");
  assert.equal(video.playCalls, 2);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(resumeReasons, []);
  assert.deepEqual(pendingStreams, ["pending"]);
  assert.deepEqual(fallbackRefreshOptions, [
    { preserveRenderedFrame: true },
  ]);
  assert.deepEqual(uiStates[0], {
    loading: true,
    fallbackVisible: true,
    refreshFallbackImage: true,
  });

  video.emit("error");
  assert.deepEqual(resumeReasons, ["hls-error"]);
});

test("Catalyst only replaces a retained live player after a real media failure", async () => {
  const video = createVideo();
  let currentEngine = video;
  const resumeReasons = [];
  const streamTypes = [];
  const uiStates = [];
  const mounter = createCatalystHlsMounter({
    getHass: () => ({
      states: { "camera.front": { entity_id: "camera.front" } },
    }),
    getStreamMuted: () => true,
    getRotateOverlayActive: () => false,
    isCurrentEngine: (engine) => engine === currentEngine,
    waitForStreamStart: async () => {
      throw new Error("retained live HLS must not run a progress watchdog");
    },
    assignCommittedEngine: (engine) => {
      currentEngine = engine;
    },
    onCommittedMediaReady: () => {},
    onCommittedStream: (type) => streamTypes.push(type),
    applyResolvedStreamUiState: (state) => uiStates.push(state),
    startLoadingFallbackRefresh: () => () => {},
    stopLoadingFallbackRefresh: () => {},
    scheduleResumeLive: (reason) => resumeReasons.push(reason),
  });

  video.type = "ha_direct";
  video.streamType = "hls";
  video.catalystHls = true;
  const slot = {
    innerHTML: "occupied",
    appendChild(node) {
      this.child = node;
    },
  };

  assert.equal(mounter.adoptRetainedEngine(slot, video), true);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(streamTypes, ["hls"]);
  assert.deepEqual(resumeReasons, []);
  video.emit("error");
  assert.deepEqual(streamTypes, ["hls", "snapshot"]);
  assert.deepEqual(resumeReasons, ["hls-error"]);
  assert.deepEqual(uiStates.at(-1), {
    loading: false,
    fallbackVisible: true,
    refreshFallbackImage: true,
  });
});

test("Catalyst warms remaining HA Direct cameras sequentially after two paint frames", async () => {
  const originalDocument = globalThis.document;
  const frames = [];
  const createdEntities = [];
  const retainedEntities = new Set();
  const waitResolvers = new Map();
  const preloadHost = {
    appendChild(node) {
      this.child = node;
      node.parentElement = this;
    },
  };
  globalThis.document = {
    createElement() {
      return {
        style: { cssText: "" },
        setAttribute() {},
        appendChild(node) {
          this.child = node;
          node.parentElement = this;
        },
        remove() {},
      };
    },
  };

  try {
    let currentEngine = null;
    const activeVideo = createVideo();
    const mounter = createCatalystHlsMounter({
      getHass: () => ({
        states: {
          "camera.front": {},
          "camera.driveway": {},
          "camera.porch": {},
        },
      }),
      getStreamMuted: () => true,
      getRotateOverlayActive: () => false,
      isCurrentEngine: (engine) => engine === currentEngine,
      waitForStreamStart: async (engine, _waitMs, options) => {
        if (engine === activeVideo) {
          options.onVideoReady?.(engine);
          return true;
        }
        return await new Promise((resolve) => {
          waitResolvers.set(engine.catalystEntity, resolve);
        });
      },
      assignCommittedEngine: (engine) => {
        currentEngine = engine;
      },
      onCommittedMediaReady: () => {},
      onCommittedStream: () => {},
      applyResolvedStreamUiState: () => {},
      createHlsVideo: ({ entity }) => {
        createdEntities.push(entity);
        return entity === "camera.front" ? activeVideo : createVideo();
      },
      getPreloadEntities: () => [
        "camera.front",
        "camera.driveway",
        "camera.porch",
      ],
      getActiveEntity: () => "camera.front",
      getPreloadHost: () => preloadHost,
      shouldPreload: () => true,
      hasRetainedEngine: (entity) => retainedEntities.has(entity),
      retainPreloadedEngine: (entity) => {
        retainedEntities.add(entity);
        return true;
      },
      requestFrame: (callback) => {
        frames.push(callback);
        return frames.length;
      },
      cancelFrame: () => {},
    });
    const slot = {
      innerHTML: "",
      appendChild(node) {
        this.child = node;
      },
    };
    const mounted = await mounter.tryMount(slot, null, {
      entity: "camera.front",
      commit: true,
    });
    assert.equal(await mounted.startupReady, true);
    assert.deepEqual(createdEntities, ["camera.front"]);
    assert.equal(frames.length, 1);

    frames.shift()();
    assert.equal(frames.length, 1);
    frames.shift()();
    await Promise.resolve();
    assert.deepEqual(createdEntities, ["camera.front", "camera.driveway"]);
    assert.equal(preloadHost.child.style.cssText.includes("width:100%"), true);
    assert.equal(preloadHost.child.style.cssText.includes("height:100%"), true);
    assert.equal(preloadHost.child.style.cssText.includes("opacity:0"), false);
    assert.equal(
      preloadHost.child.style.cssText.includes("left:-9999px"),
      false,
    );
    assert.equal(createdEntities.includes("camera.porch"), false);

    waitResolvers.get("camera.driveway")(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(retainedEntities.has("camera.driveway"), true);
    assert.deepEqual(createdEntities, [
      "camera.front",
      "camera.driveway",
      "camera.porch",
    ]);

    waitResolvers.get("camera.porch")(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(retainedEntities.has("camera.porch"), true);
  } finally {
    globalThis.document = originalDocument;
  }
});

test("Catalyst promotes a selected camera that is still warming without opening a duplicate HLS stream", async () => {
  const originalDocument = globalThis.document;
  const frames = [];
  const videos = new Map();
  const waitCounts = new Map();
  globalThis.document = {
    createElement() {
      return {
        style: { cssText: "" },
        setAttribute() {},
        appendChild(node) {
          this.child = node;
          node.parentElement = this;
        },
        remove() {},
      };
    },
  };

  try {
    let currentEngine = null;
    let activeEntity = "camera.front";
    const mounter = createCatalystHlsMounter({
      getHass: () => ({
        states: { "camera.front": {}, "camera.driveway": {} },
      }),
      getStreamMuted: () => true,
      getRotateOverlayActive: () => false,
      isCurrentEngine: (engine) => engine === currentEngine,
      waitForStreamStart: async (engine, _waitMs, options) => {
        const count = (waitCounts.get(engine) || 0) + 1;
        waitCounts.set(engine, count);
        if (engine.catalystEntity === "camera.driveway" && count === 1) {
          return await new Promise((resolve) => {
            options.abortSignal?.addEventListener?.("abort", () =>
              resolve(false),
            );
          });
        }
        options.onVideoReady?.(engine);
        return true;
      },
      assignCommittedEngine: (engine) => {
        currentEngine = engine;
      },
      onCommittedMediaReady: () => {},
      onCommittedStream: () => {},
      applyResolvedStreamUiState: () => {},
      createHlsVideo: ({ entity }) => {
        const video = createVideo();
        videos.set(entity, [...(videos.get(entity) || []), video]);
        return video;
      },
      getPreloadEntities: () => ["camera.front", "camera.driveway"],
      getActiveEntity: () => activeEntity,
      getPreloadHost: () => ({ appendChild() {} }),
      shouldPreload: () => true,
      hasRetainedEngine: () => false,
      retainPreloadedEngine: () => true,
      requestFrame: (callback) => {
        frames.push(callback);
        return frames.length;
      },
      cancelFrame: () => {},
    });
    const frontSlot = {
      innerHTML: "",
      appendChild(node) {
        this.child = node;
      },
    };
    const frontMount = await mounter.tryMount(frontSlot, null, {
      entity: "camera.front",
      commit: true,
    });
    assert.equal(await frontMount.startupReady, true);
    frames.shift()();
    frames.shift()();
    await Promise.resolve();
    assert.equal(videos.get("camera.driveway")?.length, 1);

    activeEntity = "camera.driveway";
    const drivewaySlot = {
      innerHTML: "",
      appendChild(node) {
        this.child = node;
      },
    };
    const drivewayMount = await mounter.tryMount(drivewaySlot, null, {
      entity: "camera.driveway",
      commit: true,
    });
    assert.equal(await drivewayMount.startupReady, true);
    assert.equal(videos.get("camera.driveway")?.length, 1);
    assert.equal(
      drivewaySlot.child,
      videos.get("camera.driveway")[0],
    );
    assert.equal(videos.get("camera.driveway")[0].destroyCalls, 0);
    mounter.cancelPreloads();
  } finally {
    globalThis.document = originalDocument;
  }
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
