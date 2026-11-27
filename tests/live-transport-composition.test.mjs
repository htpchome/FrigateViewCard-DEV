import { test } from "node:test";
import assert from "node:assert/strict";

import { createLiveTransportControllers } from "../src/features/live/transport-composition.js";
import { attachContainedVideoFit } from "../src/shared/media/video-fit.js";

test("fresh HA Direct resume is Companion-only and excludes Catalyst", () => {
  for (const [deviceProfile, expected] of [
    [{ isCompanionApp: true, isCatalyst: false }, true],
    [{ isCompanionApp: true, isCatalyst: true }, false],
    [{ isIOS: true, isCompanionApp: false }, false],
    [{}, false],
  ]) {
    let options;
    const factories = Object.fromEntries([
      "createGo2RtcResolver", "createGo2RtcTwoWayTalkBackchannel", "createCatalystHlsMounter",
      "createGo2RtcMounter", "createHaDirectTwoWayTalkMounter", "createHaDirectTwoWayTalkBackchannel",
      "createGo2RtcRaceMounter",
    ].map((name) => [name, () => ({})]));
    factories.createHaDirectMounter = (value) => { options = value; return {}; };
    createLiveTransportControllers({}, { deviceProfile, factories });
    assert.equal(options.restartOnResume, expected);
  }
});

test("live transport composition keeps go2rtc and HA Direct stacks explicit", async () => {
  const optionsByFactory = {};
  const createFactory = (name, result = { name }) => (options) => {
    optionsByFactory[name] = options;
    return result;
  };
  const resolver = {
    name: "go2rtc-resolver",
    websocketUrlForEntity: (entity) => `wss://example/${entity}`,
  };
  const factories = {
    createGo2RtcResolver: createFactory("go2rtcResolver", resolver),
    createGo2RtcTwoWayTalkBackchannel: createFactory(
      "go2rtcTwoWayTalkBackchannel",
    ),
    createCatalystHlsMounter: createFactory("catalystHlsMounter"),
    createGo2RtcMounter: createFactory("go2rtcMounter"),
    createHaDirectMounter: createFactory("haDirectMounter"),
    createHaDirectTwoWayTalkMounter: createFactory(
      "haDirectTwoWayTalkMounter",
    ),
    createHaDirectTwoWayTalkBackchannel: createFactory(
      "haDirectTwoWayTalkBackchannel",
    ),
    createGo2RtcRaceMounter: createFactory("go2rtcRaceMounter"),
  };
  const calls = [];
  let editorHandoffContext = "dashboard";
  let backgroundStarts = 0;
  const engineHost = { id: "engine" };
  const catalystHlsDeckHost = { id: "catalyst-hls-deck" };
  const shadowRoot = {
    appendChild: (node) => calls.push(["append-audio", node]),
  };
  const deviceProfile = {
    isMobile: true,
    isIOS: false,
    isCatalyst: false,
  };
  const card = {
    isConnected: true,
    shadowRoot,
    _hass: {
      language: "en",
      states: { "camera.front": {}, "camera.ha": {} },
    },
    _config: {
      cameras: [
        { entity: "camera.front" },
        { entity: "camera.ha" },
      ],
    },
    _activeCam: { entity: "camera.front" },
    _camCache: {},
    _streamMuted: true,
    _rotateOverlayActive: false,
    _mountSeq: 7,
    _pendingMountDestroyers: [],
    _pendingWebRTCTakeoverTimer: null,
    _mseChunkCount: 0,
    _started: true,
    _frigateCameraRuntimeController: {
      isSuspended: () => false,
    },
    _haDirectMounter: {
      schedulePreloadDeckAfterPaint: () => { backgroundStarts += 1; },
    },
    _editorPreviewController: {
      liveHandoffContext: () => editorHandoffContext,
    },
    _liveGraceController: {
      getCatalystHlsDeckHost: () => catalystHlsDeckHost,
      hasRetainedCatalystHlsEngine: (entity) => entity === "camera.ha",
      retainCatalystHlsEngine: (entity, engine) =>
        entity === "camera.ha" && engine === "catalyst-engine",
    },
    _$: (selector) => (selector === "#engine" ? engineHost : null),
    _discoverOne: async (entity) => calls.push(["discover", entity]),
    _preferredStreamType: () => "webrtc",
    _findVideoDeep: () => null,
    _assignLiveEngine: (...args) => calls.push(["assign-engine", ...args]),
    _setActiveStreamType: (type) => calls.push(["stream-type", type]),
    _setStreamLoading: (loading) => calls.push(["loading", loading]),
    _setStreamFallbackVisible: (visible) =>
      calls.push(["fallback", visible]),
    _scheduleResumeLive: (reason) => calls.push(["resume", reason]),
    _isFirefox: () => false,
    _isSafari: () => false,
    _attachMainLiveVideoZoom: (...args) => calls.push(["zoom", ...args]),
    _applyResolvedStreamUiState: (state) => calls.push(["ui-state", state]),
    _setLiveNativeControls: (enabled) =>
      calls.push(["native-controls", enabled]),
    _cameraConnectionType: (entity) =>
      entity === "camera.ha" ? "ha_direct" : "frigate_go2rtc",
    _shouldUseGo2RtcForEntity: (entity) =>
      deviceProfile.isCatalyst !== true && entity !== "camera.ha",
  };

  const controllers = createLiveTransportControllers(card, {
    deviceProfile,
    factories,
  });

  assert.deepEqual(Object.keys(controllers), [
    "_go2rtcResolver",
    "_go2rtcTwoWayTalkBackchannel",
    "_go2rtcMounter",
    "_catalystHlsMounter",
    "_haDirectMounter",
    "_haDirectTwoWayTalkMounter",
    "_haDirectTwoWayTalkBackchannel",
    "_go2rtcRaceMounter",
  ]);
  assert.strictEqual(controllers._go2rtcResolver, resolver);
  assert.strictEqual(optionsByFactory.go2rtcMounter.resolver, resolver);
  assert.strictEqual(
    optionsByFactory.go2rtcRaceMounter.mounter,
    controllers._go2rtcMounter,
  );
  assert.strictEqual(optionsByFactory.go2rtcMounter.scopeKey, card);
  assert.equal(
    optionsByFactory.go2rtcMounter.createStartupPlayback,
    undefined,
    "go2rtc must use ordinary muted startup before the selected action",
  );
  assert.strictEqual(
    optionsByFactory.go2rtcMounter.attachVideoFit,
    attachContainedVideoFit,
  );
  assert.strictEqual(
    optionsByFactory.haDirectTwoWayTalkMounter.attachVideoFit,
    attachContainedVideoFit,
  );
  assert.strictEqual(optionsByFactory.haDirectMounter.scopeKey, card);
  assert.equal(
    optionsByFactory.haDirectMounter.createStartupPlayback,
    undefined,
    "HA Direct must use ordinary native startup before the selected action",
  );
  assert.equal(
    typeof optionsByFactory.haDirectMounter.onSelectedMediaAvailable,
    "function",
    "HA Direct reapplies the configured action when its final leaf appears",
  );
  assert.equal(optionsByFactory.haDirectMounter.shouldPreload(), false);
  assert.equal(optionsByFactory.haDirectMounter.isSelectedExternalReady(), false);
  card._activeStreamType = "webrtc";
  assert.equal(optionsByFactory.haDirectMounter.isSelectedExternalReady(), true);
  assert.equal(optionsByFactory.haDirectMounter.shouldPreload(), true);
  editorHandoffContext = "preconfig";
  assert.equal(optionsByFactory.haDirectMounter.shouldPreload(), true);
  editorHandoffContext = "config";
  assert.equal(optionsByFactory.haDirectMounter.shouldPreload(), true);
  editorHandoffContext = "dashboard";
  assert.deepEqual(optionsByFactory.haDirectMounter.getPreloadEntities(), [
    "camera.ha",
  ]);
  assert.equal(optionsByFactory.haDirectMounter.getPreloadHost, undefined);
  assert.equal(optionsByFactory.haDirectMounter.adoptEditorPreloadedEngine, undefined);
  assert.equal(optionsByFactory.catalystHlsMounter.shouldPreload(), false);
  deviceProfile.isIOS = true;
  deviceProfile.isIOS = false;
  deviceProfile.isCatalyst = true;
  assert.equal(optionsByFactory.haDirectMounter.shouldPreload(), false);
  assert.equal(optionsByFactory.catalystHlsMounter.shouldPreload(), true);
  assert.deepEqual(optionsByFactory.catalystHlsMounter.getPreloadEntities(), [
    "camera.front",
    "camera.ha",
  ]);
  assert.strictEqual(
    optionsByFactory.catalystHlsMounter.getPreloadHost(),
    catalystHlsDeckHost,
  );
  assert.equal(
    optionsByFactory.catalystHlsMounter.hasRetainedEngine("camera.ha"),
    true,
  );
  assert.equal(
    optionsByFactory.catalystHlsMounter.retainPreloadedEngine(
      "camera.ha",
      "catalyst-engine",
    ),
    true,
  );
  assert.equal(optionsByFactory.go2rtcRaceMounter.isMobile, true);
  assert.equal(optionsByFactory.go2rtcRaceMounter.isMountTokenCurrent(7), true);
  assert.equal(optionsByFactory.go2rtcRaceMounter.isMountTokenCurrent(6), false);
  assert.equal(
    optionsByFactory.go2rtcRaceMounter.resolveConnectionType("camera.ha"),
    "ha_direct",
  );
  assert.equal(
    optionsByFactory.go2rtcTwoWayTalkBackchannel.resolveWebSocketUrl(
      "camera.front",
    ),
    "wss://example/camera.front",
  );

  optionsByFactory.go2rtcMounter.onCommittedStream("mse");
  assert.deepEqual(calls.slice(-3), [
    ["stream-type", "mse"],
    ["loading", false],
    ["fallback", false],
  ]);
  optionsByFactory.haDirectMounter.onCommittedStream("hls");
  assert.deepEqual(calls.slice(-3), [
    ["stream-type", "hls"],
    ["loading", false],
    ["fallback", false],
  ]);
  optionsByFactory.haDirectMounter.onCommittedMediaReady(
    "ha-engine",
    "ha-video",
  );
  assert.deepEqual(calls.at(-1), [
    "zoom",
    "ha-engine",
    "ha-video",
    { host: engineHost, interactionTarget: "ha-video" },
  ]);
  optionsByFactory.catalystHlsMounter.onCommittedMediaReady(
    "catalyst-engine",
    "catalyst-video",
  );
  assert.deepEqual(calls.at(-1), [
    "zoom",
    "catalyst-engine",
    "catalyst-video",
    { host: engineHost, interactionTarget: engineHost },
  ]);
  optionsByFactory.catalystHlsMounter.onPendingStream();
  assert.deepEqual(calls.at(-1), ["stream-type", "--"]);
  card._liveAudioController = {
    cancelCameraStartPreference: () => calls.push(["cancel-audio"]),
    setMuted: (muted) => calls.push(["mute", muted]),
    prepareCameraStart: (camera) => calls.push(["prepare-audio", camera]),
  };
  card._renderMuteButton = () => calls.push(["render-mute"]);
  optionsByFactory.catalystHlsMounter.onBackground();
  assert.deepEqual(calls.slice(-3), [["cancel-audio"], ["mute", true], ["render-mute"]]);
  optionsByFactory.catalystHlsMounter.onForeground();
  assert.deepEqual(calls.slice(-2), [["prepare-audio", card._activeCam], ["render-mute"]]);

  let activeMseHandler = null;
  const activeMseEngine = {
    getActivityState: () => ({
      connectedAt: 200,
      lastChunkAt: 225,
      chunkCount: 4,
    }),
    setActivityHandler: (handler) => {
      activeMseHandler = handler;
    },
  };
  card._engine = activeMseEngine;
  optionsByFactory.go2rtcRaceMounter.activateMseDiagnostics(activeMseEngine);
  assert.equal(card._mseConnectAt, 200);
  assert.equal(card._mseLastChunkAt, 225);
  assert.equal(card._mseChunkCount, 4);
  activeMseHandler(250);
  assert.equal(card._mseLastChunkAt, 250);
  assert.equal(card._mseChunkCount, 5);
  card._engine = {};
  activeMseHandler(275);
  assert.equal(card._mseLastChunkAt, 250);
  assert.equal(card._mseChunkCount, 5);

  await optionsByFactory.go2rtcResolver.discoverEntity("camera.front");
  assert.deepEqual(calls.at(-1), ["discover", "camera.front"]);

  let removed = false;
  const audio = {
    dataset: {},
    remove: () => {
      removed = true;
    },
  };
  const releaseAudio =
    optionsByFactory.haDirectTwoWayTalkBackchannel.mountIncomingAudio(audio);
  assert.equal(audio.dataset.fvcTwoWayTalkAudio, "");
  assert.deepEqual(calls.at(-1), ["append-audio", audio]);
  releaseAudio();
  assert.equal(removed, true);

  const startsBeforeAdoption = backgroundStarts;
  const winner = { type: "webrtc", slot: { style: {} }, engine: {} };
  assert.equal(optionsByFactory.go2rtcRaceMounter.adoptMountedAttempt({}, winner), true);
  assert.equal(backgroundStarts, startsBeforeAdoption + 1,
    "a selected Frigate race winner releases the sequential HA-only background queue");
});
