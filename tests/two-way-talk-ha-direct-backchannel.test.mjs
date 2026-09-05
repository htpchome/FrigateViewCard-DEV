import { test } from "node:test";
import assert from "node:assert/strict";

import { createHaDirectTwoWayTalkBackchannel } from "../src/integrations/home-assistant/two-way-talk-backchannel.js";

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(
      type,
      listeners.filter((candidate) => candidate !== listener),
    );
  }

  emit(type, detail = {}) {
    const event = { ...detail, currentTarget: this, target: this };
    for (const listener of this.listeners.get(type) || []) {
      listener(event);
    }
  }
}

class FakePeerConnection extends FakeEventTarget {
  constructor(configuration) {
    super();
    this.configuration = configuration;
    this.connectionState = "new";
    this.iceConnectionState = "new";
    this.transceivers = [];
    this.dataChannels = [];
    this.localDescription = null;
    this.remoteDescription = null;
    this.remoteCandidates = [];
    this.closeCalls = 0;
  }

  createDataChannel(label) {
    this.dataChannels.push(label);
    return { label };
  }

  addTransceiver(track, options) {
    const transceiver = {
      track,
      options,
      currentDirection: null,
      stopCalls: 0,
      stop() {
        this.stopCalls += 1;
      },
    };
    this.transceivers.push(transceiver);
    return transceiver;
  }

  async createOffer(options) {
    this.offerOptions = options;
    return { type: "offer", sdp: "ha-microphone-offer" };
  }

  async setLocalDescription(description) {
    this.localDescription = description;
  }

  async setRemoteDescription(description) {
    this.remoteDescription = description;
  }

  async addIceCandidate(candidate) {
    this.remoteCandidates.push(candidate);
  }

  close() {
    this.closeCalls += 1;
    this.connectionState = "closed";
  }
}

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const createMicrophone = () => {
  let stopCalls = 0;
  const track = new FakeEventTarget();
  track.kind = "audio";
  track.readyState = "live";
  track.stop = () => {
    stopCalls += 1;
    track.readyState = "ended";
  };
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  };
  return { stream, track, getStopCalls: () => stopCalls };
};

const startConnectedBackchannel = async ({ onEnded } = {}) => {
  const callWsPayloads = [];
  const microphone = createMicrophone();
  let peerConnection = null;
  let offerHandler = null;
  let offerPayload = null;
  let unsubscribeCalls = 0;

  const hass = {
    async callWS(payload) {
      callWsPayloads.push(payload);
      if (payload.type === "camera/webrtc/get_client_config") {
        return {
          configuration: { iceServers: [{ urls: "stun:ha.test" }] },
          dataChannel: "camera-required",
        };
      }
      return null;
    },
    connection: {
      subscribeMessage(handler, payload) {
        offerHandler = handler;
        offerPayload = payload;
        return Promise.resolve(() => {
          unsubscribeCalls += 1;
        });
      },
    },
  };
  const backchannel = createHaDirectTwoWayTalkBackchannel({
    getHass: () => hass,
    createPeerConnection: (configuration) => {
      peerConnection = new FakePeerConnection(configuration);
      return peerConnection;
    },
    createIceCandidate: (candidate) => ({ wrapped: candidate }),
    connectionTimeoutMs: 1000,
  });

  const connection = backchannel.connect({
    entity: "camera.front",
    microphoneStream: microphone.stream,
    onEnded,
  });
  await flushPromises();

  const localCandidate = {
    candidate: "local-candidate",
    toJSON: () => ({ candidate: "local-candidate", sdpMid: "0" }),
  };
  peerConnection.emit("icecandidate", { candidate: localCandidate });
  await offerHandler({ type: "session", session_id: "ha-session-1" });
  await offerHandler({ type: "answer", answer: "ha-answer" });
  await offerHandler({
    type: "candidate",
    candidate: { candidate: "remote-candidate" },
  });
  peerConnection.transceivers[0].currentDirection = "sendonly";
  peerConnection.connectionState = "connected";
  peerConnection.emit("connectionstatechange");

  return {
    callWsPayloads,
    engine: await connection,
    getUnsubscribeCalls: () => unsubscribeCalls,
    microphone,
    offerPayload,
    peerConnection,
  };
};

test("HA direct talk uses an independent send-only microphone peer", async () => {
  const {
    callWsPayloads,
    engine,
    getUnsubscribeCalls,
    microphone,
    offerPayload,
    peerConnection,
  } = await startConnectedBackchannel();

  assert.equal(engine.type, "ha_direct_backchannel");
  assert.equal(engine.sessionId, "ha-session-1");
  assert.deepEqual(peerConnection.configuration, {
    iceServers: [{ urls: "stun:ha.test" }],
  });
  assert.deepEqual(peerConnection.dataChannels, ["camera-required"]);
  assert.equal(peerConnection.transceivers.length, 1);
  assert.equal(peerConnection.transceivers[0].track, microphone.track);
  assert.deepEqual(peerConnection.transceivers[0].options, {
    direction: "sendonly",
    streams: [microphone.stream],
  });
  assert.equal(peerConnection.offerOptions, undefined);
  assert.deepEqual(offerPayload, {
    type: "camera/webrtc/offer",
    entity_id: "camera.front",
    offer: "ha-microphone-offer",
  });
  assert.deepEqual(callWsPayloads, [
    {
      type: "camera/webrtc/get_client_config",
      entity_id: "camera.front",
    },
    {
      type: "camera/webrtc/candidate",
      entity_id: "camera.front",
      session_id: "ha-session-1",
      candidate: { candidate: "local-candidate", sdpMid: "0" },
    },
  ]);
  assert.deepEqual(peerConnection.remoteDescription, {
    type: "answer",
    sdp: "ha-answer",
  });
  assert.deepEqual(peerConnection.remoteCandidates, [
    {
      wrapped: { candidate: "remote-candidate", sdpMid: "0" },
    },
  ]);
  assert.equal(getUnsubscribeCalls(), 0);
  assert.equal(microphone.getStopCalls(), 0);

  engine.destroy();
  engine.destroy();
  await flushPromises();

  assert.equal(getUnsubscribeCalls(), 1);
  assert.equal(peerConnection.closeCalls, 1);
  assert.equal(peerConnection.transceivers[0].stopCalls, 1);
  assert.equal(microphone.getStopCalls(), 0);
});

test("an established HA direct backchannel failure leaves live playback alone", async () => {
  let endedCalls = 0;
  const { getUnsubscribeCalls, microphone, peerConnection } =
    await startConnectedBackchannel({
      onEnded: () => {
        endedCalls += 1;
      },
    });

  peerConnection.connectionState = "failed";
  peerConnection.emit("connectionstatechange");
  peerConnection.emit("connectionstatechange");
  await flushPromises();

  assert.equal(endedCalls, 1);
  assert.equal(microphone.getStopCalls(), 1);
  assert.equal(peerConnection.closeCalls, 1);
  assert.equal(getUnsubscribeCalls(), 1);
});
