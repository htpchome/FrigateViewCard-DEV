import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createEditorLiveHandoffController,
  createLiveMountController,
} from "../src/features/live/mount-controller.js";

test("editor WebRTC handoff transfers and returns one established engine", () => {
  const engine = {
    type: "frigate_go2rtc",
    streamType: "webrtc",
    deactivateRecoveryCalls: 0,
    deactivateRecovery() {
      this.deactivateRecoveryCalls += 1;
    },
  };
  const donorState = {
    activeStreamType: "webrtc",
    engine,
    entity: "camera.front",
    hasSlot: true,
    hostConnected: false,
    mountInProgress: false,
    previewPageActive: false,
    started: true,
    twoWayTalkActive: false,
    useGo2Rtc: true,
    viewMode: "single",
  };
  const receiverState = {
    ...donorState,
    engine: null,
  };
  let donor = null;
  let receiver = null;
  let donorSyncCalls = 0;
  donor = createEditorLiveHandoffController({
    getState: () => donorState,
    getContext: () => "preconfig",
    getIdentityKey: () => "matching-card",
    isEditorLifecycleActive: () => true,
    requestHandoff: () => null,
    isEngineReusable: (candidate, streamType) =>
      candidate === engine && streamType === "webrtc",
    detachEngine: () => {
      donorState.engine = null;
    },
    setStreamLoading: () => {},
    setStreamFallbackVisible: () => {},
    scheduleResumeLive: () => {},
    adoptEngine: (candidate, streamType) => {
      assert.equal(streamType, "webrtc");
      donorState.engine = candidate;
      return true;
    },
    syncLivePresentation: () => {
      donorSyncCalls += 1;
    },
  });
  receiver = createEditorLiveHandoffController({
    getState: () => receiverState,
    getContext: () => "config",
    getIdentityKey: () => "matching-card",
    isEditorLifecycleActive: () => true,
    requestHandoff: (request) => donor.createOffer(request),
    isEngineReusable: (candidate, streamType) =>
      candidate === engine && streamType === "webrtc",
    detachEngine: () => {
      receiverState.engine = null;
    },
    setStreamLoading: () => {},
    setStreamFallbackVisible: () => {},
    scheduleResumeLive: () => {},
    adoptEngine: (candidate, streamType) => {
      assert.equal(streamType, "webrtc");
      receiverState.engine = candidate;
      return true;
    },
    syncLivePresentation: () => {},
  });

  const transfer = receiver.take("camera.front", "webrtc");
  assert.equal(transfer?.engine, engine);
  assert.equal(donorState.engine, null);
  assert.equal(donor.isSuspended(), true);
  receiverState.engine = transfer.engine;
  transfer.commit();
  donorState.hostConnected = true;

  assert.equal(receiver.returnIfPossible(), true);
  assert.equal(receiverState.engine, null);
  assert.equal(donorState.engine, engine);
  assert.equal(donor.isSuspended(), false);
  assert.equal(engine.deactivateRecoveryCalls, 2);
  assert.equal(donorSyncCalls, 1);
});

test("editor live handoff rejects mismatched transports and active talk sessions", () => {
  const current = {
    activeStreamType: "webrtc",
    engine: { type: "ha_direct" },
    entity: "camera.front",
    hasSlot: true,
    hostConnected: true,
    mountInProgress: false,
    previewPageActive: false,
    started: true,
    twoWayTalkActive: false,
    useGo2Rtc: false,
    viewMode: "single",
  };
  const controller = createEditorLiveHandoffController({
    getState: () => current,
    getContext: () => "preconfig",
    getIdentityKey: () => "matching-card",
    isEditorLifecycleActive: () => true,
    isEngineReusable: () => true,
  });
  const request = {
    context: "config",
    entity: "camera.front",
    key: "matching-card",
    streamType: "webrtc",
    type: "frigate-go2rtc-live",
  };

  assert.equal(controller.createOffer(request), null);
  current.engine = {
    type: "frigate_go2rtc",
    streamType: "webrtc",
  };
  current.useGo2Rtc = true;
  current.twoWayTalkActive = true;
  assert.equal(controller.createOffer(request), null);
});

test("config preview request can claim live before donor observes editor lifecycle", () => {
  const engine = {
    type: "ha_direct",
    streamType: "hls",
    catalystHls: true,
    video: {},
    pc: {},
    deactivateRecovery() {},
  };
  const current = {
    activeStreamType: "hls",
    engine,
    entity: "camera.front",
    hasSlot: true,
    hostConnected: true,
    mountInProgress: false,
    previewPageActive: false,
    started: true,
    twoWayTalkActive: false,
    useGo2Rtc: false,
    viewMode: "single",
  };
  const controller = createEditorLiveHandoffController({
    getState: () => current,
    getContext: () => "dashboard",
    getIdentityKey: () => "matching-card",
    isEditorLifecycleActive: () => false,
    isEngineReusable: (candidate) => candidate === engine,
    detachEngine: () => {
      current.engine = null;
      return true;
    },
  });
  const request = {
    context: "config",
    entity: "camera.front",
    key: "matching-card",
    streamType: "hls",
    type: "ha-direct-catalyst-hls-live",
  };

  assert.equal(
    controller.createOffer({ ...request, context: "dashboard" }),
    null,
  );
  current.hasSlot = false;
  assert.equal(controller.createOffer(request), null);
  current.hasSlot = true;
  current.viewMode = "grid";
  assert.equal(controller.createOffer(request), null);
  current.viewMode = "single";

  const offer = controller.createOffer(request);
  assert.ok(offer);
  assert.strictEqual(offer.claim(), engine);
  assert.equal(current.engine, null);
});


test("pre-editor handoff returns directly to the original dashboard owner", () => {
  const engine = {
    type: "ha_direct",
    streamType: "hls",
    catalystHls: true,
    deactivateRecovery() {},
  };
  const dashboardState = {
    activeStreamType: "hls",
    engine,
    entity: "camera.front",
    hasSlot: true,
    hostConnected: true,
    mountInProgress: false,
    previewPageActive: false,
    started: true,
    twoWayTalkActive: false,
    useGo2Rtc: false,
    viewMode: "single",
  };
  const preEditorState = { ...dashboardState, engine: null };
  const editorState = { ...dashboardState, engine: null };
  const createController = (state, context, requestHandoff) => {
    const controller = createEditorLiveHandoffController({
      getState: () => state,
      getContext: () => context,
      getIdentityKey: () => "matching-card",
      getConnectionType: () => "ha_direct",
      isEditorLifecycleActive: () => true,
      requestHandoff,
      isEngineReusable: (candidate) => candidate === engine,
      detachEngine: () => {
        state.engine = null;
        return true;
      },
      adoptEngine: (candidate) => {
        state.engine = candidate;
        return true;
      },
      syncLivePresentation: () => {},
    });
    return controller;
  };
  const dashboard = createController(dashboardState, "dashboard", () => null);
  const preEditor = createController(preEditorState, "preconfig", (request) =>
    dashboard.createOffer(request),
  );
  const editor = createController(editorState, "config", (request) =>
    preEditor.createOffer(request),
  );

  const preEditorTransfer = preEditor.take(
    "camera.front",
    "hls",
    "ha_direct",
  );
  preEditorState.engine = preEditorTransfer.engine;
  preEditorTransfer.commit();
  assert.equal(dashboard.isSuspended(), true);
  dashboardState.hostConnected = false;

  const editorTransfer = editor.take(
    "camera.front",
    "hls",
    "ha_direct",
  );
  editorState.engine = editorTransfer.engine;
  editorTransfer.commit();
  assert.equal(preEditor.isSuspended(), true);

  dashboardState.hostConnected = true;
  assert.equal(editor.returnIfPossible(), true);
  assert.strictEqual(dashboardState.engine, engine);
  assert.equal(dashboard.isSuspended(), false);
  assert.equal(preEditorState.engine, null);
});


test("editor Catalyst HLS handoff transfers and returns one native engine", () => {
  const engine = {
    type: "ha_direct",
    streamType: "hls",
    catalystHls: true,
  };
  const donorState = {
    activeStreamType: "hls",
    engine,
    entity: "camera.front",
    hasSlot: true,
    hostConnected: false,
    mountInProgress: false,
    previewPageActive: false,
    started: true,
    twoWayTalkActive: false,
    useGo2Rtc: false,
    viewMode: "single",
  };
  const receiverState = { ...donorState, engine: null };
  let requestedType = "";
  let donor;
  donor = createEditorLiveHandoffController({
    getState: () => donorState,
    getContext: () => "preconfig",
    getIdentityKey: () => "matching-card",
    isEditorLifecycleActive: () => true,
    requestHandoff: () => null,
    isEngineReusable: (candidate, streamType, connectionType) =>
      candidate === engine &&
      streamType === "hls" &&
      connectionType === "ha_direct",
    detachEngine: () => {
      donorState.engine = null;
      return true;
    },
    adoptEngine: (candidate) => {
      donorState.engine = candidate;
      return true;
    },
  });
  const receiver = createEditorLiveHandoffController({
    getState: () => receiverState,
    getContext: () => "config",
    getIdentityKey: () => "matching-card",
    isEditorLifecycleActive: () => true,
    requestHandoff: (request) => {
      requestedType = request.type;
      return donor.createOffer(request);
    },
    isEngineReusable: (candidate, streamType, connectionType) =>
      candidate === engine &&
      streamType === "hls" &&
      connectionType === "ha_direct",
    detachEngine: () => {
      receiverState.engine = null;
      return true;
    },
    adoptEngine: (candidate) => {
      receiverState.engine = candidate;
      return true;
    },
  });

  const transfer = receiver.take("camera.front", "hls", "ha_direct");
  assert.equal(requestedType, "ha-direct-catalyst-hls-live");
  assert.equal(transfer?.engine, engine);
  assert.equal(donorState.engine, null);
  receiverState.engine = transfer.engine;
  transfer.commit();
  donorState.hostConnected = true;

  assert.equal(receiver.returnIfPossible(), true);
  assert.equal(receiverState.engine, null);
  assert.equal(donorState.engine, engine);
});

test("editor MSE handoff transfers and returns one established engine", () => {
  const engine = {
    type: "frigate_go2rtc",
    streamType: "mse",
    deactivateRecovery() {},
  };
  const donorState = {
    activeStreamType: "mse",
    engine,
    entity: "camera.front",
    hasSlot: true,
    hostConnected: false,
    mountInProgress: false,
    previewPageActive: false,
    started: true,
    twoWayTalkActive: false,
    useGo2Rtc: true,
    viewMode: "single",
  };
  const receiverState = { ...donorState, engine: null };
  let donor;
  donor = createEditorLiveHandoffController({
    getState: () => donorState,
    getContext: () => "preconfig",
    getIdentityKey: () => "matching-card",
    isEditorLifecycleActive: () => true,
    isEngineReusable: (candidate, streamType) =>
      candidate === engine && streamType === "mse",
    detachEngine: () => {
      donorState.engine = null;
    },
    adoptEngine: (candidate, streamType) => {
      assert.equal(streamType, "mse");
      donorState.engine = candidate;
      return true;
    },
  });
  const receiver = createEditorLiveHandoffController({
    getState: () => receiverState,
    getContext: () => "config",
    getIdentityKey: () => "matching-card",
    isEditorLifecycleActive: () => true,
    requestHandoff: (request) => donor.createOffer(request),
    isEngineReusable: (candidate, streamType) =>
      candidate === engine && streamType === "mse",
    detachEngine: () => {
      receiverState.engine = null;
    },
    adoptEngine: (candidate, streamType) => {
      assert.equal(streamType, "mse");
      receiverState.engine = candidate;
      return true;
    },
  });

  const transfer = receiver.take("camera.front", "mse");
  assert.equal(transfer?.engine, engine);
  receiverState.engine = transfer.engine;
  transfer.commit();
  donorState.hostConnected = true;

  assert.equal(receiver.returnIfPossible(), true);
  assert.equal(receiverState.engine, null);
  assert.equal(donorState.engine, engine);
});

test("grid mounts do not cancel the existing main live session", async () => {
  let cancelCount = 0;
  let gridMountCount = 0;
  const controller = createLiveMountController({
    getSlot: () => ({}),
    isPreviewPageActive: () => false,
    getViewMode: () => "grid",
    isGridModeAvailable: () => true,
    getMountInProgress: () => false,
    getMountTargetEntity: () => "",
    cancelPendingMount: () => {
      cancelCount += 1;
    },
    mountGridEngine: () => {
      gridMountCount += 1;
    },
  });

  await controller.mount({ entity: "camera.front" });

  assert.equal(gridMountCount, 1);
  assert.equal(cancelCount, 0);
});

test("live mount controller delegates ha-direct mounts outside the card shell", async () => {
  const calls = [];
  const slot = { innerHTML: "occupied" };
  let mountState = {
    mountSeq: 6,
    mountInProgress: false,
    mountStartedAt: 0,
    mountTargetEntity: "",
  };
  const controller = createLiveMountController({
    getSlot: () => slot,
    isPreviewPageActive: () => false,
    getViewMode: () => "single",
    isGridModeAvailable: () => true,
    getMountInProgress: () => false,
    getMountTargetEntity: () => "",
    getMountState: () => mountState,
    applyMountTrackingState: (nextState) => {
      mountState = nextState;
      calls.push(["applyMountTrackingState", nextState]);
    },
    cancelPendingMount: () => {
      calls.push(["cancelPendingMount"]);
    },
    mountGridEngine: () => {
      calls.push(["mountGridEngine"]);
    },
    cleanupEngine: () => {
      calls.push(["cleanupEngine"]);
    },
    getStreamMuted: () => true,
    setEngineMountedMuted: (muted) => {
      calls.push(["setEngineMountedMuted", muted]);
    },
    liveGraceController: {
      takeGraceMseEntry: () => null,
      adoptGraceMseEngine: () => false,
    },
    getPendingMountDestroyers: () => [],
    setPendingMountDestroyers: () => {},
    haDirectMounter: {
      tryMount: async (...args) => {
        calls.push(["haDirectTryMount", ...args]);
        return { ok: true };
      },
    },
    go2rtcRaceMounter: {
      mountWithRace: async (...args) => {
        calls.push(["go2rtcRaceMount", ...args]);
        return false;
      },
    },
    preferredStreamType: () => "webrtc",
    setActiveStreamType: (type) => {
      calls.push(["setActiveStreamType", type]);
    },
    setStreamLoading: (loading) => {
      calls.push(["setStreamLoading", loading]);
    },
    setStreamFallbackVisible: (visible, refreshImage = false) => {
      calls.push(["setStreamFallbackVisible", visible, refreshImage]);
    },
    scheduleResumeLive: (reason) => {
      calls.push(["scheduleResumeLive", reason]);
    },
    resolveUseGo2Rtc: () => false,
  });

  await controller.mount({ entity: "camera.front", quiet: true });

  assert.deepEqual(calls[0], ["setEngineMountedMuted", true]);
  assert.equal(calls[1][0], "applyMountTrackingState");
  assert.equal(calls[1][1].mountSeq, 7);
  assert.equal(calls[1][1].mountInProgress, true);
  assert.equal(calls[1][1].mountTargetEntity, "camera.front");
  assert.equal(calls[1][1].mountStartedAt > 0, true);
  assert.deepEqual(calls[2], ["cleanupEngine"]);
  assert.deepEqual(calls[3], ["setStreamFallbackVisible", false, false]);
  assert.deepEqual(calls[4], ["setStreamLoading", false]);
  assert.deepEqual(calls[5], [
    "haDirectTryMount",
    slot,
    { streamType: "webrtc" },
    {
      entity: "camera.front",
      commit: true,
      mountToken: 7,
    },
  ]);
  assert.deepEqual(calls[6], ["setEngineMountedMuted", true]);
  assert.equal(calls[7][0], "applyMountTrackingState");
  assert.equal(calls[7][1].mountSeq, 7);
  assert.equal(calls[7][1].mountInProgress, false);
  assert.equal(calls[7][1].mountStartedAt, 0);
  assert.equal(calls[7][1].mountTargetEntity, "");
  assert.equal(mountState.mountSeq, 7);
  assert.equal(mountState.mountInProgress, false);
});

test("Catalyst mounts through the dedicated HLS side path", async () => {
  const calls = [];
  const slot = { innerHTML: "occupied" };
  let mountState = {
    mountSeq: 0,
    mountInProgress: false,
    mountStartedAt: 0,
    mountTargetEntity: "",
  };
  const controller = createLiveMountController({
    getSlot: () => slot,
    isPreviewPageActive: () => false,
    getViewMode: () => "single",
    isGridModeAvailable: () => true,
    getMountInProgress: () => mountState.mountInProgress,
    getMountTargetEntity: () => mountState.mountTargetEntity,
    getMountState: () => mountState,
    applyMountTrackingState: (nextState) => {
      mountState = nextState;
    },
    cleanupEngine: () => calls.push(["cleanup"]),
    getStreamMuted: () => true,
    setEngineMountedMuted: () => {},
    liveGraceController: {
      takeGraceHaDirectEntry: () => {
        throw new Error("Catalyst must not enter HA Direct grace reuse");
      },
      takeGraceCatalystHlsEntry: (entity) => {
        calls.push(["take-catalyst-grace", entity]);
        return null;
      },
      takeGraceMseEntry: () => null,
    },
    getPendingMountDestroyers: () => [],
    setPendingMountDestroyers: () => {},
    catalystHlsMounter: {
      tryMount: async (...args) => {
        calls.push(["catalyst", ...args]);
        return { ok: true };
      },
    },
    haDirectMounter: {
      tryMount: async () => {
        throw new Error("normal HA Direct must not mount on Catalyst");
      },
    },
    go2rtcRaceMounter: {
      mountWithRace: async () => {
        throw new Error("go2rtc must not mount for HA Direct");
      },
    },
    preferredStreamType: () => "webrtc",
    setActiveStreamType: () => {},
    setStreamLoading: () => {},
    setStreamFallbackVisible: () => {},
    scheduleResumeLive: () => {},
    resolveUseGo2Rtc: () => false,
    shouldUseCatalystHls: () => true,
    takeEditorLiveHandoff: (request) => {
      calls.push(["take-handoff", request]);
      return null;
    },
  });

  assert.equal(
    await controller.mount({
      entity: "camera.front",
      forcedType: "webrtc",
    }),
    true,
  );
  assert.deepEqual(calls[0], ["take-catalyst-grace", "camera.front"]);
  assert.deepEqual(calls[1], [
    "take-handoff",
    {
      connectionType: "ha_direct",
      entity: "camera.front",
      streamType: "hls",
    },
  ]);
  assert.equal(calls[2][0], "cleanup");
  assert.deepEqual(calls[3], [
    "catalyst",
    slot,
    { streamType: "hls" },
    { entity: "camera.front", commit: true },
  ]);
});

test("Catalyst reclaims its retained native HLS player before reconnecting", async () => {
  const calls = [];
  const slot = { innerHTML: "occupied" };
  const cachedEngine = {
    type: "ha_direct",
    streamType: "hls",
    catalystHls: true,
  };
  const controller = createLiveMountController({
    getSlot: () => slot,
    isPreviewPageActive: () => false,
    getViewMode: () => "single",
    isGridModeAvailable: () => true,
    getMountInProgress: () => false,
    getMountTargetEntity: () => "",
    getMountState: () => ({
      mountSeq: 1,
      mountInProgress: false,
      mountStartedAt: 0,
      mountTargetEntity: "",
    }),
    applyMountTrackingState: () => {},
    cleanupEngine: () => calls.push(["cleanup"]),
    getStreamMuted: () => true,
    setEngineMountedMuted: () => {},
    liveGraceController: {
      takeGraceCatalystHlsEntry: (entity) => {
        calls.push(["take", entity]);
        return { engine: cachedEngine };
      },
      adoptGraceCatalystHlsEngine: (targetSlot, engine) => {
        calls.push(["adopt", targetSlot, engine]);
        return true;
      },
      takeGraceHaDirectEntry: () => {
        throw new Error("Catalyst must not use normal HA Direct grace");
      },
    },
    getPendingMountDestroyers: () => [],
    setPendingMountDestroyers: () => {},
    catalystHlsMounter: {
      tryMount: async () => {
        throw new Error("Catalyst must not reconnect after grace reuse");
      },
    },
    preferredStreamType: () => "webrtc",
    setActiveStreamType: () => {},
    setStreamLoading: () => {},
    setStreamFallbackVisible: () => {},
    scheduleResumeLive: () => {},
    resolveUseGo2Rtc: () => false,
    shouldUseCatalystHls: () => true,
    takeEditorLiveHandoff: () => {
      throw new Error("Editor handoff must not run after grace reuse");
    },
  });

  assert.equal(await controller.mount({ entity: "camera.front" }), true);
  assert.deepEqual(calls, [
    ["take", "camera.front"],
    ["adopt", slot, cachedEngine],
  ]);
});

test("Catalyst adopts an editor native HLS handoff before reconnecting", async () => {
  const calls = [];
  const slot = { innerHTML: "occupied" };
  const handedOffEngine = {
    type: "ha_direct",
    streamType: "hls",
    catalystHls: true,
  };
  const controller = createLiveMountController({
    getSlot: () => slot,
    isPreviewPageActive: () => false,
    getViewMode: () => "single",
    isGridModeAvailable: () => true,
    getMountInProgress: () => false,
    getMountTargetEntity: () => "",
    getMountState: () => ({
      mountSeq: 1,
      mountInProgress: false,
      mountStartedAt: 0,
      mountTargetEntity: "",
    }),
    applyMountTrackingState: () => {},
    cleanupEngine: () => calls.push(["cleanup"]),
    getStreamMuted: () => true,
    setEngineMountedMuted: () => {},
    liveGraceController: {},
    getPendingMountDestroyers: () => [],
    setPendingMountDestroyers: () => {},
    catalystHlsMounter: {
      adoptRetainedEngine: (targetSlot, engine) => {
        calls.push(["adopt", targetSlot, engine]);
        return true;
      },
      tryMount: async () => {
        throw new Error("Catalyst must not reconnect after editor handoff");
      },
    },
    preferredStreamType: () => "webrtc",
    setActiveStreamType: () => {},
    setStreamLoading: () => {},
    setStreamFallbackVisible: () => {},
    scheduleResumeLive: () => {},
    resolveUseGo2Rtc: () => false,
    shouldUseCatalystHls: () => true,
    takeEditorLiveHandoff: (request) => {
      calls.push(["take", request]);
      return {
        engine: handedOffEngine,
        commit: () => calls.push(["commit"]),
      };
    },
  });

  assert.equal(await controller.mount({ entity: "camera.front" }), true);
  assert.deepEqual(calls, [
    [
      "take",
      {
        connectionType: "ha_direct",
        entity: "camera.front",
        streamType: "hls",
      },
    ],
    ["adopt", slot, handedOffEngine],
    ["commit"],
  ]);
});

test("HA-direct mount ownership prevents lifecycle callbacks from replacing startup", async () => {
  const slot = { innerHTML: "occupied" };
  let mountState = {
    mountSeq: 0,
    mountInProgress: false,
    mountStartedAt: 0,
    mountTargetEntity: "",
  };
  let finishStartup;
  const startupReady = new Promise((resolve) => {
    finishStartup = resolve;
  });
  let mountCalls = 0;
  let cleanupCalls = 0;
  const controller = createLiveMountController({
    getSlot: () => slot,
    isPreviewPageActive: () => false,
    getViewMode: () => "single",
    isGridModeAvailable: () => true,
    getMountInProgress: () => mountState.mountInProgress,
    getMountTargetEntity: () => mountState.mountTargetEntity,
    getMountState: () => mountState,
    applyMountTrackingState: (nextState) => {
      mountState = nextState;
    },
    mountGridEngine: () => {},
    cleanupEngine: () => {
      cleanupCalls += 1;
    },
    getStreamMuted: () => true,
    setEngineMountedMuted: () => {},
    liveGraceController: {
      takeGraceHaDirectEntry: () => null,
      adoptGraceHaDirectEngine: () => false,
    },
    getPendingMountDestroyers: () => [],
    setPendingMountDestroyers: () => {},
    haDirectMounter: {
      tryMount: async () => {
        mountCalls += 1;
        return { ok: true, startupReady };
      },
    },
    preferredStreamType: () => "webrtc",
    setActiveStreamType: () => {},
    setStreamLoading: () => {},
    setStreamFallbackVisible: () => {},
    scheduleResumeLive: () => {},
    resolveUseGo2Rtc: () => false,
  });

  const firstMount = controller.mount({ entity: "camera.front" });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(mountState.mountInProgress, true);
  assert.equal(mountState.mountTargetEntity, "camera.front");
  assert.equal(mountCalls, 1);
  assert.equal(cleanupCalls, 1);

  assert.equal(
    await controller.mount({ entity: "camera.front" }),
    false,
  );
  assert.equal(mountCalls, 1);
  assert.equal(cleanupCalls, 1);

  finishStartup(true);
  assert.equal(await firstMount, true);
  assert.equal(mountState.mountInProgress, false);
  assert.equal(mountState.mountTargetEntity, "");
});

test("live mount controller delegates go2rtc race mounts outside the card shell", async () => {
  const calls = [];
  const slot = { innerHTML: "occupied" };
  let mountState = {
    mountSeq: 8,
    mountInProgress: false,
    mountStartedAt: 0,
    mountTargetEntity: "",
  };
  const controller = createLiveMountController({
    getSlot: () => slot,
    isPreviewPageActive: () => false,
    getViewMode: () => "single",
    isGridModeAvailable: () => true,
    getMountInProgress: () => false,
    getMountTargetEntity: () => "",
    getMountState: () => mountState,
    applyMountTrackingState: (nextState) => {
      mountState = nextState;
      calls.push(["applyMountTrackingState", nextState]);
    },
    cancelPendingMount: () => {},
    mountGridEngine: () => {},
    cleanupEngine: () => {
      calls.push(["cleanupEngine"]);
    },
    getStreamMuted: () => false,
    setEngineMountedMuted: (muted) => {
      calls.push(["setEngineMountedMuted", muted]);
    },
    liveGraceController: {
      takeGraceMseEntry: () => null,
      adoptGraceMseEngine: () => false,
    },
    getPendingMountDestroyers: () => [],
    setPendingMountDestroyers: () => {},
    haDirectMounter: {
      tryMount: async () => ({ ok: false }),
    },
    go2rtcRaceMounter: {
      mountWithRace: async (options) => {
        calls.push(["go2rtcRaceMount", options]);
        return true;
      },
    },
    preferredStreamType: () => "webrtc",
    setActiveStreamType: (type) => {
      calls.push(["setActiveStreamType", type]);
    },
    setStreamLoading: (loading) => {
      calls.push(["setStreamLoading", loading]);
    },
    setStreamFallbackVisible: (visible, refreshImage = false) => {
      calls.push(["setStreamFallbackVisible", visible, refreshImage]);
    },
    scheduleResumeLive: (reason) => {
      calls.push(["scheduleResumeLive", reason]);
    },
    resolveUseGo2Rtc: () => true,
  });

  await controller.mount({ entity: "camera.front", forcedType: "webrtc" });

  assert.deepEqual(calls[0], ["setEngineMountedMuted", false]);
  assert.equal(calls[1][0], "applyMountTrackingState");
  assert.equal(calls[1][1].mountSeq, 9);
  assert.equal(calls[1][1].mountInProgress, true);
  assert.equal(calls[1][1].mountTargetEntity, "camera.front");
  assert.equal(calls[1][1].mountStartedAt > 0, true);
  assert.deepEqual(calls[2], ["cleanupEngine"]);
  assert.deepEqual(calls[3], ["setActiveStreamType", "--"]);
  assert.deepEqual(calls[4], ["setStreamFallbackVisible", true, true]);
  assert.deepEqual(calls[5], ["setStreamLoading", true]);
  assert.deepEqual(calls[6], [
    "go2rtcRaceMount",
    {
      slot,
      entity: "camera.front",
      forcedType: "webrtc",
      mountToken: 9,
    },
  ]);
  assert.equal(calls[7][0], "applyMountTrackingState");
  assert.equal(calls[7][1].mountSeq, 9);
  assert.equal(calls[7][1].mountInProgress, false);
  assert.equal(calls[7][1].mountStartedAt, 0);
  assert.equal(calls[7][1].mountTargetEntity, "");
});

test("live mount controller reuses a cached WebRTC engine before starting a race", async () => {
  const calls = [];
  const slot = { innerHTML: "occupied" };
  const cachedEngine = { video: {} };
  const controller = createLiveMountController({
    getSlot: () => slot,
    isPreviewPageActive: () => false,
    getViewMode: () => "single",
    isGridModeAvailable: () => true,
    getMountInProgress: () => false,
    getMountTargetEntity: () => "",
    getMountState: () => ({
      mountSeq: 1,
      mountInProgress: false,
      mountStartedAt: 0,
      mountTargetEntity: "",
    }),
    applyMountTrackingState: () => {},
    cancelPendingMount: () => {},
    mountGridEngine: () => {},
    cleanupEngine: () => calls.push("cleanup"),
    getStreamMuted: () => true,
    setEngineMountedMuted: () => {},
    liveGraceController: {
      takeGraceWebRtcEntry: (entity) => {
        calls.push(["take-webrtc", entity]);
        return { engine: cachedEngine };
      },
      adoptGraceWebRtcEngine: (targetSlot, engine) => {
        calls.push(["adopt-webrtc", targetSlot, engine]);
        return true;
      },
      takeGraceMseEntry: () => {
        throw new Error("MSE cache should not be checked after WebRTC reuse");
      },
      adoptGraceMseEngine: () => false,
    },
    getPendingMountDestroyers: () => [],
    setPendingMountDestroyers: () => {},
    haDirectMounter: {
      tryMount: async () => {
        throw new Error("HA mount should not run after WebRTC reuse");
      },
    },
    go2rtcRaceMounter: {
      mountWithRace: async () => {
        throw new Error("Transport race should not run after WebRTC reuse");
      },
    },
    preferredStreamType: () => "webrtc",
    setActiveStreamType: () => {},
    setStreamLoading: () => {},
    setStreamFallbackVisible: () => {},
    scheduleResumeLive: () => {},
    resolveUseGo2Rtc: () => true,
  });

  await controller.mount({ entity: "camera.front" });

  assert.deepEqual(calls, [
    ["take-webrtc", "camera.front"],
    ["adopt-webrtc", slot, cachedEngine],
  ]);
});

test("live mount controller adopts an editor WebRTC handoff before starting a race", async () => {
  const calls = [];
  const slot = { innerHTML: "occupied" };
  const handedOffEngine = { video: {} };
  const controller = createLiveMountController({
    getSlot: () => slot,
    isPreviewPageActive: () => false,
    getViewMode: () => "single",
    isGridModeAvailable: () => true,
    getMountInProgress: () => false,
    getMountTargetEntity: () => "",
    getMountState: () => ({
      mountSeq: 1,
      mountInProgress: false,
      mountStartedAt: 0,
      mountTargetEntity: "",
    }),
    applyMountTrackingState: () => {},
    mountGridEngine: () => {},
    cleanupEngine: () => calls.push("cleanup"),
    getStreamMuted: () => true,
    setEngineMountedMuted: () => {},
    liveGraceController: {
      takeGraceWebRtcEntry: () => null,
      adoptGraceWebRtcEngine: (targetSlot, engine) => {
        calls.push(["adopt-handoff", targetSlot, engine]);
        return true;
      },
      takeGraceMseEntry: () => {
        throw new Error("MSE reuse should not run after editor handoff");
      },
    },
    takeEditorLiveHandoff: ({ entity, streamType }) => {
      calls.push(["take-handoff", entity, streamType]);
      return {
        engine: handedOffEngine,
        commit: () => calls.push("commit-handoff"),
      };
    },
    go2rtcRaceMounter: {
      mountWithRace: async () => {
        throw new Error("Transport race should not run after editor handoff");
      },
    },
    preferredStreamType: () => "webrtc",
    setActiveStreamType: () => {},
    setStreamLoading: () => {},
    setStreamFallbackVisible: () => {},
    scheduleResumeLive: () => {},
    resolveUseGo2Rtc: () => true,
  });

  assert.equal(await controller.mount({ entity: "camera.front" }), true);
  assert.deepEqual(calls, [
    ["take-handoff", "camera.front", "webrtc"],
    ["adopt-handoff", slot, handedOffEngine],
    "commit-handoff",
  ]);
});

test("live mount controller adopts an editor MSE handoff before starting a race", async () => {
  const calls = [];
  const slot = { innerHTML: "occupied" };
  const handedOffEngine = { video: {}, ws: { readyState: 1 } };
  const controller = createLiveMountController({
    getSlot: () => slot,
    isPreviewPageActive: () => false,
    getViewMode: () => "single",
    isGridModeAvailable: () => true,
    getMountInProgress: () => false,
    getMountTargetEntity: () => "",
    getMountState: () => ({
      mountSeq: 1,
      mountInProgress: false,
      mountStartedAt: 0,
      mountTargetEntity: "",
    }),
    applyMountTrackingState: () => {},
    mountGridEngine: () => {},
    cleanupEngine: () => calls.push("cleanup"),
    getStreamMuted: () => true,
    setEngineMountedMuted: () => {},
    liveGraceController: {
      takeGraceWebRtcEntry: () => null,
      adoptGraceWebRtcEngine: () => false,
      takeGraceMseEntry: () => null,
      adoptGraceMseEngine: (targetSlot, engine) => {
        calls.push(["adopt-mse-handoff", targetSlot, engine]);
        return true;
      },
    },
    takeEditorLiveHandoff: ({ entity, streamType }) => {
      calls.push(["take-handoff", entity, streamType]);
      if (streamType !== "mse") return null;
      return {
        engine: handedOffEngine,
        commit: () => calls.push("commit-handoff"),
      };
    },
    go2rtcRaceMounter: {
      mountWithRace: async () => {
        throw new Error("Transport race should not run after MSE handoff");
      },
    },
    preferredStreamType: () => "mse",
    setActiveStreamType: () => {},
    setStreamLoading: () => {},
    setStreamFallbackVisible: () => {},
    scheduleResumeLive: () => {},
    resolveUseGo2Rtc: () => true,
  });

  assert.equal(await controller.mount({ entity: "camera.front" }), true);
  assert.deepEqual(calls, [
    ["take-handoff", "camera.front", "webrtc"],
    ["take-handoff", "camera.front", "mse"],
    ["adopt-mse-handoff", slot, handedOffEngine],
    "commit-handoff",
  ]);
});



test("failed pending MSE reuse falls through to a fresh transport race", async () => {
  const calls = [];
  const slot = { innerHTML: "occupied" };
  let mountState = {
    mountSeq: 0,
    mountInProgress: false,
    mountStartedAt: 0,
    mountTargetEntity: "",
  };
  let pendingDestroyers = [];
  let graceEntryAvailable = true;
  const controller = createLiveMountController({
    getSlot: () => slot,
    isPreviewPageActive: () => false,
    getViewMode: () => "single",
    isGridModeAvailable: () => true,
    getMountInProgress: () => mountState.mountInProgress,
    getMountTargetEntity: () => mountState.mountTargetEntity,
    getMountState: () => mountState,
    applyMountTrackingState: (nextState) => {
      mountState = nextState;
    },
    mountGridEngine: () => {},
    cleanupEngine: () => calls.push("cleanup"),
    getStreamMuted: () => true,
    setEngineMountedMuted: () => {},
    liveGraceController: {
      takeGraceWebRtcEntry: () => null,
      adoptGraceWebRtcEngine: () => false,
      takeGraceMseEntry: () => {
        if (!graceEntryAvailable) return null;
        graceEntryAvailable = false;
        return { promise: Promise.resolve(null) };
      },
      adoptGraceMseEngine: () => false,
    },
    getPendingMountDestroyers: () => pendingDestroyers,
    setPendingMountDestroyers: (nextDestroyers) => {
      pendingDestroyers = nextDestroyers;
    },
    haDirectMounter: { tryMount: async () => ({ ok: false }) },
    go2rtcRaceMounter: {
      mountWithRace: async (options) => {
        calls.push(["race", options.entity]);
        return true;
      },
    },
    preferredStreamType: () => "webrtc",
    setActiveStreamType: (type) => calls.push(["type", type]),
    setStreamLoading: (loading) => calls.push(["loading", loading]),
    setStreamFallbackVisible: () => {},
    scheduleResumeLive: () => {},
    resolveUseGo2Rtc: () => true,
  });

  await controller.mount({ entity: "camera.front" });

  assert.equal(calls.filter((call) => call === "cleanup").length, 1);
  assert.deepEqual(
    calls.filter((call) => Array.isArray(call) && call[0] === "race"),
    [["race", "camera.front"]],
  );
  assert.equal(
    calls.filter(
      (call) => Array.isArray(call) && call[0] === "loading" && call[1],
    ).length,
    2,
  );
  assert.equal(mountState.mountSeq, 2);
  assert.equal(mountState.mountInProgress, false);
  assert.deepEqual(pendingDestroyers, []);
});

test("a cancelled camera mount cannot replace the next camera with Snapshot state", async () => {
  const calls = [];
  const slot = { innerHTML: "occupied" };
  let mountState = {
    mountSeq: 0,
    mountInProgress: false,
    mountStartedAt: 0,
    mountTargetEntity: "",
  };
  const controller = createLiveMountController({
    getSlot: () => slot,
    isPreviewPageActive: () => false,
    getViewMode: () => "single",
    isGridModeAvailable: () => true,
    getMountInProgress: () => mountState.mountInProgress,
    getMountTargetEntity: () => mountState.mountTargetEntity,
    getMountState: () => mountState,
    applyMountTrackingState: (nextState) => {
      mountState = nextState;
    },
    mountGridEngine: () => {},
    cleanupEngine: () => {},
    getStreamMuted: () => true,
    setEngineMountedMuted: () => {},
    liveGraceController: {
      takeGraceWebRtcEntry: () => null,
      takeGraceMseEntry: () => null,
    },
    getPendingMountDestroyers: () => [],
    setPendingMountDestroyers: () => {},
    haDirectMounter: { tryMount: async () => ({ ok: false }) },
    go2rtcRaceMounter: {
      mountWithRace: async () => {
        mountState = {
          mountSeq: mountState.mountSeq + 1,
          mountInProgress: true,
          mountStartedAt: Date.now(),
          mountTargetEntity: "camera.group_a",
        };
        return false;
      },
    },
    preferredStreamType: () => "webrtc",
    setActiveStreamType: (type) => calls.push(["type", type]),
    setStreamLoading: (loading) => calls.push(["loading", loading]),
    setStreamFallbackVisible: (visible) =>
      calls.push(["fallback", visible]),
    scheduleResumeLive: () => {},
    resolveUseGo2Rtc: () => true,
  });

  const mounted = await controller.mount({ entity: "camera.transient" });

  assert.equal(mounted, false);
  assert.equal(
    calls.some(([kind, value]) => kind === "type" && value === "snapshot"),
    false,
  );
  assert.equal(mountState.mountTargetEntity, "camera.group_a");
});

test("duplicate live mounts keep non-quiet connection feedback visible", async () => {
  const calls = [];
  const controller = createLiveMountController({
    getSlot: () => ({}),
    isPreviewPageActive: () => false,
    getViewMode: () => "single",
    isGridModeAvailable: () => true,
    getMountInProgress: () => true,
    getMountTargetEntity: () => "camera.front",
    setActiveStreamType: (type) => calls.push(["type", type]),
    setStreamLoading: (loading) => calls.push(["loading", loading]),
    go2rtcRaceMounter: {
      mountWithRace: async () => {
        calls.push("race");
        return true;
      },
    },
  });

  await controller.mount({ entity: "camera.front" });

  assert.deepEqual(calls, [
    ["type", "--"],
    ["loading", true],
  ]);
});

test("go2rtc talk mounts bypass receive-only grace reuse and pass microphone options", async () => {
  const slot = { innerHTML: "occupied" };
  let mountState = {
    mountSeq: 2,
    mountInProgress: false,
    mountStartedAt: 0,
    mountTargetEntity: "",
  };
  let raceOptions = null;
  const microphoneStream = { id: "microphone" };
  const onEnded = () => {};
  const controller = createLiveMountController({
    getSlot: () => slot,
    isPreviewPageActive: () => false,
    getViewMode: () => "single",
    isGridModeAvailable: () => true,
    getMountInProgress: () => mountState.mountInProgress,
    getMountTargetEntity: () => mountState.mountTargetEntity,
    getMountState: () => mountState,
    applyMountTrackingState: (nextState) => {
      mountState = nextState;
    },
    mountGridEngine: () => {},
    cleanupEngine: () => {},
    getStreamMuted: () => true,
    setEngineMountedMuted: () => {},
    liveGraceController: {
      takeGraceWebRtcEntry: () => {
        throw new Error("talk must not reuse a receive-only WebRTC peer");
      },
      takeGraceMseEntry: () => null,
    },
    getPendingMountDestroyers: () => [],
    setPendingMountDestroyers: () => {},
    haDirectMounter: { tryMount: async () => ({ ok: false }) },
    go2rtcRaceMounter: {
      mountWithRace: async (options) => {
        raceOptions = options;
        return true;
      },
    },
    preferredStreamType: () => "webrtc",
    setActiveStreamType: () => {},
    setStreamLoading: () => {},
    setStreamFallbackVisible: () => {},
    scheduleResumeLive: () => {},
    resolveUseGo2Rtc: () => true,
  });

  const mounted = await controller.mount({
    entity: "camera.front",
    forcedType: "webrtc",
    twoWayTalkOptions: { microphoneStream, onEnded },
  });

  assert.equal(mounted, true);
  assert.deepEqual(raceOptions, {
    slot,
    entity: "camera.front",
    forcedType: "webrtc",
    mountToken: 3,
    webRtcOptions: { microphoneStream, onEnded },
  });
});

test("ha-direct talk mounts use only the Home Assistant talk pipeline", async () => {
  const slot = { innerHTML: "occupied" };
  let mountState = {
    mountSeq: 4,
    mountInProgress: false,
    mountStartedAt: 0,
    mountTargetEntity: "",
  };
  let talkMountOptions = null;
  const microphoneStream = { id: "microphone" };
  const controller = createLiveMountController({
    getSlot: () => slot,
    isPreviewPageActive: () => false,
    getViewMode: () => "single",
    isGridModeAvailable: () => true,
    getMountInProgress: () => mountState.mountInProgress,
    getMountTargetEntity: () => mountState.mountTargetEntity,
    getMountState: () => mountState,
    applyMountTrackingState: (nextState) => {
      mountState = nextState;
    },
    mountGridEngine: () => {},
    cleanupEngine: () => {},
    getStreamMuted: () => false,
    setEngineMountedMuted: () => {},
    liveGraceController: {
      takeGraceWebRtcEntry: () => null,
      takeGraceMseEntry: () => null,
    },
    getPendingMountDestroyers: () => [],
    setPendingMountDestroyers: () => {},
    haDirectMounter: {
      tryMount: async () => {
        throw new Error("normal HA player must not mount for talk");
      },
    },
    haDirectTwoWayTalkMounter: {
      tryMount: async (_slot, _startup, options) => {
        talkMountOptions = options;
        return { ok: true };
      },
    },
    go2rtcRaceMounter: {
      mountWithRace: async () => {
        throw new Error("go2rtc path must not mount for ha_direct");
      },
    },
    preferredStreamType: () => "webrtc",
    setActiveStreamType: () => {},
    setStreamLoading: () => {},
    setStreamFallbackVisible: () => {},
    scheduleResumeLive: () => {},
    resolveUseGo2Rtc: () => false,
  });

  const mounted = await controller.mount({
    entity: "camera.front",
    forcedType: "webrtc",
    twoWayTalkOptions: { microphoneStream },
  });

  assert.equal(mounted, true);
  assert.deepEqual(talkMountOptions, {
    entity: "camera.front",
    commit: true,
    microphoneStream,
  });
});

test("suspended cameras stop before either live transport is selected", async () => {
  const calls = [];
  const controller = createLiveMountController({
    getSlot: () => ({}),
    isPreviewPageActive: () => false,
    getViewMode: () => "single",
    isGridModeAvailable: () => true,
    getMountInProgress: () => false,
    getMountTargetEntity: () => "",
    isCameraRuntimeSuspended: (entity) => {
      calls.push(["suspended", entity]);
      return true;
    },
    applyCameraSuspendedState: (entity) =>
      calls.push(["apply-suspended", entity]),
    resolveUseGo2Rtc: () => {
      throw new Error("transport selection must not run");
    },
    haDirectMounter: {
      tryMount: async () => {
        throw new Error("HA Direct must not mount");
      },
    },
    go2rtcRaceMounter: {
      mountWithRace: async () => {
        throw new Error("go2rtc must not mount");
      },
    },
  });

  assert.equal(await controller.mount({ entity: "camera.front" }), false);
  assert.deepEqual(calls, [
    ["suspended", "camera.front"],
    ["apply-suspended", "camera.front"],
  ]);
});
