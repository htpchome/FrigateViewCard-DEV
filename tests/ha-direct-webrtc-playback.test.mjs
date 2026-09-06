import assert from "node:assert/strict";
import test from "node:test";

import { createHaDirectWebRtcPlayback } from "../src/integrations/home-assistant/webrtc-playback.js";

const createFakeVideo = () => ({
  style: {},
  dataset: {},
  classList: { add() {} },
  muted: true,
  defaultMuted: true,
  srcObject: null,
  setAttribute() {},
  removeAttribute() {},
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
