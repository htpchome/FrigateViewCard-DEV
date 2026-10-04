import { test } from "node:test";
import assert from "node:assert/strict";
import { createHaDirectProviderMounter } from "../src/features/live/ha-direct-provider-mounter.js";

const run = async (callback) => {
  const original = globalThis.MutationObserver;
  const observers = [];
  globalThis.MutationObserver = class {
    constructor(listener) { this.listener = listener; observers.push(this); }
    observe() {}
    disconnect() {}
  };
  const calls = [];
  let client;
  const card = { isConnected: true, parentNode: { localName: "home-assistant", shadowRoot: {} }, shadowRoot: { querySelector: () => target } };
  let target = {};
  const provider = { haDirectProvider: true, isConnected: true };
  const record = { provider, entity: "camera.one", status: "loading", video: null, streamType: "" };
  const session = {
    get: () => record,
    sync: () => client.onState(record, true),
    refresh: () => calls.push(["refresh"]),
    detach: (owner) => calls.push(["detach", owner]),
  };
  provider.haDirectSession = session;
  const mounter = createHaDirectProviderMounter({
    scopeKey: card, getHass: () => ({ connection: {} }), getIdentity: () => ({}),
    getSelectedEntity: () => "camera.one", getPreloadEntities: () => ["camera.one"],
    preparePlaybackElements: () => true, shouldPreload: () => true,
    acquireSession: (options) => { calls.push(["acquire"]); client = options.client; return session; },
    assignCommittedEngine: (engine) => calls.push(["engine", engine]),
    onCommittedStream: (type) => calls.push(["stream", type]),
    onCommittedMediaReady: (engine, video) => calls.push(["media", engine, video]),
  });
  try {
    await callback({ mounter, record, session, provider, calls,
      publish: (active = true) => client.onState(record, active),
      replaceTarget: () => { target = {}; observers[0].listener(); } });
  } finally { mounter.dispose(); globalThis.MutationObserver = original; }
};

test("shell paint does not start HA cameras before the foreground mount", async () => run(async (f) => {
  await f.mounter.schedulePreloadDeckAfterPaint();
  assert.deepEqual(f.calls, []);
  await f.mounter.tryMount({}, null, { entity: "camera.one" });
  assert.equal(f.calls[0][0], "acquire");
}));

test("mount and transport notifications bind to the session's selected provider", async () => run(async (f) => {
  assert.equal((await f.mounter.tryMount({}, null, { entity: "camera.one" })).ok, true);
  Object.assign(f.record, { status: "ready", streamType: "hls", video: {} });
  f.publish();
  assert.deepEqual(f.calls.at(-1), ["stream", "hls"]);
  Object.assign(f.record, { streamType: "webrtc", video: {} });
  f.publish();
  assert.deepEqual(f.calls.at(-1), ["stream", "webrtc"]);
  const count = f.calls.length;
  f.publish();
  assert.equal(f.calls.length, count);
}));

test("a replaced page rebinds presentation without replacing the provider", async () => run(async (f) => {
  await f.mounter.tryMount({}, null, { entity: "camera.one" });
  Object.assign(f.record, { status: "ready", streamType: "hls", video: {} });
  f.publish();
  f.calls.length = 0;
  f.replaceTarget();
  assert.deepEqual(f.calls[0], ["engine", f.provider]);
  assert.deepEqual(f.calls.at(-1), ["stream", "hls"]);
}));

test("inactive and released clients cannot present late provider results", async () => run(async (f) => {
  await f.mounter.tryMount({}, null, { entity: "camera.one" });
  Object.assign(f.record, { status: "ready", streamType: "hls", video: {} });
  f.calls.length = 0;
  f.publish(false);
  assert.deepEqual(f.calls, []);
  assert.equal(f.mounter.release(f.provider), true);
  f.calls.length = 0;
  f.publish();
  assert.deepEqual(f.calls, []);
  assert.equal(f.provider.haDirectSession, f.session);
}));
