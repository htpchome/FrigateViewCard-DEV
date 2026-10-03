import { test } from "node:test";
import assert from "node:assert/strict";

import { createLiveGraceController } from "../src/features/live/live-grace-controller.js";

const createFakeElement = () => ({
  children: [],
  attributes: new Map(),
  style: { cssText: "" },
  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    child.parentNode = this;
    child.isConnected = true;
    return child;
  },
  setAttribute(name, value) {
    this.attributes.set(name, value);
  },
  remove() {
    this.removed = true;
    this.isConnected = false;
  },
});

const withFakeDocument = async (run) => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => createFakeElement() };
  try {
    await run();
  } finally {
    globalThis.document = previousDocument;
  }
};

const createController = ({
  shadowRoot,
  getEngine = () => null,
  setEngine = () => {},
  releaseHaDirectEngine = () => {},
  isHaDirectProviderReusable = () => false,
  suspendHaDirectProvider = () => false,
  adoptHaDirectProvider = () => false,
} = {}) =>
  createLiveGraceController({
    graceMs: 20,
    graceMax: 3,
    haDirectRetainedMax: 12,
    catalystRetainedMax: 12,
    getShadowRoot: () => shadowRoot,
    getScopeKey: () => ({}),
    getPendingMountDestroyers: () => [],
    setPendingMountDestroyers: () => {},
    getPendingWebRtcTakeoverTimer: () => null,
    setPendingWebRtcTakeoverTimer: () => {},
    clearRotateOverlayAudioSync: () => {},
    clearRotateVideoFullscreenStyle: () => {},
    getEngine,
    setEngine,
    getActiveStreamType: () => "hls",
    getStreamMuted: () => true,
    setEngineMountedMuted: () => {},
    getRotateOverlayActive: () => false,
    attachVideoFit: () => {},
    setActiveStreamType: () => {},
    setStreamLoading: () => {},
    setStreamFallbackVisible: () => {},
    setLiveNativeControls: () => {},
    releaseHaDirectEngine,
    isHaDirectProviderReusable,
    suspendHaDirectProvider,
    adoptHaDirectProvider,
    isCatalystHlsEngineReusable: () => false,
    suspendCatalystHlsEngine: () => false,
    adoptCatalystHlsEngine: () => false,
    releaseCatalystHlsEngine: () => {},
    scheduleResumeLive: () => {},
    resetMseDiagnostics: () => {},
    markMseChunk: () => {},
  });

test("HA Direct deck remains a slotted light-DOM child of the card", async () => {
  await withFakeDocument(async () => {
    const cardHost = createFakeElement();
    const shadowRoot = { host: cardHost };
    const controller = createController({ shadowRoot });

    const deck = controller.getHaDirectDeckHost();

    assert.strictEqual(cardHost.children[0], deck);
    assert.equal(deck.attributes.get("slot"), "fvc-ha-direct-provider-deck");
    assert.equal(deck.attributes.has("data-fvc-ha-direct-deck"), true);
  });
});

test("HA Direct retains and re-adopts only the complete native provider", async () => {
  await withFakeDocument(async () => {
    const shadowRoot = { host: createFakeElement() };
    const providerSlot = { id: "camera-provider-slot" };
    const provider = {
      type: "ha_direct",
      streamType: "hls",
      haDirectEntity: "camera.front",
      haDirectProvider: true,
      haDirectProviderSlot: providerSlot,
      parentElement: providerSlot,
    };
    let engine = provider;
    const calls = [];
    const controller = createController({
      shadowRoot,
      getEngine: () => engine,
      setEngine: (next) => {
        engine = next;
      },
      isHaDirectProviderReusable: (candidate) => candidate === provider,
      suspendHaDirectProvider: (candidate) => {
        calls.push(["suspend", candidate]);
        return true;
      },
      adoptHaDirectProvider: (slot, candidate) => {
        calls.push(["adopt", slot, candidate]);
        return true;
      },
    });

    controller.cleanupEngine({ preserveLiveEntity: "camera.front" });

    assert.equal(engine, null);
    assert.equal(controller.hasRetainedHaDirectEngine("camera.front"), true);
    assert.strictEqual(provider.parentElement, providerSlot);
    assert.strictEqual(
      controller.peekRetainedHaDirectEngineForHandoff(
        "camera.front",
        "provider",
      ),
      provider,
    );
    assert.strictEqual(
      controller.peekRetainedHaDirectEngineForHandoff(
        "camera.front",
        "webrtc",
      ),
      provider,
    );

    const entry = controller.takeGraceHaDirectEntry(
      "camera.front",
      "provider",
    );
    const liveSlot = { id: "engine" };
    assert.strictEqual(entry?.engine, provider);
    assert.equal(
      controller.adoptGraceHaDirectEngine(liveSlot, provider),
      true,
    );
    assert.deepEqual(calls, [
      ["suspend", provider],
      ["adopt", liveSlot, provider],
    ]);
    assert.strictEqual(provider.parentElement, providerSlot);
  });
});

test("obsolete card-owned HA Direct engines are never retained", async () => {
  await withFakeDocument(async () => {
    const shadowRoot = { host: createFakeElement() };
    const oldEngine = {
      type: "ha_direct",
      streamType: "webrtc",
      video: {},
    };
    let engine = oldEngine;
    const released = [];
    const controller = createController({
      shadowRoot,
      getEngine: () => engine,
      setEngine: (next) => {
        engine = next;
      },
      releaseHaDirectEngine: (candidate) => released.push(candidate),
    });

    assert.equal(
      controller.retainHaDirectEngine("camera.front", oldEngine),
      false,
    );
    controller.cleanupEngine({ preserveLiveEntity: "camera.front" });

    assert.deepEqual(released, [oldEngine]);
    assert.equal(engine, null);
    assert.equal(controller.hasRetainedHaDirectEngine("camera.front"), false);
  });
});
