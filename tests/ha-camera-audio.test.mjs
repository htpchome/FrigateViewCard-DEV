import { test } from "node:test";
import assert from "node:assert/strict";
import { synchronizeHaCameraAudio } from "../src/integrations/home-assistant/camera-audio.js";
import { LiveAudioController } from "../src/features/live/audio.ctrl.js";

const createHarness = () => {
  const audio = { kind: "audio", readyState: "live" };
  const tracks = [{ kind: "video", readyState: "live" }];
  const stream = {
    getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
    addTrack: (track) => tracks.push(track),
  };
  const video = {
    muted: true, defaultMuted: true, volume: 0, srcObject: stream,
    playCalls: 0,
    play() { this.playCalls += 1; return Promise.resolve(); },
  };
  const peer = { getReceivers: () => [{ track: audio }], connectionState: "connected" };
  const player = {
    tagName: "HA-WEB-RTC-PLAYER", muted: true,
    _remoteStream: stream, _peerConnection: peer,
    shadowRoot: { querySelector: () => video },
  };
  const hiddenVideo = { muted: true };
  const hidden = {
    tagName: "HA-HLS-PLAYER", hidden: true, muted: true,
    shadowRoot: { querySelector: () => hiddenVideo },
  };
  const provider = {
    haDirectProvider: true, muted: true, defaultMuted: true,
    shadowRoot: { querySelectorAll: () => [hidden, player] },
  };
  const timers = [];
  const host = {
    _engine: provider, _streamMuted: true,
    _findVideoDeep: () => hiddenVideo,
    _renderMuteButton() {},
  };
  const controller = new LiveAudioController(host, {
    interactionTarget: null, setTimer: (callback) => timers.push(callback),
  });
  host._setLiveMuted = (muted) => controller.setMuted(muted);
  return { audio, tracks, stream, video, peer, player, hidden, hiddenVideo,
    provider, timers, host, controller };
};

for (const startUnmuted of [false, true]) {
  test(`manual HA Direct unmute restores omitted audio (start_unmuted=${startUnmuted})`, () => {
    const h = createHarness();
    h.controller.prepareCameraStart({ start_unmuted: startUnmuted });
    assert.equal(h.stream.getAudioTracks().length, 0, "models HA's muted _addTrack guard");
    h.controller.applyMuteChange(false);
    assert.deepEqual(h.stream.getAudioTracks(), [h.audio]);
    assert.equal(h.video.srcObject, h.stream, "no replacement MediaStream");
    assert.equal(h.player._peerConnection, h.peer, "no replacement peer");
    assert.equal(h.video.muted, false);
    assert.equal(h.video.volume, 1);
    assert.equal(h.player.muted, false, "native child updated in the gesture");
    assert.equal(h.provider.muted, false);
    assert.equal(h.hiddenVideo.muted, true);
    assert.equal(h.hidden.muted, true);
    h.controller.applyMuteChange(true);
    for (const timer of h.timers) timer();
    assert.equal(h.video.muted, true, "old unmute timers cannot undo manual mute");
    assert.equal(h.player.muted, true);
    assert.deepEqual(h.stream.getAudioTracks(), [h.audio], "mute does not remove or stop tracks");
    h.controller.applyMuteChange(false);
    assert.deepEqual(h.stream.getAudioTracks(), [h.audio], "repeat unmute does not duplicate audio");
  });
}

test("initial HA playback restores already received audio before requesting play", async () => {
  const h = createHarness();
  h.host._activeCam = { entity: "camera.one", start_unmuted: true };
  h.controller.prepareCameraStart(h.host._activeCam);
  const requests = [];
  h.video.play = () => {
    h.video.playCalls += 1;
    requests.push({ tracks: [...h.stream.getAudioTracks()], muted: h.video.muted,
      volume: h.video.volume, playerMuted: h.player.muted });
    return Promise.resolve();
  };
  const playback = h.controller.createInitialPlayback(h.video, { entity: "camera.one" });
  await playback.play();
  h.controller.applyCameraStartPreference();
  assert.equal(h.video.playCalls, 2, "initial playback followed by loaded selection");
  assert.deepEqual(requests, Array(2).fill({ tracks: [h.audio], muted: false, volume: 1, playerMuted: false }));
  assert.equal(h.hiddenVideo.muted, true);
  assert.equal(h.video.srcObject, h.stream);
  assert.equal(h.player._peerConnection, h.peer);
  h.controller.dispose();
});

test("late HA receiver audio retries the selected provider and restores its omitted track", async () => {
  const h = createHarness();
  const received = [];
  const peer = Object.assign(new EventTarget(), { connectionState: "connected", getReceivers: () => received });
  h.player._peerConnection = peer;
  let allowed = false;
  h.video.play = () => h.video.muted || allowed ? Promise.resolve()
    : Promise.reject(new DOMException("Denied", "NotAllowedError"));
  h.controller.prepareCameraStart({ start_unmuted: true });
  h.controller.applyCameraStartPreference();
  await Promise.resolve();
  assert.equal(h.video.muted, true);
  const track = Object.assign(new EventTarget(), { kind: "audio", readyState: "live", muted: true });
  received.push({ track });
  peer.dispatchEvent(new Event("track"));
  allowed = true;
  track.muted = false;
  track.dispatchEvent(new Event("unmute"));
  await Promise.resolve();
  assert.equal(h.video.muted, false);
  assert.deepEqual(h.stream.getAudioTracks(), [track]);
  assert.equal(h.video.srcObject, h.stream);
  assert.equal(h.player._peerConnection, peer);
  assert.equal(h.hiddenVideo.muted, true);
  h.controller.dispose();
});

test("startup preference restores audio on the active HA child, not a hidden candidate", async () => {
  const h = createHarness();
  h.controller.prepareCameraStart({ start_unmuted: true });
  assert.equal(h.controller.applyCameraStartPreference(), true);
  await Promise.resolve();
  assert.deepEqual(h.stream.getAudioTracks(), [h.audio]);
  assert.equal(h.video.muted, false);
  assert.equal(h.hiddenVideo.muted, true);
  assert.equal(h.video.playCalls, 1, "audio restoration precedes one tracked playback request");
  assert.equal(h.timers.length, 0, "startup does not queue untracked playback retries");
  h.controller.dispose();
});

test("HA Direct readiness retries interrupted audio without replacing its provider or stream", async () => {
  const h = createHarness();
  const events = new EventTarget();
  h.video.addEventListener = events.addEventListener.bind(events);
  h.video.removeEventListener = events.removeEventListener.bind(events);
  let plays = 0;
  h.video.play = () => ++plays === 1
    ? Promise.reject(new DOMException("Interrupted", "AbortError"))
    : Promise.resolve();
  h.controller.prepareCameraStart({ start_unmuted: true });
  h.controller.applyCameraStartPreference();
  await Promise.resolve();
  assert.equal(h.provider.muted, false);
  events.dispatchEvent(new Event("canplay"));
  await Promise.resolve();
  assert.equal(plays, 2);
  assert.equal(h.video.srcObject, h.stream);
  assert.equal(h.host._engine, h.provider);
  assert.equal(h.player._peerConnection, h.peer);
  assert.deepEqual(h.stream.getAudioTracks(), [h.audio]);
  assert.equal(h.hiddenVideo.muted, true);
  h.controller.dispose();
  events.dispatchEvent(new Event("canplay"));
  assert.equal(plays, 2);
});

test("blocked HA autoplay resumes muted playback with audio retained for the mute button", async () => {
  const h = createHarness();
  let allowed = false;
  h.video.play = () => h.video.muted || allowed
    ? Promise.resolve()
    : Promise.reject(new DOMException("Blocked", "NotAllowedError"));
  h.controller.prepareCameraStart({ start_unmuted: true });
  h.controller.applyCameraStartPreference();
  await Promise.resolve();
  assert.equal(h.video.muted, true);
  assert.equal(h.player.muted, true);
  assert.equal(h.host._streamMuted, true);
  assert.deepEqual(h.stream.getAudioTracks(), [h.audio]);
  allowed = true;
  h.controller.applyMuteChange(false);
  assert.equal(h.video.muted, false);
});

test("pending HA audio sync ignores a previously selected provider", () => {
  const h = createHarness();
  h.controller.applyMuteChange(false);
  const playCalls = h.video.playCalls;
  h.host._engine = {};
  h.provider.muted = h.player.muted = h.video.muted = true;
  for (const timer of h.timers) timer();
  assert.equal(h.video.muted, true);
  assert.equal(h.video.playCalls, playCalls);
});

test("delayed synchronization follows a replacement HA child", () => {
  const h = createHarness();
  h.controller.applyMuteChange(false);
  const replacement = createHarness();
  h.provider.shadowRoot.querySelectorAll = () => [replacement.player];
  h.timers[0]();
  assert.equal(replacement.video.muted, false);
  assert.deepEqual(replacement.stream.getAudioTracks(), [replacement.audio]);
});

for (const scenario of ["muted", "ended", "HLS", "missing peer", "closed peer", "different stream", "unowned"]) {
  test(`audio adapter does not restore tracks for ${scenario}`, () => {
    const h = createHarness();
    if (scenario === "ended") h.audio.readyState = "ended";
    if (scenario === "HLS") h.player.tagName = "HA-HLS-PLAYER";
    if (scenario === "missing peer") h.player._peerConnection = null;
    if (scenario === "closed peer") h.peer.connectionState = "closed";
    if (scenario === "different stream") h.player._remoteStream = {};
    if (scenario === "unowned") h.provider.haDirectProvider = false;
    synchronizeHaCameraAudio(h.provider, scenario === "muted");
    assert.equal(h.stream.getAudioTracks().length, 0);
    if (scenario === "unowned") assert.equal(h.provider.muted, true);
    if (scenario === "HLS") assert.equal(h.player.muted, false);
  });
}

test("missing HA media remains safe during child teardown", () => {
  const h = createHarness();
  h.provider.shadowRoot.querySelectorAll = () => [];
  assert.equal(synchronizeHaCameraAudio(h.provider, false), null);
  h.controller.applyMuteChange(true);
  assert.equal(h.provider.muted, false,
    "once selected, the audio-capable HA stream remains latched while output is muted");
});
