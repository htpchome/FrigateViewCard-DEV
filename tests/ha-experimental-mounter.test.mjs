import { test } from "node:test";
import assert from "node:assert/strict";

import { createHaExperimentalMounter } from "../src/integrations/home-assistant/experimental-mounter.js";

const createPlaybackFixture = (playerTag = "HA-WEB-RTC-PLAYER") => {
  const video = {
    muted: true,
    defaultMuted: true,
    play: () => Promise.resolve(),
  };
  const player = {
    tagName: playerTag,
    hidden: false,
    muted: true,
    defaultMuted: true,
    classList: { contains: () => false },
    shadowRoot: { querySelector: () => video },
  };
  const stream = new EventTarget();
  Object.assign(stream, {
    tagName: "HA-CAMERA-STREAM",
    isConnected: false,
    muted: true,
    defaultMuted: true,
    updateComplete: Promise.resolve(),
    shadowRoot: {
      querySelectorAll: () => [player],
    },
    remove: () => {
      stream.isConnected = false;
    },
  });
  return { player, stream, video };
};

test("experimental HA mounter delegates selection to a raw ha-camera-stream", async () => {
  const stateObj = {
    entity_id: "camera.front",
    attributes: { frontend_stream_type: "web_rtc" },
  };
  let hass = { states: { "camera.front": stateObj } };
  const fixture = createPlaybackFixture();
  const calls = [];
  let createdOptions = null;
  let currentEngine = null;
  let firstFrameWatcher = null;
  let startupTimer = null;
  const slot = {
    innerHTML: "occupied",
    appendChild: (node) => {
      node.isConnected = true;
    },
  };
  const mounter = createHaExperimentalMounter({
    getHass: () => hass,
    getStreamMuted: () => true,
    isCurrentEngine: (engine) => engine === currentEngine,
    assignCommittedEngine: (engine) => {
      currentEngine = engine;
      calls.push(["assign", engine]);
    },
    onCommittedMediaReady: (engine, video) =>
      calls.push(["media-ready", engine, video]),
    onCommittedStream: (type) => calls.push(["stream-ready", type]),
    onCommittedFailure: () => calls.push(["failure"]),
    preparePlaybackElements: () => true,
    createStreamElement: (options) => {
      createdOptions = options;
      return fixture.stream;
    },
    watchFirstFrame: (options) => {
      firstFrameWatcher = options;
      return () => calls.push(["stop-first-frame"]);
    },
    setTimer: (callback) => {
      startupTimer = callback;
      return 7;
    },
    clearTimer: (timer) => calls.push(["clear-timer", timer]),
  });

  const result = await mounter.tryMount(slot, { streamType: "hls" }, {
    entity: "camera.front",
    commit: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.type, "ha_experimental");
  assert.strictEqual(createdOptions.stateObj, stateObj);
  assert.deepEqual(createdOptions.stateObj.attributes, {
    frontend_stream_type: "web_rtc",
  });
  assert.equal(createdOptions.muted, true);
  assert.equal(fixture.stream.type, "ha_experimental");
  assert.equal(typeof startupTimer, "function");

  firstFrameWatcher.onReady();
  assert.equal(await result.startupReady, true);
  assert.equal(fixture.stream.streamType, "webrtc");
  assert.deepEqual(calls.at(-3), ["media-ready", fixture.stream, fixture.video]);
  assert.deepEqual(calls.at(-2), ["stream-ready", "webrtc"]);
  assert.deepEqual(calls.at(-1), ["clear-timer", 7]);

  fixture.stream.setOutputMuted(false);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fixture.stream.muted, false);
  assert.equal(fixture.player.muted, false);
  assert.equal(fixture.video.muted, false);

  fixture.stream.setOutputMuted(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    fixture.stream.muted,
    false,
    "output muting must not reset Home Assistant's stream-selection latch",
  );
  assert.equal(fixture.player.muted, true);
  assert.equal(fixture.video.muted, true);

  const nextStateObj = {
    entity_id: "camera.front",
    attributes: { frontend_stream_type: "hls" },
  };
  hass = { states: { "camera.front": nextStateObj } };
  assert.equal(mounter.updateHass(fixture.stream), true);
  assert.strictEqual(fixture.stream.hass, hass);
  assert.strictEqual(fixture.stream.stateObj, nextStateObj);

  mounter.release(fixture.stream);
  assert.equal(fixture.stream.isConnected, false);
});

test("experimental HA mounter falls back without cancelling a late native frame", async () => {
  const fixture = createPlaybackFixture("HA-HLS-PLAYER");
  let currentEngine = null;
  let firstFrameWatcher = null;
  let startupTimer = null;
  const calls = [];
  const mounter = createHaExperimentalMounter({
    getHass: () => ({
      states: {
        "camera.front": {
          entity_id: "camera.front",
          attributes: {},
        },
      },
    }),
    getStreamMuted: () => true,
    isCurrentEngine: (engine) => engine === currentEngine,
    assignCommittedEngine: (engine) => {
      currentEngine = engine;
    },
    onCommittedStream: (type) => calls.push(["ready", type]),
    onCommittedFailure: () => calls.push(["failure"]),
    preparePlaybackElements: () => true,
    createStreamElement: () => fixture.stream,
    watchFirstFrame: (options) => {
      firstFrameWatcher = options;
      return () => {};
    },
    setTimer: (callback) => {
      startupTimer = callback;
      return 1;
    },
    clearTimer: () => {},
  });
  const slot = {
    innerHTML: "",
    appendChild: (node) => {
      node.isConnected = true;
    },
  };

  const result = await mounter.tryMount(slot, null, {
    entity: "camera.front",
    commit: true,
  });
  startupTimer();
  assert.equal(await result.startupReady, false);
  assert.deepEqual(calls, [["failure"]]);

  firstFrameWatcher.onReady();
  assert.deepEqual(calls, [["failure"], ["ready", "hls"]]);
});
