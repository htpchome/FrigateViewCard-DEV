import { test } from "node:test";
import assert from "node:assert/strict";

import { TwoWayTalkSessionController } from "../src/features/two-way-talk/session.ctrl.js";

const withFakeMicrophone = async (run) => {
  const previousNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const previousWindow = globalThis.window;
  const track = { enabled: true, stop() {} };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => stream,
      },
    },
  });
  globalThis.window = { isSecureContext: true };

  try {
    await run();
  } finally {
    if (previousNavigator) {
      Object.defineProperty(globalThis, "navigator", previousNavigator);
    } else {
      delete globalThis.navigator;
    }
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
};

const createHost = (useGo2Rtc) => {
  const calls = [];
  const createBackchannel = (type) => ({
    async prepare({ entity }) {
      calls.push(["prepare", type, entity]);
      return { entity };
    },
    async connect({ entity, microphoneStream, preparedConnection }) {
      if (type === "ha_direct") assert.equal(preparedConnection.entity, entity);
      else assert.equal(preparedConnection, undefined);
      calls.push(["connect", type, entity, microphoneStream]);
      return {
        async destroy() {
          calls.push(["destroy", type]);
        },
      };
    },
  });
  const host = {
    _activeCam: { entity: "camera.front", two_way_talk: true },
    _activeGroupMemberOverride: "",
    _pageId: "single-view",
    _activeStreamType: "webrtc",
    _viewMode: "single",
    _twoWayTalkSession: null,
    _twoWayTalkStarting: false,
    _twoWayTalkStartAbortController: null,
    _twoWayTalkStartSeq: 0,
    _twoWayTalkEntity: "",
    _go2rtcTwoWayTalkBackchannel: createBackchannel("frigate_go2rtc"),
    _haDirectTwoWayTalkBackchannel: createBackchannel("ha_direct"),
    _shouldUseGo2RtcForEntity: () => useGo2Rtc,
    _stopTwoWayTalkSession: async () => {},
    _syncTwoWayTalkButton: () => calls.push(["sync"]),
    _setTwoWayTalkLiveAudioActive: (active) =>
      calls.push(["live-audio", active]),
    _showTwoWayTalkResultBubble: (success) =>
      calls.push(["result", success]),
    _twoWayTalkSoundwaveController: {
      startAfterPaint: () => calls.push(["soundwave", "start"]),
      stop: () => calls.push(["soundwave", "stop"]),
    },
  };
  const controller = new TwoWayTalkSessionController(host);
  host._activeCameraTwoWayTalkEnabled = () =>
    controller.activeCameraEnabled();
  return { calls, controller, host };
};

test("two-way-talk session controller keeps transport modes explicit", async () => {
  await withFakeMicrophone(async () => {
    for (const [useGo2Rtc, expectedType] of [
      [true, "frigate_go2rtc"],
      [false, "ha_direct"],
    ]) {
      const { calls, controller, host } = createHost(useGo2Rtc);

      await controller.startSession();

      assert.equal(host._twoWayTalkSession?.type, expectedType);
      assert.equal(host._twoWayTalkEntity, "camera.front");
      assert.deepEqual(calls.filter(([action]) => action === "prepare"),
        useGo2Rtc ? [] : [["prepare", "ha_direct", "camera.front"]]);
      assert.deepEqual(
        calls
          .filter(([action]) => action === "connect")
          .map(([, type, entity]) => [type, entity]),
        [[expectedType, "camera.front"]],
      );
      await host._twoWayTalkSession.stop();
    }
  });
});

test("two-way-talk availability rejects grid and alternate group members", () => {
  const { controller, host } = createHost(true);

  assert.equal(controller.shouldRenderButtonForActiveCamera(), true);
  host._viewMode = "grid";
  assert.equal(controller.shouldRenderButtonForActiveCamera(), false);
  host._viewMode = "single";
  host._activeGroupMemberOverride = "camera.back";
  assert.equal(controller.shouldRenderButtonForActiveCamera(), false);
});

for (const change of ["camera", "transport", "cancel"]) {
  test(`HA talk does not start a stale prepared connection after ${change} changes`, async () => {
    await withFakeMicrophone(async () => {
      const { calls, controller, host } = createHost(false);
      let finishPreparation;
      host._haDirectTwoWayTalkBackchannel.prepare = () => new Promise((resolve) => {
        finishPreparation = resolve;
      });
      host._toast = () => {};
      const starting = controller.startSession();
      await new Promise((resolve) => setImmediate(resolve));
      if (change === "camera") host._activeCam = { entity: "camera.other", two_way_talk: true };
      if (change === "transport") host._shouldUseGo2RtcForEntity = () => true;
      if (change === "cancel") controller.cancelStart();
      finishPreparation({ entity: "camera.front" });
      await starting;
      assert.equal(calls.some(([action]) => action === "connect"), false);
      assert.equal(host._twoWayTalkSession, null);
      assert.equal(host._twoWayTalkStarting, false);
    });
  });
}
