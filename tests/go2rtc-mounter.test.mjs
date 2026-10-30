import { test } from "node:test";
import assert from "node:assert/strict";

import { HOME_ASSISTANT_STUN_SERVER } from "../src/constants.js";
import { createGo2RtcMounter } from "../src/features/live/go2rtc-mounter.js";
import { LiveAudioController } from "../src/features/live/audio.ctrl.js";

function createFakeVideoElement() {
  const attrs = new Map();
  const classSet = new Set();
  const style = { cssText: "" };
  const dataset = {};
  let classNameValue = "";
  const listeners = new Map();

  const syncClassName = () => {
    classNameValue = [...classSet].join(" ");
  };

  return {
    autoplay: false,
    playsInline: false,
    muted: false,
    defaultMuted: false,
    controls: false,
    preload: "",
    src: "",
    style,
    dataset,
    paused: false,
    readyState: 4,
    currentTime: 0,
    playbackRate: 1,
    playCalls: 0,
    loadCalls: 0,
    get className() {
      return classNameValue;
    },
    set className(value) {
      classSet.clear();
      const text = String(value || "").trim();
      if (text) {
        for (const token of text.split(/\s+/)) {
          classSet.add(token);
        }
      }
      syncClassName();
    },
    classList: {
      add(...tokens) {
        for (const token of tokens) {
          const next = String(token || "").trim();
          if (!next) continue;
          classSet.add(next);
        }
        syncClassName();
      },
    },
    setAttribute(name, value) {
      attrs.set(name, String(value));
    },
    removeAttribute(name) {
      attrs.delete(name);
      if (name === "src") this.src = "";
    },
    hasAttribute(name) {
      return attrs.has(name);
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    dispatchEvent(event) {
      listeners.get(event?.type)?.(event);
    },
    pause() {
      this.paused = true;
    },
    play() {
      this.playCalls += 1;
      this.paused = false;
      return Promise.resolve();
    },
    load() {
      this.loadCalls += 1;
    },
  };
}

function withFakeDocument(run) {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: (tag) => {
      if (String(tag).toLowerCase() !== "video") {
        throw new Error(`Unexpected tag: ${tag}`);
      }
      return createFakeVideoElement();
    },
  };
  return Promise.resolve()
    .then(() => run())
    .finally(() => {
      globalThis.document = previousDocument;
    });
}

function withFakeWindow(fakeWindow, run) {
  const previousWindow = globalThis.window;
  globalThis.window = fakeWindow;
  return Promise.resolve()
    .then(() => run())
    .finally(() => {
      globalThis.window = previousWindow;
    });
}

function withFakeObjectUrl(run) {
  const createDescriptor = Object.getOwnPropertyDescriptor(
    globalThis.URL,
    "createObjectURL",
  );
  const revokeDescriptor = Object.getOwnPropertyDescriptor(
    globalThis.URL,
    "revokeObjectURL",
  );
  const revoked = [];
  Object.defineProperty(globalThis.URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:managed-media-source",
  });
  Object.defineProperty(globalThis.URL, "revokeObjectURL", {
    configurable: true,
    value: (url) => revoked.push(url),
  });
  return Promise.resolve()
    .then(() => run(revoked))
    .finally(() => {
      if (createDescriptor) {
        Object.defineProperty(
          globalThis.URL,
          "createObjectURL",
          createDescriptor,
        );
      } else {
        delete globalThis.URL.createObjectURL;
      }
      if (revokeDescriptor) {
        Object.defineProperty(
          globalThis.URL,
          "revokeObjectURL",
          revokeDescriptor,
        );
      } else {
        delete globalThis.URL.revokeObjectURL;
      }
    });
}

function createSlot() {
  return {
    innerHTML: "occupied",
    appended: [],
    autoplayAtAppend: [],
    mutedAtAppend: [],
    appendChild(node) {
      this.appended.push(node);
      this.autoplayAtAppend.push(node.autoplay);
      this.mutedAtAppend.push(node.muted);
      this.lastChild = node;
    },
  };
}

const flushMicrotasks = async (count = 8) => {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
};

function createBaseMounter(overrides = {}) {
  const resolver = {
    resolveMountRequest: () => ({ entity: "camera.front" }),
    websocketUrlForEntity: async () => "ws://example.test/api/ws",
    ...(overrides.resolver || {}),
  };
  return createGo2RtcMounter({
    resolver,
    getStreamMuted: () => false,
    waitForStreamStart: async () => true,
    attachVideoFit: () => {},
    assignCommittedEngine: () => {},
    onCommittedStream: () => {},
    scheduleResumeLive: () => {},
    isFirefox: () => false,
    scopeKey: {},
    ...overrides,
    resolver,
  });
}

test("go2rtc mounter MSE path exits when no mount entity resolves", async () => {
  const slot = createSlot();
  let wsLookups = 0;
  const mounter = createBaseMounter({
    resolver: {
      resolveMountRequest: () => ({ entity: "" }),
      websocketUrlForEntity: async () => {
        wsLookups += 1;
        return "ws://should-not-run";
      },
    },
  });

  const result = await withFakeWindow({}, () => mounter.tryMountMse(slot));
  assert.equal(result, false);
  assert.equal(wsLookups, 0);
});

test("go2rtc targets selected MSE media before websocket URL resolution", async () => {
  await withFakeDocument(async () => {
    const abortController = new AbortController();
    let resolveWebSocketUrl;
    const pendingWebSocketUrl = new Promise((resolve) => {
      resolveWebSocketUrl = resolve;
    });
    const camera = { entity: "camera.front", start_unmuted: true };
    const host = {
      _activeCam: camera,
      _engine: null,
      _renderMuteButton() {},
      _findVideoDeep: (engine) => engine?.video,
    };
    const audio = new LiveAudioController(host, { interactionTarget: null });
    audio.prepareCameraStart(camera);
    const requests = [];
    const slot = createSlot();
    const mounter = createBaseMounter({
      resolver: {
        resolveMountRequest: () => ({
          entity: camera.entity,
          abortSignal: abortController.signal,
          commit: false,
        }),
        websocketUrlForEntity: () => pendingWebSocketUrl,
      },
      getStreamMuted: () => host._streamMuted,
      prepareSelectedPlayback: (video, options) =>
        audio.prepareSelectedPlayback(video, options),
      releasePreparedPlayback: (video) =>
        audio.releasePreparedPlayback(video),
      attachVideoFit: (video) => {
        video.readyState = 0;
        video.play = () => {
          requests.push({ muted: video.muted, src: video.src });
          return Promise.resolve();
        };
      },
    });
    class FakeMediaSource {
      static isTypeSupported() {
        return true;
      }
    }

    const mount = withFakeWindow(
      {
        WebSocket: class {},
        MediaSource: FakeMediaSource,
      },
      () => mounter.tryMountMse(slot),
    );
    await flushMicrotasks();

    assert.equal(slot.appended.length, 1);
    assert.equal(slot.autoplayAtAppend[0], false);
    assert.equal(slot.mutedAtAppend[0], true);
    assert.equal(slot.lastChild.muted, false);
    assert.equal(slot.lastChild.autoplay, false);
    assert.deepEqual(requests, [{ muted: false, src: "" }]);

    abortController.abort();
    resolveWebSocketUrl("ws://example.test/api/ws");
    assert.equal(await mount, false);
    audio.dispose();
  });
});

test("go2rtc mounter WebRTC path exits when browser support is unavailable", async () => {
  const slot = createSlot();
  let wsLookups = 0;
  const mounter = createBaseMounter({
    resolver: {
      websocketUrlForEntity: async () => {
        wsLookups += 1;
        return "ws://should-not-run";
      },
    },
  });

  const result = await withFakeWindow({}, () => mounter.tryMountWebRtc(slot));
  assert.equal(result, false);
  assert.equal(wsLookups, 0);
});

test("go2rtc targets selected WebRTC media before websocket URL resolution", async () => {
  await withFakeDocument(async () => {
    const abortController = new AbortController();
    let resolveWebSocketUrl;
    const pendingWebSocketUrl = new Promise((resolve) => {
      resolveWebSocketUrl = resolve;
    });
    const camera = { entity: "camera.front", start_unmuted: true };
    const host = {
      _activeCam: camera,
      _engine: null,
      _renderMuteButton() {},
      _findVideoDeep: (engine) => engine?.video,
    };
    const audio = new LiveAudioController(host, { interactionTarget: null });
    audio.prepareCameraStart(camera);
    const requests = [];
    const slot = createSlot();
    const mounter = createBaseMounter({
      resolver: {
        resolveMountRequest: () => ({
          entity: camera.entity,
          abortSignal: abortController.signal,
          commit: false,
        }),
        websocketUrlForEntity: () => pendingWebSocketUrl,
      },
      getStreamMuted: () => host._streamMuted,
      prepareSelectedPlayback: (video, options) =>
        audio.prepareSelectedPlayback(video, options),
      releasePreparedPlayback: (video) =>
        audio.releasePreparedPlayback(video),
      attachVideoFit: (video) => {
        video.readyState = 0;
        video.play = () => {
          requests.push({ muted: video.muted, srcObject: video.srcObject });
          return Promise.resolve();
        };
      },
    });

    const mount = withFakeWindow(
      {
        WebSocket: class {},
        RTCPeerConnection: class {},
      },
      () => mounter.tryMountWebRtc(slot),
    );
    await flushMicrotasks();

    assert.equal(slot.appended.length, 1);
    assert.equal(slot.autoplayAtAppend[0], false);
    assert.equal(slot.mutedAtAppend[0], true);
    assert.equal(slot.lastChild.muted, false);
    assert.equal(slot.lastChild.autoplay, false);
    assert.deepEqual(requests, [{ muted: false, srcObject: undefined }]);

    abortController.abort();
    resolveWebSocketUrl("ws://example.test/api/ws");
    assert.equal(await mount, false);
    audio.dispose();
  });
});

test("go2rtc mounter does not open WebRTC signaling after URL resolution was cancelled", async () => {
  await withFakeDocument(async () => {
    const abortController = new AbortController();
    let releaseUrl;
    let socketConstructions = 0;
    let peerConstructions = 0;
    class FakeWebSocket {
      constructor() {
        socketConstructions += 1;
      }
    }
    class FakePeerConnection {
      constructor() {
        peerConstructions += 1;
      }
    }
    const mounter = createBaseMounter({
      resolver: {
        resolveMountRequest: () => ({
          entity: "camera.front",
          abortSignal: abortController.signal,
        }),
        websocketUrlForEntity: async () =>
          await new Promise((resolve) => {
            releaseUrl = resolve;
          }),
      },
    });

    const result = await withFakeWindow(
      {
        WebSocket: FakeWebSocket,
        RTCPeerConnection: FakePeerConnection,
      },
      async () => {
        const mount = mounter.tryMountWebRtc(createSlot());
        await flushMicrotasks();
        abortController.abort();
        releaseUrl("ws://example.test/api/ws");
        return await mount;
      },
    );

    assert.equal(result, false);
    assert.equal(socketConstructions, 0);
    assert.equal(peerConstructions, 0);
  });
});

test("go2rtc mounter closes an in-flight WebRTC socket when cancelled", async () => {
  await withFakeDocument(async () => {
    const previousWebSocket = globalThis.WebSocket;
    const previousRtcPeerConnection = globalThis.RTCPeerConnection;
    const abortController = new AbortController();
    const sockets = [];
    let socketCloseCalls = 0;
    let peerCloseCalls = 0;
    class FakeWebSocket {
      static OPEN = 1;

      constructor() {
        this.readyState = 0;
        this._listeners = new Map();
        this.sent = [];
        sockets.push(this);
      }

      addEventListener(type, handler) {
        this._listeners.set(type, handler);
      }

      send(value) {
        this.sent.push(value);
      }

      close() {
        socketCloseCalls += 1;
        if (this.readyState === FakeWebSocket.OPEN) this.readyState = 3;
      }

      open() {
        this.readyState = FakeWebSocket.OPEN;
        this._listeners.get("open")?.();
      }
    }
    class FakePeerConnection {
      constructor() {
        this._listeners = new Map();
      }

      addTransceiver() {}

      addEventListener(type, handler) {
        this._listeners.set(type, handler);
      }

      getTransceivers() {
        return [];
      }

      async createOffer() {
        return { type: "offer", sdp: "late-offer" };
      }

      async setLocalDescription() {}

      close() {
        peerCloseCalls += 1;
      }
    }
    globalThis.WebSocket = FakeWebSocket;
    globalThis.RTCPeerConnection = FakePeerConnection;

    const mounter = createBaseMounter({
      resolver: {
        resolveMountRequest: () => ({
          entity: "camera.front",
          abortSignal: abortController.signal,
        }),
      },
      waitForStreamStart: async (_slot, _waitMs, options) =>
        await new Promise((resolve) => {
          options.abortSignal.addEventListener(
            "abort",
            () => resolve(false),
            { once: true },
          );
        }),
    });

    try {
      const result = await withFakeWindow(
        {
          WebSocket: FakeWebSocket,
          RTCPeerConnection: FakePeerConnection,
        },
        async () => {
          const mount = mounter.tryMountWebRtc(createSlot());
          await new Promise((resolve) => setImmediate(resolve));
          abortController.abort();
          return await mount;
        },
      );

      assert.equal(result, false);
      assert.equal(socketCloseCalls, 1);
      assert.equal(peerCloseCalls, 1);

      sockets[0].open();
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(socketCloseCalls, 2);
      assert.deepEqual(sockets[0].sent, []);
    } finally {
      globalThis.WebSocket = previousWebSocket;
      globalThis.RTCPeerConnection = previousRtcPeerConnection;
    }
  });
});

test("go2rtc mounter force-closes WebRTC signaling that never connects", async () => {
  await withFakeDocument(async () => {
    const previousWebSocket = globalThis.WebSocket;
    const previousRtcPeerConnection = globalThis.RTCPeerConnection;
    let socketCloseCalls = 0;
    let peerCloseCalls = 0;
    const sentMessages = [];

    class FakeWebSocket {
      static OPEN = 1;

      constructor() {
        this.readyState = 0;
        this._listeners = new Map();
        queueMicrotask(() => {
          this.readyState = FakeWebSocket.OPEN;
          this._listeners.get("open")?.();
        });
      }

      addEventListener(type, handler) {
        this._listeners.set(type, handler);
      }

      send(value) {
        sentMessages.push(JSON.parse(value));
      }

      close() {
        socketCloseCalls += 1;
        this.readyState = 3;
      }
    }

    class FakePeerConnection {
      constructor() {
        this.connectionState = "connecting";
        this.iceConnectionState = "checking";
        this._listeners = new Map();
      }

      addTransceiver() {}

      addEventListener(type, handler) {
        this._listeners.set(type, handler);
      }

      getTransceivers() {
        return [];
      }

      async createOffer() {
        return { type: "offer", sdp: "blocked-offer" };
      }

      async setLocalDescription() {}

      close() {
        peerCloseCalls += 1;
        this.connectionState = "closed";
      }
    }

    globalThis.WebSocket = FakeWebSocket;
    globalThis.RTCPeerConnection = FakePeerConnection;

    const mounter = createBaseMounter({
      resolver: {
        resolveMountRequest: (options) => ({
          entity: "camera.front",
          abortSignal: options.abortSignal || null,
          commit: false,
        }),
      },
      waitForStreamStart: async () => await new Promise(() => {}),
    });

    try {
      const result = await withFakeWindow(
        {
          WebSocket: FakeWebSocket,
          RTCPeerConnection: FakePeerConnection,
        },
        () =>
          mounter.tryMountWebRtc(createSlot(), null, {
            commit: false,
            negotiationTimeoutMs: 15,
          }),
      );

      assert.equal(result, false);
      assert.equal(
        sentMessages.some(({ type }) => type === "webrtc/offer"),
        true,
      );
      assert.equal(socketCloseCalls, 1);
      assert.equal(peerCloseCalls, 1);
    } finally {
      globalThis.WebSocket = previousWebSocket;
      globalThis.RTCPeerConnection = previousRtcPeerConnection;
    }
  });
});

test("go2rtc mounter uses ManagedMediaSource when classic MediaSource is unavailable", async () => {
  await withFakeDocument(async () => {
    await withFakeObjectUrl(async (revoked) => {
      const mediaSources = [];
      const sockets = [];
      const supportedTypeContexts = [];
      let releaseStartup = null;
      const recoveryReasons = [];

      class FakeSourceBuffer {
        constructor() {
          this.mode = "";
          this.updating = false;
          this.appended = [];
          this._listeners = new Map();
          this.buffered = {
            length: 1,
            start: () => 0,
            end: () => 20,
          };
        }

        addEventListener(type, handler) {
          this._listeners.set(type, handler);
        }

        appendBuffer(buffer) {
          this.appended.push(buffer);
        }
      }

      class FakeManagedMediaSource {
        static isTypeSupported(mime) {
          supportedTypeContexts.push(this);
          return /^video\/mp4; codecs=".+"$/.test(mime);
        }

        constructor() {
          this.readyState = "closed";
          this._listeners = new Map();
          this.sourceBuffers = [];
          mediaSources.push(this);
        }

        addEventListener(type, handler) {
          this._listeners.set(type, handler);
        }

        open() {
          this.readyState = "open";
          this._listeners.get("sourceopen")?.({ type: "sourceopen" });
        }

        addSourceBuffer(mime) {
          this.addedMime = mime;
          const sourceBuffer = new FakeSourceBuffer();
          this.sourceBuffers.push(sourceBuffer);
          return sourceBuffer;
        }
      }

      class FakeWebSocket {
        static OPEN = 1;

        constructor(url) {
          this.url = url;
          this.readyState = 0;
          this.sent = [];
          this._listeners = new Map();
          sockets.push(this);
        }

        addEventListener(type, handler) {
          this._listeners.set(type, handler);
        }

        send(value) {
          this.sent.push(value);
        }

        open() {
          this.readyState = FakeWebSocket.OPEN;
          this._listeners.get("open")?.({ type: "open" });
        }

        message(data) {
          this._listeners.get("message")?.({ type: "message", data });
        }

        close() {
          this.readyState = 3;
        }

        closeFromServer() {
          this.readyState = 3;
          this._listeners.get("close")?.({ type: "close" });
        }
      }

      const slot = createSlot();
      const mounter = createBaseMounter({
        waitForStreamStart: async (target, waitMs, opts) => {
          assert.equal(target, slot);
          assert.equal(waitMs, 8000);
          assert.equal(opts.requireReadyState, 3);
          return await new Promise((resolve) => {
            releaseStartup = resolve;
          });
        },
        scheduleResumeLive: (reason) => recoveryReasons.push(reason),
        nowMs: () => 500,
      });

      const result = await withFakeWindow(
        {
          ManagedMediaSource: FakeManagedMediaSource,
          WebSocket: FakeWebSocket,
        },
        async () => {
          const mountPromise = mounter.tryMountMse(slot);
          await new Promise((resolve) => setTimeout(resolve, 0));

          assert.equal(mediaSources.length, 1);
          assert.equal(sockets.length, 1);
          mediaSources[0].open();
          sockets[0].open();
          assert.equal(sockets[0].sent.length, 1);
          assert.equal(JSON.parse(sockets[0].sent[0]).type, "mse");

          sockets[0].message(
            JSON.stringify({ type: "mse", value: "avc1.640029" }),
          );
          const chunk = new ArrayBuffer(8);
          sockets[0].message(chunk);
          releaseStartup(true);
          return await mountPromise;
        },
      );

      assert.equal(result.ok, true);
      assert.equal(result.type, "mse");
      assert.equal(result.engine.type, "frigate_go2rtc");
      assert.equal(result.engine.streamType, "mse");
      assert.equal(result.engine.entity, "camera.front");
      assert.equal(slot.lastChild.playCalls >= 2, true);
      assert.equal(slot.lastChild.disableRemotePlayback, true);
      assert.equal(slot.lastChild.srcObject, mediaSources[0]);
      assert.equal(mediaSources[0].sourceBuffers.length, 1);
      assert.equal(mediaSources[0].sourceBuffers[0].appended.length, 1);
      assert.deepEqual(result.engine.getActivityState(), {
        connectedAt: 500,
        lastChunkAt: 500,
        chunkCount: 1,
      });
      assert.equal(result.engine.isReusable(), true);
      result.engine.resumeAtLiveEdge();
      assert.equal(slot.lastChild.currentTime, 19.25);
      sockets[0].closeFromServer();
      assert.equal(result.engine.isReusable(), false);
      assert.deepEqual(recoveryReasons, []);
      const reboundRecoveryReasons = [];
      let reboundChunks = 0;
      result.engine.setRecoveryHandler((reason) =>
        reboundRecoveryReasons.push(reason),
      );
      result.engine.setActivityHandler(() => {
        reboundChunks += 1;
      });
      sockets[0].message(new ArrayBuffer(4));
      assert.equal(reboundChunks, 1);
      result.engine.activateRecovery();
      sockets[0].closeFromServer();
      assert.deepEqual(recoveryReasons, []);
      assert.deepEqual(reboundRecoveryReasons, ["mse-ws-closed"]);
      assert.equal(
        supportedTypeContexts.every(
          (context) => context === FakeManagedMediaSource,
        ),
        true,
      );
      result.engine.destroy();
      assert.equal(slot.lastChild.srcObject, null);
      assert.deepEqual(revoked, []);
    });
  });
});

test("go2rtc mounter preserves classic MediaSource when both flavors exist", async () => {
  await withFakeDocument(async () => {
    await withFakeObjectUrl(async (revoked) => {
      let classicInstances = 0;
      let managedInstances = 0;

      class FakeMediaSource {
        static isTypeSupported() {
          return true;
        }

        constructor() {
          classicInstances += 1;
          this.readyState = "closed";
          this._listeners = new Map();
        }

        addEventListener(type, handler) {
          this._listeners.set(type, handler);
        }
      }

      class FakeManagedMediaSource extends FakeMediaSource {
        constructor() {
          super();
          classicInstances -= 1;
          managedInstances += 1;
        }
      }

      class FakeWebSocket {
        static OPEN = 1;

        constructor() {
          this.readyState = FakeWebSocket.OPEN;
          this._listeners = new Map();
        }

        addEventListener(type, handler) {
          this._listeners.set(type, handler);
        }

        send() {}

        close() {
          this.readyState = 3;
        }
      }

      const slot = createSlot();
      const mounter = createBaseMounter();
      const result = await withFakeWindow(
        {
          MediaSource: FakeMediaSource,
          ManagedMediaSource: FakeManagedMediaSource,
          WebSocket: FakeWebSocket,
        },
        () => mounter.tryMountMse(slot),
      );

      assert.equal(result.ok, true);
      assert.equal(classicInstances, 1);
      assert.equal(managedInstances, 0);
      assert.equal(slot.lastChild.src, "blob:managed-media-source");
      assert.equal(slot.lastChild.srcObject, null);
      assert.deepEqual(revoked, []);

      result.engine.destroy();
      assert.equal(slot.lastChild.srcObject, null);
      assert.deepEqual(revoked, ["blob:managed-media-source"]);
    });
  });
});

test("go2rtc WebRTC preloads offscreen then transfers the ready stream", async () => {
  const previousDocument = globalThis.document;
  const previousMediaStream = globalThis.MediaStream;
  const previousWebSocket = globalThis.WebSocket;
  const previousRtcPeerConnection = globalThis.RTCPeerConnection;
  const videos = [];
  const tracks = [
    { kind: "video", readyState: "live", stop() {} },
    { kind: "audio", readyState: "live", stop() {} },
  ];
  let peer = null;
  let readyNotifications = 0;

  class FakeMediaStream {
    constructor(initialTracks = []) {
      this._tracks = [...initialTracks];
    }

    getTracks() {
      return [...this._tracks];
    }

    addTrack(track) {
      this._tracks.push(track);
    }
  }

  class FakeWebSocket {
    static OPEN = 1;

    constructor() {
      this.readyState = FakeWebSocket.OPEN;
      this._listeners = new Map();
    }

    addEventListener(type, handler) {
      this._listeners.set(type, handler);
    }

    send() {}

    close() {
      this.readyState = 3;
      this._listeners.get("close")?.({ type: "close" });
    }
  }

  class FakePeerConnection {
    constructor() {
      this.connectionState = "connecting";
      this.iceConnectionState = "checking";
      this._listeners = new Map();
      peer = this;
    }

    addTransceiver() {
      return { stop() {} };
    }

    addEventListener(type, handler) {
      this._listeners.set(type, handler);
    }

    getReceivers() {
      return tracks.map((track) => ({ track }));
    }

    getTransceivers() {
      return [];
    }

    emit(type) {
      this._listeners.get(type)?.({ type });
    }

    async createOffer() {
      return { sdp: "sdp" };
    }

    async setLocalDescription() {}

    close() {}
  }

  globalThis.document = {
    createElement: () => {
      const video = createFakeVideoElement();
      videos.push(video);
      return video;
    },
  };
  globalThis.MediaStream = FakeMediaStream;
  globalThis.WebSocket = FakeWebSocket;
  globalThis.RTCPeerConnection = FakePeerConnection;

  try {
    const slot = createSlot();
    const mounter = createBaseMounter({
      resolver: {
        resolveMountRequest: () => ({
          entity: "camera.front",
          commit: false,
        }),
      },
      prepareSelectedPlayback: () => true,
      waitForStreamStart: async () => await new Promise(() => {}),
      notifySelectedPlaybackReady: (video) => {
        readyNotifications += 1;
        assert.equal(video, slot.lastChild);
        assert.ok(video.srcObject instanceof FakeMediaStream);
      },
    });

    const mount = withFakeWindow(
      {
        WebSocket: FakeWebSocket,
        RTCPeerConnection: FakePeerConnection,
      },
      () => mounter.tryMountWebRtc(slot, null, {
        commit: false,
        preloadOffscreen: true,
      }),
    );
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(videos.length, 2);
    const [visibleVideo, decodeVideo] = videos;
    assert.equal(visibleVideo.srcObject, undefined);
    peer.connectionState = "connected";
    peer.emit("connectionstatechange");
    assert.ok(decodeVideo.srcObject instanceof FakeMediaStream);
    assert.equal(visibleVideo.srcObject, undefined);

    decodeVideo.dispatchEvent({ type: "loadeddata" });
    const result = await mount;
    assert.equal(result.ok, true);
    assert.equal(result.type, "webrtc");
    assert.equal(visibleVideo.srcObject, result.engine.video.srcObject);
    assert.equal(decodeVideo.srcObject, null);
    assert.equal(readyNotifications, 1);
    result.engine.destroy();
  } finally {
    globalThis.document = previousDocument;
    globalThis.MediaStream = previousMediaStream;
    globalThis.WebSocket = previousWebSocket;
    globalThis.RTCPeerConnection = previousRtcPeerConnection;
  }
});

test("go2rtc mounter WebRTC releases completed signaling without remounting", async () => {
  await withFakeDocument(async () => {
    const previousWebSocket = globalThis.WebSocket;
    const previousRtcPeerConnection = globalThis.RTCPeerConnection;

    let closeCalls = 0;
    class FakeWebSocket {
      constructor() {
        this.readyState = 1;
        this._listeners = new Map();
      }

      addEventListener(type, handler) {
        this._listeners.set(type, handler);
      }

      send() {}

      close() {
        if (this.readyState >= 2) return;
        closeCalls += 1;
        this.readyState = 3;
        this._listeners.get("close")?.({ type: "close" });
      }
    }

    class FakePeerConnection {
      constructor(config) {
        this.config = config;
        this.connectionState = "new";
        this.iceConnectionState = "new";
        this._listeners = new Map();
      }

      addTransceiver() {}

      addEventListener(type, handler) {
        this._listeners.set(type, handler);
      }

      emit(type) {
        const handler = this._listeners.get(type);
        if (handler) handler({});
      }

      async createOffer() {
        return { sdp: "sdp" };
      }

      async setLocalDescription() {}

      async setRemoteDescription() {}

      async addIceCandidate() {}

      close() {}
    }

    globalThis.WebSocket = FakeWebSocket;
    globalThis.RTCPeerConnection = FakePeerConnection;

    let assignedEngine = null;
    const recoveryReasons = [];
    const reboundRecoveryReasons = [];
    const mounter = createBaseMounter({
      resolver: {
        resolveMountRequest: () => ({ entity: "camera.front", commit: true }),
      },
      assignCommittedEngine: (engine) => {
        assignedEngine = engine;
      },
      scheduleResumeLive: (reason) => recoveryReasons.push(reason),
      waitForStreamStart: async () => true,
    });

    try {
      const slot = createSlot();
      const result = await withFakeWindow(
        {
          WebSocket: FakeWebSocket,
          RTCPeerConnection: FakePeerConnection,
        },
        () => mounter.tryMountWebRtc(slot),
      );

      assert.equal(result, true);
      assert.ok(assignedEngine?.pc);
      assert.deepEqual(assignedEngine.pc.config.iceServers, [
        { urls: HOME_ASSISTANT_STUN_SERVER },
      ]);
      assignedEngine.pc.connectionState = "connected";
      assignedEngine.pc.emit("connectionstatechange");
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(closeCalls, 1);
      assert.equal(assignedEngine.signalingComplete, true);
      assert.deepEqual(recoveryReasons, []);
      assignedEngine.setRecoveryHandler((reason) =>
        reboundRecoveryReasons.push(reason),
      );
      assignedEngine.pc.connectionState = "disconnected";
      assignedEngine.pc.emit("connectionstatechange");
      assert.deepEqual(recoveryReasons, []);
      assert.deepEqual(reboundRecoveryReasons, ["webrtc-connection-lost"]);
      assignedEngine.destroy();
      assert.equal(closeCalls, 1);
    } finally {
      globalThis.WebSocket = previousWebSocket;
      globalThis.RTCPeerConnection = previousRtcPeerConnection;
    }
  });
});

test("go2rtc mounter WebRTC recovers from signaling loss before peer connection", async () => {
  await withFakeDocument(async () => {
    const previousWebSocket = globalThis.WebSocket;
    const previousRtcPeerConnection = globalThis.RTCPeerConnection;

    class FakeWebSocket {
      constructor() {
        this.readyState = 1;
        this._listeners = new Map();
      }

      addEventListener(type, handler) {
        this._listeners.set(type, handler);
      }

      send() {}

      close() {
        this.readyState = 3;
      }

      emitClose() {
        this.readyState = 3;
        this._listeners.get("close")?.({ type: "close" });
      }
    }

    class FakePeerConnection {
      constructor() {
        this.connectionState = "connecting";
        this.iceConnectionState = "checking";
        this._listeners = new Map();
      }

      addTransceiver() {}

      addEventListener(type, handler) {
        this._listeners.set(type, handler);
      }

      async createOffer() {
        return { sdp: "sdp" };
      }

      async setLocalDescription() {}

      async setRemoteDescription() {}

      async addIceCandidate() {}

      close() {}
    }

    globalThis.WebSocket = FakeWebSocket;
    globalThis.RTCPeerConnection = FakePeerConnection;

    let assignedEngine = null;
    const recoveryReasons = [];
    const mounter = createBaseMounter({
      resolver: {
        resolveMountRequest: () => ({ entity: "camera.front", commit: true }),
      },
      assignCommittedEngine: (engine) => {
        assignedEngine = engine;
      },
      scheduleResumeLive: (reason) => recoveryReasons.push(reason),
      waitForStreamStart: async () => true,
    });

    try {
      const result = await withFakeWindow(
        {
          WebSocket: FakeWebSocket,
          RTCPeerConnection: FakePeerConnection,
        },
        () => mounter.tryMountWebRtc(createSlot()),
      );

      assert.equal(result, true);
      assignedEngine.ws.emitClose();
      assert.deepEqual(recoveryReasons, ["webrtc-ws-closed"]);
      assignedEngine.destroy();
    } finally {
      globalThis.WebSocket = previousWebSocket;
      globalThis.RTCPeerConnection = previousRtcPeerConnection;
    }
  });
});

test("go2rtc talk mounting uses one peer for microphone, video, and camera audio", async () => {
  await withFakeDocument(async () => {
    const previousWebSocket = globalThis.WebSocket;
    const previousRtcPeerConnection = globalThis.RTCPeerConnection;
    const transceivers = [];
    let assignedEngine = null;
    let microphoneStopCalls = 0;
    let talkEndedCalls = 0;
    const microphoneTrack = {
      addEventListener() {},
      stop() {
        microphoneStopCalls += 1;
      },
    };
    const microphoneStream = {
      getAudioTracks: () => [microphoneTrack],
      getTracks: () => [microphoneTrack],
    };

    class FakeWebSocket {
      static OPEN = 1;

      constructor() {
        this.readyState = FakeWebSocket.OPEN;
        this._listeners = new Map();
      }

      addEventListener(type, handler) {
        this._listeners.set(type, handler);
      }

      send() {}

      close() {
        this.readyState = 3;
      }
    }

    class FakePeerConnection {
      constructor() {
        this.connectionState = "new";
        this.iceConnectionState = "new";
        this._listeners = new Map();
      }

      addTransceiver(trackOrKind, options) {
        transceivers.push([trackOrKind, options]);
        return { stop() {} };
      }

      addEventListener(type, handler) {
        this._listeners.set(type, handler);
      }

      emit(type) {
        this._listeners.get(type)?.({});
      }

      getTransceivers() {
        return [];
      }

      async createOffer() {
        return { sdp: "sdp" };
      }

      async setLocalDescription() {}

      async setRemoteDescription() {}

      async addIceCandidate() {}

      close() {}
    }

    globalThis.WebSocket = FakeWebSocket;
    globalThis.RTCPeerConnection = FakePeerConnection;
    const mounter = createBaseMounter({
      resolver: {
        resolveMountRequest: () => ({ entity: "camera.front", commit: true }),
      },
      assignCommittedEngine: (engine) => {
        assignedEngine = engine;
      },
      waitForStreamStart: async () => true,
    });

    try {
      const result = await withFakeWindow(
        {
          WebSocket: FakeWebSocket,
          RTCPeerConnection: FakePeerConnection,
        },
        () =>
          mounter.tryMountWebRtc(createSlot(), null, {
            microphoneStream,
            onEnded: () => {
              talkEndedCalls += 1;
            },
          }),
      );

      assert.equal(result, true);
      assert.deepEqual(transceivers, [
        [
          microphoneTrack,
          { direction: "sendonly", streams: [microphoneStream] },
        ],
        ["video", { direction: "recvonly" }],
        ["audio", { direction: "recvonly" }],
      ]);
      assert.equal(assignedEngine.microphoneStream, microphoneStream);

      assignedEngine.pc.connectionState = "disconnected";
      assignedEngine.pc.emit("connectionstatechange");
      assert.equal(talkEndedCalls, 1);
      assert.equal(microphoneStopCalls, 1);
    } finally {
      assignedEngine?.destroy?.();
      globalThis.WebSocket = previousWebSocket;
      globalThis.RTCPeerConnection = previousRtcPeerConnection;
    }
  });
});
