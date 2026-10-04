import assert from "node:assert/strict";
import { test } from "node:test";
import { createHaDirectSession } from "../src/features/live/ha-direct-session.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const fixture = () => {
  const calls = [];
  const callbacks = new Map();
  const element = () => ({ style: {}, dataset: {}, appendChild() {}, remove() {} });
  const projection = { deck: { ...element(), ownerDocument: { createElement: element } },
    project: (target) => calls.push(["project", target]), clear() {}, dispose: () => calls.push(["dispose"]) };
  const session = createHaDirectSession({ projection, createProvider: ({ stateObj, onState }) => {
    const entity = stateObj.entity_id;
    calls.push(["create", entity]);
    callbacks.set(entity, onState);
    return { provider: { stateObj }, dispose: () => calls.push(["release", entity]) };
  } });
  const entities = ["camera.one", "camera.two", "camera.three"];
  const hass = { states: Object.fromEntries(entities.map((entity_id) => [entity_id, { entity_id }])) };
  const client = (context = "dashboard") => {
    const value = { selected: entities[0], context, target: {}, enabled: true, events: [] };
    return { value, host: { isConnected: true }, entities: () => entities,
      hass: () => hass, context: () => value.context, selected: () => value.selected,
      target: () => value.target, visible: () => true, muted: () => true,
      canStart: () => value.enabled, onState: (record, active) => {
        if (active && record.entity === value.selected) value.events.push([record.entity, record.status, record.provider]);
      } };
  };
  const ready = async (entity, streamType = "hls") => {
    callbacks.get(entity)({ status: "ready", streamType, video: { entity } });
    await flush();
  };
  return { session, calls, callbacks, client, ready };
};

test("selected camera goes live before the sequential background queue starts", async () => {
  const f = fixture();
  const owner = f.client();
  f.session.attach(owner);
  assert.deepEqual(f.calls.filter(([name]) => name === "create"), [["create", "camera.one"]]);
  await flush();
  assert.equal(f.callbacks.size, 1);
  await f.ready("camera.one");
  assert.equal(f.callbacks.size, 2);
  assert.equal(f.session.get("camera.one").provider.streamType, "hls");
  await f.ready("camera.two", "webrtc");
  assert.equal(f.callbacks.size, 3);
  await f.ready("camera.three", "webrtc");
  const first = f.session.get("camera.one").provider;
  owner.value.selected = "camera.two";
  f.session.sync(owner, { activate: true });
  owner.value.selected = "camera.one";
  f.session.sync(owner, { activate: true });
  assert.equal(f.session.get("camera.one").provider, first);
  assert.equal(first.streamType, "hls");
  assert.equal(f.calls.filter(([name]) => name === "create").length, 3);
  f.session.dispose();
});

test("a confirmed camera failure settles its queue position without a timed remount", async () => {
  const f = fixture();
  f.session.attach(f.client());
  f.callbacks.get("camera.one")({ status: "failed", streamType: "", video: null });
  await flush();
  assert.equal(f.callbacks.size, 2);
  assert.equal(f.session.get("camera.one").status, "failed");
  f.session.dispose();
});

test("pending readiness belongs to the session and reaches the new editor client", async () => {
  const f = fixture();
  const dashboard = f.client();
  f.session.attach(dashboard);
  const provider = f.session.get("camera.one").provider;
  dashboard.host.isConnected = false;
  const editor = f.client("config");
  f.session.attach(editor);
  await f.ready("camera.one", "webrtc");
  assert.deepEqual(editor.value.events.at(-1), ["camera.one", "ready", provider]);
  assert.equal(dashboard.value.events.some(([, status]) => status === "ready"), false);
  f.session.detach(dashboard);
  assert.equal(f.session.get("camera.one").provider, provider);
  assert.equal(f.callbacks.size, 2);
  const replacement = f.client();
  f.session.attach(replacement);
  editor.host.isConnected = false;
  f.session.refresh();
  assert.deepEqual(replacement.value.events.at(-1), ["camera.one", "ready", provider]);
  assert.equal(provider.streamType, "webrtc");
  f.session.dispose();
});

test("background transport upgrades never publish another camera into the selected view", async () => {
  const f = fixture();
  const owner = f.client();
  f.session.attach(owner);
  await f.ready("camera.one");
  await f.ready("camera.two");
  owner.value.events.length = 0;
  await f.ready("camera.two", "webrtc");
  assert.deepEqual(owner.value.events, []);
  await f.ready("camera.one", "webrtc");
  assert.equal(owner.value.events.at(-1)[0], "camera.one");
  assert.equal(f.session.get("camera.two").provider.streamType, "webrtc");
  f.session.dispose();
});

test("selecting a queued camera promotes it next without starting concurrent providers", async () => {
  const f = fixture();
  const owner = f.client();
  f.session.attach(owner);
  owner.value.selected = "camera.three";
  f.session.sync(owner, { activate: true });
  assert.equal(f.callbacks.size, 1);
  await f.ready("camera.one");
  assert.deepEqual([...f.callbacks.keys()], ["camera.one", "camera.three"]);
  await f.ready("camera.three");
  assert.deepEqual([...f.callbacks.keys()], ["camera.one", "camera.three", "camera.two"]);
  f.session.dispose();
});

test("editor ownership transfers audio and presentation subscriptions, not players", async () => {
  const f = fixture();
  const dashboard = f.client();
  const editor = f.client("config");
  const changes = [];
  let dashboardMuted = false;
  let editorMuted = true;
  dashboard.muted = () => dashboardMuted;
  dashboard.setMuted = (value) => { dashboardMuted = value; };
  dashboard.onPresentationChange = (value) => changes.push(["dashboard", value]);
  editor.muted = () => editorMuted;
  editor.setMuted = (value) => { editorMuted = value; };
  editor.onPresentationChange = (value) => changes.push(["editor", value]);
  f.session.attach(dashboard);
  await f.ready("camera.one");
  f.session.attach(editor);
  assert.equal(editorMuted, false);
  assert.deepEqual(changes.slice(-2), [["dashboard", false], ["editor", true]]);
  editorMuted = true;
  editor.host.isConnected = false;
  f.session.refresh();
  assert.equal(dashboardMuted, true);
  assert.deepEqual(changes.slice(-2), [["editor", false], ["dashboard", true]]);
  f.session.dispose();
});
