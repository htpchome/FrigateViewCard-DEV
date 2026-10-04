// TEMPORARY HA TALK TIMING: remove alongside the diagnostic module after testing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTwoWayTalkStartupTiming } from "../src/features/two-way-talk/startup-timing.js";
import { TwoWayTalkSessionController } from "../src/features/two-way-talk/session.ctrl.js";
import { createHaDirectTwoWayTalkBackchannel } from "../src/integrations/home-assistant/two-way-talk-backchannel.js";

test("talk timing has no clock, storage or output work when disabled", () => {
  assert.equal(createTwoWayTalkStartupTiming({
    enabled: false,
    now: () => assert.fail("clock should not run"),
    report: () => assert.fail("report should not run"),
  }), null);
});

test("talk timing reports only whitelisted first milestones and a fixed outcome", () => {
  let now = 100;
  const results = [];
  const timing = createTwoWayTalkStartupTiming({
    enabled: true, now: () => now, report: (result) => results.push(result),
  });
  timing.mark("microphone-requested");
  now = 105.4;
  timing.mark("config-requested");
  now = 120;
  timing.mark("microphone-ready");
  timing.mark("microphone-ready");
  timing.mark("camera.private");
  timing.mark({ sdp: "private-offer" });
  now = 150;
  timing.finish("connected");
  timing.mark("video-started");
  timing.finish("failed");
  assert.deepEqual(results, [{
    outcome: "connected", totalMs: 50, stages: [
      { stage: "microphone-requested", elapsedMs: 0 },
      { stage: "config-requested", elapsedMs: 5 },
      { stage: "microphone-ready", elapsedMs: 20 },
    ],
  }]);
});

test("talk timing never reports raw error messages as outcomes", () => {
  const results = [];
  const timing = createTwoWayTalkStartupTiming({
    enabled: true, now: () => 0, report: (result) => results.push(result),
  });
  timing.finish(new Error("private server data"));
  assert.deepEqual(results, [{ outcome: "failed", totalMs: 0, stages: [] }]);
});

test("temporary HA talk timing opt-in is wired through preparation and session completion", async () => {
  const previous = Object.fromEntries(["navigator", "window", "FVC_TALK_TIMING"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const previousInfo = console.info;
  const reports = [];
  const track = { stop() {} };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: async () => stream } } });
  globalThis.window = { isSecureContext: true };
  globalThis.FVC_TALK_TIMING = true;
  console.info = (label, result) => reports.push({ label, result });
  const backchannel = createHaDirectTwoWayTalkBackchannel({
    getHass: () => ({ callWS: async () => ({}), connection: { subscribeMessage() {} } }),
  });
  const host = {
    _activeCam: { entity: "camera.private", two_way_talk: true },
    _activeCameraTwoWayTalkEnabled: () => true,
    _shouldUseGo2RtcForEntity: () => false,
    _stopTwoWayTalkSession: async () => {},
    _syncTwoWayTalkButton() {},
    _setTwoWayTalkLiveAudioActive() {},
    _showTwoWayTalkResultBubble() {},
    _haDirectTwoWayTalkBackchannel: {
      prepare: backchannel.prepare,
      connect: async ({ preparedConnection, onTalkStartupTiming }) => {
        assert.equal(preparedConnection.entity, "camera.private");
        onTalkStartupTiming("media-ready");
        return { destroy() {} };
      },
    },
  };
  try {
    await new TwoWayTalkSessionController(host).startSession();
    assert.equal(reports.length, 1);
    assert.equal(reports[0].label, "[FrigateView HA talk timing]");
    assert.equal(reports[0].result.outcome, "connected");
    assert.deepEqual(reports[0].result.stages.map(({ stage }) => stage), [
      "microphone-requested", "config-requested", "config-ready", "microphone-ready", "media-ready",
    ]);
    assert.equal(JSON.stringify(reports).includes("camera.private"), false);
  } finally {
    await host._twoWayTalkSession?.stop();
    console.info = previousInfo;
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
