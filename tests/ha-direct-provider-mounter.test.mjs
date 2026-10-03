import { test } from "node:test";
import assert from "node:assert/strict";

import { createHaDirectProviderMounter } from "../src/features/live/ha-direct-provider-mounter.js";

const flushAsyncWork = () => new Promise((resolve) => setImmediate(resolve));

const createFakeVideo = () => ({
  ended: false,
  error: null,
  muted: true,
  readyState: 4,
  videoWidth: 1920,
});

const createFakeProvider = ({ streamType = "webrtc" } = {}) => {
  const listeners = new Map();
  const video = createFakeVideo();
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
    shadowRoot: { querySelectorAll: () => [player] },
    addEventListener(type, listener) {
      const entries = listeners.get(type) || new Set();
      entries.add(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type, detail = {}) {
      for (const listener of listeners.get(type) || []) {
        listener({ type, detail });
      }
    },
    video,
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
  moveBefore(child, reference = null) {
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
    const parentChildren = this.parentElement?.children;
    const index = parentChildren?.indexOf?.(this) ?? -1;
    if (index >= 0) parentChildren.splice(index, 1);
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

const baseOptions = ({ deck, provider, assignedEngine }) => ({
  getHass: () => ({
    states: {
      "camera.front": { entity_id: "camera.front", attributes: {} },
    },
  }),
  getStreamMuted: () => true,
  getRotateOverlayActive: () => false,
  isCurrentEngine: (engine) => engine === assignedEngine(),
  assignCommittedEngine: () => {},
  applyResolvedStreamUiState: () => {},
  setLiveNativeControls: () => {},
  preparePlaybackElements: () => true,
  createCameraStream: () => provider,
  getPreloadHost: () => deck,
  getSelectedEntity: () => "camera.front",
  shouldPreload: () => false,
});

test("HA Direct passes the real HA state to one stable camera-stream", async () => {
  await withFakeDocument(async () => {
    const deck = createFakeElement();
    const liveSlot = createFakeElement();
    const provider = createFakeProvider({ streamType: "webrtc" });
    const stateObj = { entity_id: "camera.front", attributes: {} };
    const hass = { states: { "camera.front": stateObj } };
    let assignedEngine = null;
    let providerOptions = null;
    const committedTypes = [];
    const mounter = createHaDirectProviderMounter({
      getHass: () => hass,
      getStreamMuted: () => true,
      getRotateOverlayActive: () => false,
      isCurrentEngine: (engine) => engine === assignedEngine,
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
      getActiveEntity: () => "camera.front",
      getSelectedEntity: () => "camera.front",
      shouldPreload: () => false,
    });

    const result = await mounter.tryMount(liveSlot, null, {
      entity: "camera.front",
      commit: true,
      mountToken: 1,
    });

    assert.equal(await result.startupReady, true);
    assert.strictEqual(result.engine, provider);
    assert.strictEqual(providerOptions.stateObj, stateObj);
    assert.equal(
      Object.hasOwn(providerOptions.stateObj.attributes, "frontend_stream_type"),
      false,
    );
    assert.equal(deck.children.length, 1);
    assert.strictEqual(deck.children[0].children[0], provider);
    assert.equal(liveSlot.children.length, 0);
    assert.deepEqual(committedTypes, []);

    provider.dispatch("load");
    assert.deepEqual(committedTypes, ["webrtc"]);

    const nextStateObj = { entity_id: "camera.front", attributes: {} };
    hass.states["camera.front"] = nextStateObj;
    mounter.syncProviderStates();
    assert.strictEqual(provider.stateObj, nextStateObj);
  });
});

test("HA Direct retains the whole provider in its camera deck slot", async () => {
  await withFakeDocument(async () => {
    const deck = createFakeElement();
    const liveSlot = createFakeElement();
    const provider = createFakeProvider({ streamType: "hls" });
    let assignedEngine = null;
    const mounter = createHaDirectProviderMounter({
      ...baseOptions({
        deck,
        provider,
        assignedEngine: () => assignedEngine,
      }),
      assignCommittedEngine: (engine) => {
        assignedEngine = engine;
      },
    });

    await mounter.tryMount(liveSlot, null, {
      entity: "camera.front",
      commit: true,
    });
    const providerSlot = provider.parentElement;

    assert.equal(mounter.isRetainableProvider(provider), true);
    assert.equal(mounter.suspendRetainedProvider(provider), true);
    assert.strictEqual(provider.parentElement, providerSlot);
    assert.equal(providerSlot.style.opacity, "0");

    assert.equal(mounter.adoptRetainedProvider(liveSlot, provider), true);
    assert.strictEqual(provider.parentElement, providerSlot);
    assert.equal(providerSlot.style.opacity, "1");
  });
});

test("HA Direct starts background providers only after the selected provider settles", async () => {
  await withFakeDocument(async () => {
    const deck = createFakeElement();
    const frameCallbacks = [];
    const retained = [];
    const providers = [];
    let assignedEngine = null;
    const hass = {
      states: {
        "camera.one": { attributes: {} },
        "camera.two": { attributes: {} },
        "camera.three": { attributes: {} },
      },
    };
    const mounter = createHaDirectProviderMounter({
      getHass: () => hass,
      getStreamMuted: () => true,
      getRotateOverlayActive: () => false,
      isCurrentEngine: (engine) => engine === assignedEngine,
      assignCommittedEngine: (engine) => {
        assignedEngine = engine;
      },
      applyResolvedStreamUiState: () => {},
      setLiveNativeControls: () => {},
      preparePlaybackElements: () => true,
      createCameraStream: () => {
        const provider = createFakeProvider();
        providers.push(provider);
        return provider;
      },
      getPreloadEntities: () => [
        "camera.one",
        "camera.two",
        "camera.three",
      ],
      getActiveEntity: () => "camera.one",
      getSelectedEntity: () => "camera.one",
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

    await mounter.tryMount(createFakeElement(), null, {
      entity: "camera.one",
      commit: true,
    });
    mounter.schedulePreloadDeckAfterPaint();
    assert.equal(frameCallbacks.length, 0);

    providers[0].dispatch("load");
    frameCallbacks.shift()?.();
    frameCallbacks.shift()?.();
    await flushAsyncWork();
    assert.equal(providers.length, 2);
    assert.deepEqual(retained, []);

    providers[1].dispatch("load");
    await flushAsyncWork();
    assert.equal(providers.length, 3);
    assert.deepEqual(retained, ["camera.two"]);

    providers[2].dispatch("load");
    await flushAsyncWork();
    assert.deepEqual(retained, ["camera.two", "camera.three"]);
  });
});

test("HA Direct editor handoff moves the whole provider slot state-preservingly", async () => {
  await withFakeDocument(async () => {
    const donorDeck = createFakeElement();
    const editorDeck = createFakeElement();
    const provider = createFakeProvider();
    let donorEngine = null;
    let editorEngine = null;
    const sharedOptions = {
      getHass: () => ({
        states: { "camera.front": { attributes: {} } },
      }),
      getStreamMuted: () => true,
      getRotateOverlayActive: () => false,
      applyResolvedStreamUiState: () => {},
      setLiveNativeControls: () => {},
      preparePlaybackElements: () => true,
      getActiveEntity: () => "camera.front",
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
    const editor = createHaDirectProviderMounter({
      ...sharedOptions,
      isCurrentEngine: (engine) => engine === editorEngine,
      assignCommittedEngine: (engine) => {
        editorEngine = engine;
      },
      getPreloadHost: () => editorDeck,
    });

    await donor.tryMount(createFakeElement(), null, {
      entity: "camera.front",
      commit: true,
    });
    const providerSlot = provider.parentElement;
    assert.strictEqual(providerSlot.parentElement, donorDeck);

    assert.equal(donor.detachProviderForHandoff(provider), true);
    assert.equal(
      editor.adoptRetainedProvider(createFakeElement(), provider),
      true,
    );
    assert.strictEqual(provider.parentElement, providerSlot);
    assert.strictEqual(providerSlot.parentElement, editorDeck);
    assert.strictEqual(editorEngine, provider);

    assert.equal(editor.detachProviderForHandoff(provider), true);
    assert.equal(donor.adoptTransferredProvider(provider), true);
    assert.equal(
      donor.adoptRetainedProvider(createFakeElement(), provider),
      true,
    );
    assert.strictEqual(provider.parentElement, providerSlot);
    assert.strictEqual(providerSlot.parentElement, donorDeck);
    assert.strictEqual(donorEngine, provider);
  });
});
