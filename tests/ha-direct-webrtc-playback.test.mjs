import assert from "node:assert/strict";
import test from "node:test";

import { createHaDirectWebRtcPlayback } from "../src/integrations/home-assistant/webrtc-playback.js";

const createFakeVideo = () => ({
  style: {},
  dataset: {},
  classList: { add() {} },
  muted: true,
  defaultMuted: true,
  currentTime: 1,
  webkitDecodedFrameCount: 1,
  srcObject: null,
  setAttribute() {},
  removeAttribute() {},
  addEventListener() {},
  removeEventListener() {},
  play: () => Promise.resolve(),
  pause() {},
});

class FakeMediaStream {
  constructor() {
    this.tracks = [];
  }

  addTrack(track) {
    this.tracks.push(track);
  }

  getTracks() {
    return this.tracks;
  }

  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === "video");
  }
}

class FakePeerConnection {
  static instances = [];

  static initialCandidate = null;

  constructor(configuration) {
    this.configuration = configuration;
    this.connectionState = "new";
    this.iceConnectionState = "new";
    this.transceivers = [];
    this.closed = false;
    FakePeerConnection.instances.push(this);
  }

  addTransceiver(kind, options) {
    this.transceivers.push([kind, options]);
    return { stop() {} };
  }

  getTransceivers() {
    return [];
  }

  async createOffer() {
    return { type: "offer", sdp: "one-offer" };
  }

  async setLocalDescription() {
    if (FakePeerConnection.initialCandidate) {
      this.onicecandidate?.({ candidate: FakePeerConnection.initialCandidate });
    }
  }

  async setRemoteDescription() {}

  async addIceCandidate() {}

  close() {
    this.closed = true;
  }
}

const withMediaGlobals = async (run) => {
  const previousDocument = globalThis.document;
  const previousMediaStream = globalThis.MediaStream;
  const previousPeerConnection = globalThis.RTCPeerConnection;
  FakePeerConnection.instances = [];
  FakePeerConnection.initialCandidate = null;
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, "video");
      return createFakeVideo();
    },
  };
  globalThis.MediaStream = FakeMediaStream;
  globalThis.RTCPeerConnection = FakePeerConnection;
  try {
    await run();
  } finally {
    globalThis.document = previousDocument;
    globalThis.MediaStream = previousMediaStream;
    globalThis.RTCPeerConnection = previousPeerConnection;
  }
};

test("HA direct WebRTC owns exactly one non-resubscribing signaling subscription", async () => {
  await withMediaGlobals(async () => {
    const subscriptionCalls = [];
    let unsubscribeCalls = 0;
    const hass = {
      callWS: async (message) => {
        assert.deepEqual(message, {
          type: "camera/webrtc/get_client_config",
          entity_id: "camera.front",
        });
        return { configuration: { iceServers: [] } };
      },
      connection: {
        subscribeMessage(callback, message, options) {
          subscriptionCalls.push({ callback, message, options });
          return Promise.resolve(() => {
            unsubscribeCalls += 1;
          });
        },
      },
    };
    const playback = createHaDirectWebRtcPlayback({
      hass,
      entity: "camera.front",
      muted: true,
    });

    assert.equal(await playback.start(), true);
    assert.equal(subscriptionCalls.length, 1);
    assert.deepEqual(subscriptionCalls[0].message, {
      type: "camera/webrtc/offer",
      entity_id: "camera.front",
      offer: "one-offer",
    });
    assert.deepEqual(subscriptionCalls[0].options, { resubscribe: false });
    assert.deepEqual(FakePeerConnection.instances[0].transceivers, [
      ["audio", { direction: "recvonly" }],
      ["video", { direction: "recvonly" }],
    ]);

    await subscriptionCalls[0].callback({
      type: "answer",
      answer: "one-answer",
    });
    await playback.engine.destroy();

    assert.equal(unsubscribeCalls, 1);
    assert.equal(FakePeerConnection.instances[0].closed, true);
  });
});

test("HA direct WebRTC includes already gathered ICE candidates in its offer", async () => {
  await withMediaGlobals(async () => {
    FakePeerConnection.initialCandidate = {
      candidate: "candidate:fast-path",
      toJSON: () => ({
        candidate: "candidate:fast-path",
        sdpMid: "1",
      }),
    };
    const callWsPayloads = [];
    let offerCallback = null;
    let offerPayload = null;
    const hass = {
      callWS: async (message) => {
        callWsPayloads.push(message);
        if (message.type === "camera/webrtc/get_client_config") {
          return { configuration: { iceServers: [] } };
        }
        return null;
      },
      connection: {
        subscribeMessage(callback, message) {
          offerCallback = callback;
          offerPayload = message;
          return Promise.resolve(() => {});
        },
      },
    };
    const playback = createHaDirectWebRtcPlayback({
      hass,
      entity: "camera.front",
    });

    assert.equal(await playback.start(), true);
    assert.deepEqual(offerPayload, {
      type: "camera/webrtc/offer",
      entity_id: "camera.front",
      offer: "one-offera=candidate:fast-path\r\n",
    });
    await offerCallback({ type: "session", session_id: "ha-session-1" });
    assert.deepEqual(callWsPayloads, [
      {
        type: "camera/webrtc/get_client_config",
        entity_id: "camera.front",
      },
    ]);

    await offerCallback({ type: "answer", answer: "one-answer" });
    await playback.engine.destroy();
  });
});

test("HA direct WebRTC waits for provider startup before unsubscribing", async () => {
  await withMediaGlobals(async () => {
    let offerCallback = null;
    let unsubscribeCalls = 0;
    const hass = {
      callWS: async () => ({ configuration: { iceServers: [] } }),
      connection: {
        subscribeMessage(callback) {
          offerCallback = callback;
          return Promise.resolve(() => {
            unsubscribeCalls += 1;
          });
        },
      },
    };
    const playback = createHaDirectWebRtcPlayback({
      hass,
      entity: "camera.front",
    });

    assert.equal(await playback.start(), true);
    const shutdown = playback.engine.destroy();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(unsubscribeCalls, 0);
    offerCallback({ type: "answer", answer: "late-answer" });
    await shutdown;

    assert.equal(unsubscribeCalls, 1);
    assert.equal(FakePeerConnection.instances[0].closed, true);
  });
});

test("destroying a pending HA direct WebRTC mount prevents a stale subscription", async () => {
  await withMediaGlobals(async () => {
    let resolveConfig = null;
    const configPromise = new Promise((resolve) => {
      resolveConfig = resolve;
    });
    let subscriptionCalls = 0;
    const hass = {
      callWS: () => configPromise,
      connection: {
        subscribeMessage() {
          subscriptionCalls += 1;
          return Promise.resolve(() => {});
        },
      },
    };
    const playback = createHaDirectWebRtcPlayback({
      hass,
      entity: "camera.front",
    });
    const pendingStart = playback.start();

    playback.engine.destroy();
    resolveConfig({ configuration: { iceServers: [] } });

    assert.equal(await pendingStart, false);
    assert.equal(subscriptionCalls, 0);
    assert.equal(FakePeerConnection.instances.length, 0);
  });
});

test("HA direct WebRTC recovery ownership can move between card instances", async () => {
  await withMediaGlobals(async () => {
    let offerCallback = null;
    const lostReasons = [];
    const hass = {
      callWS: async () => ({ configuration: { iceServers: [] } }),
      connection: {
        subscribeMessage(callback) {
          offerCallback = callback;
          return Promise.resolve(() => {});
        },
      },
    };
    const playback = createHaDirectWebRtcPlayback({
      hass,
      entity: "camera.front",
      onConnectionLost: (reason) => lostReasons.push(["donor", reason]),
    });

    assert.equal(await playback.start(), true);
    await offerCallback({ type: "answer", answer: "one-answer" });
    playback.engine.markStarted();
    const peerConnection = FakePeerConnection.instances[0];

    playback.engine.deactivateRecovery();
    peerConnection.connectionState = "failed";
    peerConnection.onconnectionstatechange();
    assert.deepEqual(lostReasons, []);

    playback.engine.setRecoveryHandler((reason) =>
      lostReasons.push(["receiver", reason]),
    );
    playback.engine.activateRecovery();
    peerConnection.onconnectionstatechange();
    assert.deepEqual(lostReasons, [
      ["receiver", "webrtc-connection-lost"],
    ]);

    await playback.engine.destroy();
  });
});

test("HA direct WebRTC recovers when a connected peer stops delivering video", async () => {
  await withMediaGlobals(async () => {
    let nowMs = 1000;
    let nextTimerId = 0;
    const timers = new Map();
    const lostReasons = [];
    let offerCallback = null;
    const trackListeners = new Map();
    const videoTrack = {
      kind: "video",
      muted: false,
      readyState: "live",
      addEventListener(name, callback) {
        trackListeners.set(name, callback);
      },
      removeEventListener(name, callback) {
        if (trackListeners.get(name) === callback) trackListeners.delete(name);
      },
      stop() {},
    };
    const hass = {
      callWS: async () => ({ configuration: { iceServers: [] } }),
      connection: {
        subscribeMessage(callback) {
          offerCallback = callback;
          return Promise.resolve(() => {});
        },
      },
    };
    const playback = createHaDirectWebRtcPlayback({
      hass,
      entity: "camera.front",
      mediaStallMs: 100,
      now: () => nowMs,
      setTimer: (callback) => {
        const timerId = ++nextTimerId;
        timers.set(timerId, callback);
        return timerId;
      },
      clearTimer: (timerId) => timers.delete(timerId),
      onConnectionLost: (reason) => lostReasons.push(reason),
    });

    assert.equal(await playback.start(), true);
    await offerCallback({ type: "answer", answer: "one-answer" });
    const peerConnection = FakePeerConnection.instances[0];
    peerConnection.connectionState = "connected";
    peerConnection.iceConnectionState = "connected";
    peerConnection.ontrack({ track: videoTrack, streams: [] });
    playback.engine.markStarted();

    assert.equal(playback.engine.hasLiveVideoTrack(), true);
    assert.equal(playback.engine.hasRecentMediaActivity(), true);

    const runNextTimer = () => {
      const [timerId, callback] = timers.entries().next().value;
      timers.delete(timerId);
      callback();
    };
    nowMs = 1050;
    playback.engine.video.currentTime = 2;
    playback.engine.video.webkitDecodedFrameCount = 2;
    runNextTimer();
    assert.deepEqual(lostReasons, []);

    nowMs = 1160;
    runNextTimer();
    assert.deepEqual(lostReasons, ["webrtc-media-stalled"]);
    assert.equal(playback.engine.hasRecentMediaActivity(), false);

    await playback.engine.destroy();
  });
});
