import { test } from "node:test";
import assert from "node:assert/strict";

import { createHaDirectProviderMounter } from "../src/features/live/ha-direct-provider-mounter.js";

const flushAsyncWork = () => new Promise((resolve) => setImmediate(resolve));

const createFakeVideo = () => ({
  currentTime: 1,
  defaultMuted: true,
  ended: false,
  error: null,
  muted: true,
  paused: false,
  readyState: 4,
  videoWidth: 1920,
  play: async () => {},
});

const createFakeProvider = ({ streamType = "webrtc" } = {}) => {
  const listeners = new Map();
  const video = createFakeVideo();
  const videoParent = {
    children: [video],
    insertBefore(child, reference = null) {
      const existingIndex = this.children.indexOf(child);
      if (existingIndex >= 0) this.children.splice(existingIndex, 1);
      const referenceIndex = reference ? this.children.indexOf(reference) : -1;
      if (referenceIndex >= 0) this.children.splice(referenceIndex, 0, child);
      else this.children.push(child);
      child.parentElement = this;
      child.parentNode = this;
      return child;
    },
  };
  video.parentElement = videoParent;
  video.parentNode = videoParent;
  video.nextSibling = null;
  const player = {
    tagName:
      streamType === "hls" ? "HA-HLS-PLAYER" : "HA-WEB-RTC-PLAYER",
    hidden: false,
    classList: { contains: () => false },
    shadowRoot: { querySelector: () => video },
  };
  return {
    tagName: "HA-CAMERA-STREAM",
    style: { cssText: "" },
    shadowRoot: {
      querySelectorAll: () => [player],
    },
    addEventListener(type, listener) {
      const entries = listeners.get(type) || new Set();
      entries.add(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    video,
    videoParent,
  };
};

const createFakeElement = () => ({
  children: [],
  isConnected: false,
  style: { cssText: "", opacity: "", zIndex: "" },
  attributes: new Map(),
  appendChild(child) {
    const previousChildren = child.parentElement?.children;
    const previousIndex = previousChildren?.indexOf?.(child) ?? -1;
    if (previousIndex >= 0) previousChildren.splice(previousIndex, 1);
    this.children.push(child);
    child.parentElement = this;
    child.parentNode = this;
    child.isConnected = true;
    return child;
  },
  insertBefore(child, reference = null) {
    const previousChildren = child.parentElement?.children;
    const previousIndex = previousChildren?.indexOf?.(child) ?? -1;
    if (previousIndex >= 0) previousChildren.splice(previousIndex, 1);
    const referenceIndex = reference ? this.children.indexOf(reference) : -1;
    if (referenceIndex >= 0) this.children.splice(referenceIndex, 0, child);
    else this.children.push(child);
    child.parentElement = this;
    child.parentNode = this;
    child.isConnected = true;
    return child;
  },
  setAttribute(name, value) {
    this.attributes.set(name, value);
  },
  removeAttribute(name) {
    this.attributes.delete(name);
  },
  remove() {
    this.isConnected = false;
    this.removed = true;
  },
});

const withFakeDocument = async (run) => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement(tagName) {
      assert.equal(tagName, "div");
      return createFakeElement();
    },
  };
  try {
    await run();
  } finally {
    globalThis.document = previousDocument;
  }
};

test("HA Direct delegates selected playback to one stable HA camera-stream", async () => {
  await withFakeDocument(async () => {
    const deck = createFakeElement();
    const liveSlot = createFakeElement();
    liveSlot.innerHTML = "occupied";
    const provider = createFakeProvider({ streamType: "webrtc" });
    const hass = {
      states: {
        "camera.front": {
          entity_id: "camera.front",
          attributes: {},
        },
      },
    };
    let assignedEngine = null;
    let providerOptions = null;
    const committedTypes = [];
    const mounter = createHaDirectProviderMounter({
      getHass: () => hass,
      getPreferredStreamType: () => "webrtc",
      getStreamMuted: () => true,
      getRotateOverlayActive: () => false,
      isCurrentEngine: (engine) => engine === assignedEngine,
      waitForStreamStart: async (engine, _waitMs, options) => {
        assert.strictEqual(engine, provider);
        assert.strictEqual(options.resolveVideo(), provider.video);
        return true;
      },
      assignCommittedEngine: (engine) => {
        assignedEngine = engine;
      },
      onCommittedStream: (streamType) => committedTypes.push(streamType),
      applyResolvedStreamUiState: () => {},
      setLiveNativeControls: () => {},
      preparePlaybackElements: () => true,
      createCameraStream: (options) => {
        providerOptions = options;
        return provider;
      },
      getPreloadHost: () => deck,
      getSelectedEntity: () => "camera.front",
      shouldPreload: () => false,
    });

    const result = await mounter.tryMount(
      liveSlot,
      { streamType: "webrtc" },
      { entity: "camera.front", commit: true, mountToken: 1 },
    );

    assert.equal(await result.startupReady, true);
    assert.strictEqual(result.engine, provider);
    assert.strictEqual(assignedEngine, provider);
    assert.equal(deck.children.length, 1);
    assert.strictEqual(deck.children[0].children[0], provider);
    assert.equal(liveSlot.children.length, 0);
    assert.strictEqual(provider.video.parentElement, provider.videoParent);
    assert.equal(providerOptions.stateObj.attributes.frontend_stream_type, "web_rtc");
    assert.deepEqual(committedTypes, ["webrtc"]);
  });
});

test("HA Direct retains a native provider in its original camera deck slot", async () => {
  await withFakeDocument(async () => {
    const deck = createFakeElement();
    const liveSlot = createFakeElement();
    liveSlot.innerHTML = "";
    const provider = createFakeProvider({ streamType: "hls" });
    let assignedEngine = null;
    const mounter = createHaDirectProviderMounter({
      getHass: () => ({ states: { "camera.front": { attributes: {} } } }),
      getPreferredStreamType: () => "hls",
      getStreamMuted: () => true,
      getRotateOverlayActive: () => false,
      isCurrentEngine: (engine) => engine === assignedEngine,
      waitForStreamStart: async () => true,
      assignCommittedEngine: (engine) => {
        assignedEngine = engine;
      },
      applyResolvedStreamUiState: () => {},
      setLiveNativeControls: () => {},
      preparePlaybackElements: () => true,
      createCameraStream: () => provider,
      getPreloadHost: () => deck,
      getSelectedEntity: () => "camera.front",
      shouldPreload: () => false,
    });

    const result = await mounter.tryMount(
      liveSlot,
      { streamType: "hls" },
      { entity: "camera.front", commit: true },
    );
    await result.startupReady;
    const originalParent = provider.parentElement;

    assert.equal(mounter.isRetainableHlsEngine(provider), true);
    assert.equal(mounter.suspendRetainedHlsEngine(provider), true);
    assert.strictEqual(provider.parentElement, originalParent);
    assert.strictEqual(provider.video.parentElement, provider.videoParent);
    assert.equal(originalParent.style.opacity, "0");

    assert.equal(mounter.adoptRetainedHlsEngine(liveSlot, provider), true);
    assert.strictEqual(provider.parentElement, originalParent);
    assert.strictEqual(provider.video.parentElement, provider.videoParent);
    assert.equal(originalParent.style.opacity, "1");
  });
});

test("HA Direct warms native providers sequentially", async () => {
  await withFakeDocument(async () => {
    const deck = createFakeElement();
    const frameCallbacks = [];
    const waits = [];
    const retained = [];
    const providers = [];
    const mounter = createHaDirectProviderMounter({
      getHass: () => ({
        states: {
          "camera.one": { attributes: {} },
          "camera.two": { attributes: {} },
        },
      }),
      getPreferredStreamType: () => "webrtc",
      getStreamMuted: () => true,
      getRotateOverlayActive: () => false,
      isCurrentEngine: () => false,
      waitForStreamStart: async (provider) => {
        waits.push(provider.haDirectEntity);
        return true;
      },
      assignCommittedEngine: () => {},
      applyResolvedStreamUiState: () => {},
      setLiveNativeControls: () => {},
      preparePlaybackElements: () => true,
      createCameraStream: () => {
        const provider = createFakeProvider({ streamType: "webrtc" });
        providers.push(provider);
        return provider;
      },
      getPreloadEntities: () => ["camera.one", "camera.two"],
      getActiveEntity: () => "",
      getPreloadHost: () => deck,
      shouldPreload: () => true,
      hasRetainedEngine: (entity) => retained.includes(entity),
      retainPreloadedEngine: (entity) => {
        retained.push(entity);
        return true;
      },
      requestFrame: (callback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      },
      cancelFrame: () => {},
    });

    mounter.schedulePreloadDeckAfterPaint();
    frameCallbacks.shift()?.();
    frameCallbacks.shift()?.();
    await flushAsyncWork();
    await flushAsyncWork();

    assert.deepEqual(waits, ["camera.one", "camera.two"]);
    assert.deepEqual(retained, ["camera.one", "camera.two"]);
    assert.equal(providers.length, 2);
    assert.equal(deck.children.length, 2);
  });
});

test("HA Direct lends only its video surface for editor handoff", async () => {
  await withFakeDocument(async () => {
    const donorDeck = createFakeElement();
    const preEditorDeck = createFakeElement();
    const editorDeck = createFakeElement();
    const donorSlot = createFakeElement();
    const preEditorSlot = createFakeElement();
    const editorSlot = createFakeElement();
    const provider = createFakeProvider({ streamType: "webrtc" });
    let donorEngine = null;
    let preEditorEngine = null;
    let editorEngine = null;
    const sharedOptions = {
      getHass: () => ({ states: { "camera.front": { attributes: {} } } }),
      getPreferredStreamType: () => "webrtc",
      getStreamMuted: () => true,
      getRotateOverlayActive: () => false,
      waitForStreamStart: async () => true,
      applyResolvedStreamUiState: () => {},
      setLiveNativeControls: () => {},
      preparePlaybackElements: () => true,
      getSelectedEntity: () => "camera.front",
      shouldPreload: () => false,
    };
    const donor = createHaDirectProviderMounter({
      ...sharedOptions,
      isCurrentEngine: (engine) => engine === donorEngine,
      assignCommittedEngine: (engine) => {
        donorEngine = engine;
      },
      createCameraStream: () => provider,
      getPreloadHost: () => donorDeck,
    });
    const preEditor = createHaDirectProviderMounter({
      ...sharedOptions,
      isCurrentEngine: (engine) => engine === preEditorEngine,
      assignCommittedEngine: (engine) => {
        preEditorEngine = engine;
      },
      getPreloadHost: () => preEditorDeck,
    });
    const editor = createHaDirectProviderMounter({
      ...sharedOptions,
      isCurrentEngine: (engine) => engine === editorEngine,
      assignCommittedEngine: (engine) => {
        editorEngine = engine;
      },
      getPreloadHost: () => editorDeck,
    });

    const mounted = await donor.tryMount(
      donorSlot,
      { streamType: "webrtc" },
      { entity: "camera.front", commit: true },
    );
    await mounted.startupReady;
    const stableSlot = provider.parentElement;
    assert.strictEqual(provider.video.parentElement, provider.videoParent);

    assert.equal(donor.detachProviderForHandoff(provider), true);
    assert.equal(
      preEditor.adoptRetainedHlsEngine(preEditorSlot, provider),
      true,
    );
    assert.strictEqual(provider.parentElement, stableSlot);
    assert.strictEqual(stableSlot.parentElement, donorDeck);
    assert.strictEqual(provider.video.parentElement, preEditorSlot);
    assert.strictEqual(preEditorEngine, provider);

    assert.equal(preEditor.detachProviderForHandoff(provider), true);
    assert.equal(editor.adoptRetainedHlsEngine(editorSlot, provider), true);
    assert.strictEqual(provider.video.parentElement, editorSlot);
    assert.strictEqual(editorEngine, provider);

    assert.equal(editor.detachProviderForHandoff(provider), true);
    assert.equal(donor.adoptTransferredProvider(provider), true);
    assert.equal(donor.adoptRetainedHlsEngine(donorSlot, provider), true);
    assert.strictEqual(provider.video.parentElement, provider.videoParent);
    assert.strictEqual(stableSlot.parentElement, donorDeck);
    assert.strictEqual(donorEngine, provider);
  });
});
