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
    return { type: "offer", sdp: "ha-full-session-offer" };
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

class FakeIncomingAudio {
  constructor() {
    this.attributes = new Map();
    this.autoplay = false;
    this.controls = true;
    this.muted = true;
    this.defaultMuted = true;
    this.volume = 0;
    this.srcObject = null;
    this.playCalls = 0;
    this.pauseCalls = 0;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  play() {
    this.playCalls += 1;
    return Promise.resolve();
  }

  pause() {
    this.pauseCalls += 1;
  }
}

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const createTrack = (kind, { muted = true } = {}) => {
  const track = new FakeEventTarget();
  track.kind = kind;
  track.readyState = "live";
  track.muted = muted;
  track.stopCalls = 0;
  track.stop = () => {
    track.stopCalls += 1;
    track.readyState = "ended";
  };
  return track;
};

const createMicrophone = () => {
  const track = createTrack("audio", { muted: false });
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  };
  return { stream, track };
};

const startBackchannel = async ({ onEnded } = {}) => {
  const callWsPayloads = [];
  const microphone = createMicrophone();
  const incomingAudio = new FakeIncomingAudio();
  let peerConnection = null;
  let offerHandler = null;
  let offerPayload = null;
  let unsubscribeCalls = 0;
  let mountCalls = 0;
  let unmountCalls = 0;

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
    createMediaStream: () => new FakeMediaStream(),
    createIncomingAudio: () => incomingAudio,
    mountIncomingAudio: (audio) => {
      assert.equal(audio, incomingAudio);
      mountCalls += 1;
      return () => {
        unmountCalls += 1;
      };
    },
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

  return {
    callWsPayloads,
    connection,
    getMountCalls: () => mountCalls,
    getUnsubscribeCalls: () => unsubscribeCalls,
    getUnmountCalls: () => unmountCalls,
    incomingAudio,
    microphone,
    offerPayload,
    peerConnection,
  };
};

const finishBackchannelMedia = async (fixture) => {
  const remoteAudioTrack = createTrack("audio");
  const remoteVideoTrack = createTrack("video");
  fixture.peerConnection.emit("track", { track: remoteAudioTrack });
  fixture.peerConnection.emit("track", { track: remoteVideoTrack });
  fixture.peerConnection.transceivers[0].currentDirection = "sendonly";
  fixture.peerConnection.connectionState = "connected";
  fixture.peerConnection.emit("connectionstatechange");
  await flushPromises();
  remoteVideoTrack.muted = false;
  remoteVideoTrack.emit("unmute");
  await flushPromises();
  remoteAudioTrack.muted = false;
  remoteAudioTrack.emit("unmute");

  return {
    engine: await fixture.connection,
    remoteAudioTrack,
    remoteVideoTrack,
  };
};

test("HA direct talk keeps a separate full-shaped peer and plays its audio", async () => {
  const fixture = await startBackchannel();
  let connectionSettled = false;
  void fixture.connection.then(() => {
    connectionSettled = true;
  });

  fixture.peerConnection.transceivers[0].currentDirection = "sendonly";
  fixture.peerConnection.connectionState = "connected";
  fixture.peerConnection.emit("connectionstatechange");
  await flushPromises();
  assert.equal(connectionSettled, false);

  const { engine, remoteAudioTrack, remoteVideoTrack } =
    await finishBackchannelMedia(fixture);

  assert.equal(engine.type, "ha_direct_backchannel");
  assert.equal(engine.sessionId, "ha-session-1");
  assert.deepEqual(fixture.peerConnection.configuration, {
    iceServers: [{ urls: "stun:ha.test" }],
  });
  assert.deepEqual(fixture.peerConnection.dataChannels, ["camera-required"]);
  assert.deepEqual(
    fixture.peerConnection.transceivers.map(({ track, options }) => [
      track,
      options,
    ]),
    [
      [
        fixture.microphone.track,
        { direction: "sendonly", streams: [fixture.microphone.stream] },
      ],
      ["video", { direction: "recvonly" }],
      ["audio", { direction: "recvonly" }],
    ],
  );
  assert.deepEqual(fixture.peerConnection.offerOptions, {
    offerToReceiveAudio: true,
    offerToReceiveVideo: true,
  });
  assert.deepEqual(fixture.offerPayload, {
    type: "camera/webrtc/offer",
    entity_id: "camera.front",
    offer: "ha-full-session-offer",
  });
  assert.deepEqual(fixture.callWsPayloads, [
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
  assert.deepEqual(fixture.peerConnection.remoteDescription, {
    type: "answer",
    sdp: "ha-answer",
  });
  assert.deepEqual(fixture.peerConnection.remoteCandidates, [
    {
      wrapped: { candidate: "remote-candidate", sdpMid: "0" },
    },
  ]);
  assert.equal(fixture.incomingAudio.srcObject, engine.incomingAudioStream);
  assert.deepEqual(engine.incomingAudioStream.getTracks(), [remoteAudioTrack]);
  assert.equal(fixture.incomingAudio.muted, false);
  assert.equal(fixture.incomingAudio.defaultMuted, false);
  assert.equal(fixture.incomingAudio.volume, 1);
  assert.equal(fixture.incomingAudio.playCalls > 0, true);
  assert.equal(fixture.getMountCalls(), 1);
  assert.equal(fixture.getUnsubscribeCalls(), 0);
  assert.equal(fixture.microphone.track.stopCalls, 0);

  engine.setIncomingAudioMuted(true);
  assert.equal(fixture.incomingAudio.muted, true);
  engine.setIncomingAudioMuted(false);
  assert.equal(fixture.incomingAudio.muted, false);

  engine.destroy();
  engine.destroy();
  await flushPromises();

  assert.equal(fixture.getUnsubscribeCalls(), 1);
  assert.equal(fixture.getUnmountCalls(), 1);
  assert.equal(fixture.peerConnection.closeCalls, 1);
  assert.deepEqual(
    fixture.peerConnection.transceivers.map(({ stopCalls }) => stopCalls),
    [1, 1, 1],
  );
  assert.equal(remoteAudioTrack.stopCalls, 1);
  assert.equal(remoteVideoTrack.stopCalls, 1);
  assert.equal(fixture.incomingAudio.pauseCalls, 1);
  assert.equal(fixture.incomingAudio.srcObject, null);
  assert.equal(fixture.microphone.track.stopCalls, 0);
});

test("an established HA direct backchannel failure leaves live playback alone", async () => {
  let endedCalls = 0;
  const fixture = await startBackchannel({
    onEnded: () => {
      endedCalls += 1;
    },
  });
  await finishBackchannelMedia(fixture);

  fixture.peerConnection.connectionState = "failed";
  fixture.peerConnection.emit("connectionstatechange");
  fixture.peerConnection.emit("connectionstatechange");
  await flushPromises();

  assert.equal(endedCalls, 1);
  assert.equal(fixture.microphone.track.stopCalls, 1);
  assert.equal(fixture.peerConnection.closeCalls, 1);
  assert.equal(fixture.getUnsubscribeCalls(), 1);
  assert.equal(fixture.getUnmountCalls(), 1);
});
