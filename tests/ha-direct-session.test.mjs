import assert from "node:assert/strict";
import { test } from "node:test";
import { acquireHaDirectSession, createHaDirectSession } from "../src/features/live/ha-direct-session.js";
import { CARD_CONFIG_COMMIT_EVENT } from "../src/product-identity.mjs";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const fixture = () => {
  const calls = [];
  const callbacks = new Map();
  const element = () => ({ style: {}, dataset: {}, appendChild() {}, remove() {} });
  const createProjection = () => ({ deck: element(),
    project: (target) => calls.push(["project", target]), clear() {}, dispose: () => calls.push(["dispose"]) });
  const session = createHaDirectSession({ createProjection, createProvider: ({ stateObj, onState }) => {
    const entity = stateObj.entity_id;
    calls.push(["create", entity]);
    callbacks.set(entity, onState);
    return { provider: { stateObj }, dispose: () => calls.push(["release", entity]),
      onSelected: () => calls.push(["selected", entity]) };
  } });
  const entities = ["camera.one", "camera.two", "camera.three"];
  const hass = { states: Object.fromEntries(entities.map((entity_id) => [entity_id, { entity_id }])) };
  const client = (context = "dashboard") => {
    const value = { selected: entities[0], context, target: {}, enabled: true, events: [] };
    return { value, host: { isConnected: true }, entities: () => entities,
      hass: () => hass, context: () => value.context, selected: () => value.selected,
      target: () => value.target, visible: (entity) => entity === value.selected, muted: () => true,
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

test("retained presentation cannot renew the HA state captured by actual media readiness", async () => {
  const f = fixture();
  const client = f.client();
  f.session.attach(client);
  await f.ready("camera.one", "webrtc");
  const provider = f.session.get("camera.one").provider;
  const readyState = provider.haDirectReadyState;
  client.hass().states["camera.one"] = { entity_id: "camera.one", state: "unavailable" };
  f.session.sync(client);
  f.session.refresh();
  assert.equal(provider.haDirectReadyState, readyState);
  assert.notEqual(provider.stateObj, readyState);
  await f.ready("camera.one", "hls");
  assert.equal(provider.haDirectReadyState, provider.stateObj);
  f.session.dispose();
});

test("Save transfers only its identified session while old preconfig/editor clients remain connected", () => {
  const anchor = new EventTarget();
  const connection = {};
  const config = { cameras: ["camera.one"], title: "Original" };
  const make = (context, sourceConfig) => ({
    host: { isConnected: true }, context: () => context, hass: () => ({ connection }),
    identity: () => ({ config: sourceConfig, signature: JSON.stringify(sourceConfig) }),
    entities: () => [], selected: () => "", muted: () => true, canStart: () => false,
  });
  const acquire = (client, socket = connection) => acquireHaDirectSession({
    anchor, client, identity: client.identity(), connection: socket,
  });
  const original = make("preconfig", config);
  const session = acquire(original);
  const independent = acquire(make("preconfig", structuredClone(config)));
  anchor.dispatchEvent(new CustomEvent("show-dialog", { detail: {
    dialogTag: "hui-dialog-edit-card", dialogParams: { cardConfig: config },
  } }));
  assert.equal(acquire(make("config", config)), session);
  const savedConfig = { ...config, title: "Saved" };
  anchor.dispatchEvent(new CustomEvent(CARD_CONFIG_COMMIT_EVENT, {
    detail: { previousConfig: config, config: savedConfig },
  }));
  // HA can rebuild the preview with the committed config before the dashboard.
  assert.equal(acquire(make("config", savedConfig)), session);
  assert.equal(acquire(make("preconfig", savedConfig)), session);
  assert.notEqual(independent, session);
  const unrelated = acquire(make("preconfig", savedConfig));
  assert.notEqual(unrelated, session, "saved-config handoff is consumed exactly once");
  const otherConnection = acquire(make("config", savedConfig), {});
  assert.notEqual(otherConnection, session);
  for (const entry of [session, independent, unrelated, otherConnection]) entry.dispose();
});

test("Save survives serialized config replacement after the prior dashboard is detached", () => {
  const anchor = new EventTarget();
  const connection = {};
  const config = { title: "Original" };
  const client = (sourceConfig) => ({
    host: { isConnected: true }, context: () => "preconfig", hass: () => ({ connection }),
    identity: () => ({ config: sourceConfig, signature: JSON.stringify({ ...sourceConfig, normalized: true }) }),
    entities: () => [], selected: () => "", muted: () => true, canStart: () => false,
  });
  const original = client(config);
  const acquire = (owner) => acquireHaDirectSession({ anchor, connection, client: owner, identity: owner.identity() });
  const session = acquire(original);
  const savedConfig = { title: "Saved" };
  anchor.dispatchEvent(new CustomEvent(CARD_CONFIG_COMMIT_EVENT, { detail: { previousConfig: config, config: savedConfig } }));
  original.host.isConnected = false;
  session.detach(original);
  const replacement = client(structuredClone(savedConfig));
  assert.equal(acquire(replacement), session);
  // An outgoing client's final HA state update must not erase the saved identity.
  session.rememberIdentity(original.identity());
  replacement.host.isConnected = false;
  session.detach(replacement);
  assert.equal(acquire(client(structuredClone(savedConfig))), session);
  session.dispose();
});

test("Save uses the original card config rather than a layout wrapper or expanded runtime defaults", () => {
  const anchor = new EventTarget();
  const connection = {};
  const sourceConfig = { title: "Original" };
  const make = (source, wrapper = null) => {
    const runtime = { ...source, defaultField: true };
    return {
      host: { isConnected: true }, context: () => "preconfig", hass: () => ({ connection }),
      identity: () => ({ config: wrapper || runtime, sourceConfig: source, signature: JSON.stringify(runtime) }),
      entities: () => [], selected: () => "", muted: () => true, canStart: () => false,
    };
  };
  const acquire = (client) => acquireHaDirectSession({ anchor, connection, client, identity: client.identity() });
  const original = make(sourceConfig, { type: "vertical-stack", cards: [sourceConfig] });
  const session = acquire(original);
  const independent = acquire(make(structuredClone(sourceConfig)));
  const savedConfig = { ...sourceConfig, title: "Saved" };
  // The editor preview can be gone by the time the Save notification arrives.
  anchor.dispatchEvent(new CustomEvent(CARD_CONFIG_COMMIT_EVENT, {
    detail: { previousConfig: sourceConfig, config: savedConfig },
  }));
  const saved = make(savedConfig);
  assert.equal(acquire(saved), session);
  assert.notEqual(independent, session);
  const duplicate = acquire(make(savedConfig));
  assert.notEqual(duplicate, session, "source identity must not bypass normal ownership after Save is consumed");
  for (const entry of [session, independent, duplicate]) entry.dispose();
});

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

test("only camera selection changes authorize retries, not page/editor handoff or HA updates", async () => {
  const f = fixture();
  const owner = f.client();
  f.session.attach(owner);
  for (const entity of ["camera.one", "camera.two", "camera.three"]) await f.ready(entity);
  f.calls.length = 0;
  f.session.sync(owner);
  f.session.refresh();
  owner.value.context = "preconfig";
  f.session.sync(owner, { activate: true });
  const editor = f.client("config");
  f.session.attach(editor);
  f.session.detach(editor);
  f.session.detach(owner);
  f.session.attach(owner);
  assert.deepEqual(f.calls.filter(([name]) => name === "selected"), []);
  owner.value.selected = "camera.two";
  f.session.sync(owner, { activate: true });
  f.session.sync(owner);
  owner.value.selected = "camera.one";
  f.session.sync(owner, { activate: true });
  assert.deepEqual(f.calls.filter(([name]) => name === "selected"),
    [["selected", "camera.two"], ["selected", "camera.one"]]);
  assert.equal(f.calls.some(([name]) => name === "create" || name === "release"), false);
  f.session.dispose();
});

test("failure and targeted eviction of one camera never restart healthy siblings", async () => {
  const f = fixture();
  const owner = f.client();
  f.session.attach(owner);
  for (const entity of ["camera.one", "camera.two", "camera.three"]) await f.ready(entity);
  const healthy = [f.session.get("camera.one"), f.session.get("camera.three")];
  const staleCallback = f.callbacks.get("camera.two");
  f.calls.length = 0;
  staleCallback({ status: "failed", streamType: "", video: null });
  f.session.sync(owner);
  await flush();
  assert.equal(f.calls.some(([name]) => name === "create" || name === "release"), false);
  f.session.remove("camera.two");
  f.session.sync(owner);
  assert.deepEqual(f.calls.filter(([name]) => name === "create" || name === "release"),
    [["release", "camera.two"], ["create", "camera.two"]]);
  staleCallback({ status: "failed", streamType: "", video: null });
  assert.equal(f.session.get("camera.two").status, "loading", "old callbacks cannot fail the replacement");
  for (const record of healthy) {
    assert.equal(f.session.get(record.entity), record);
    assert.equal(record.status, "ready");
    assert.equal(record.provider.streamType, "hls");
  }
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

test("camera-specific projections present multiple retained players and mute only tile audio", async () => {
  const f = fixture();
  const owner = f.client();
  f.session.attach(owner);
  for (const entity of ["camera.one", "camera.two", "camera.three"]) await f.ready(entity);
  const original = [...f.session.records.values()].map((record) => record.provider);
  const targets = new Map([["camera.one", {}], ["camera.two", {}]]);
  owner.target = (entity) => targets.get(entity) || owner.value.target;
  owner.visible = (entity) => targets.has(entity);
  f.calls.length = 0;
  f.session.refresh();
  assert.deepEqual(f.calls.filter(([name]) => name === "project").map(([, target]) => target),
    [targets.get("camera.one"), targets.get("camera.two"), owner.value.target]);
  assert.equal(f.session.get("camera.one").slot.style.opacity, "1");
  assert.equal(f.session.get("camera.two").slot.style.opacity, "1");
  assert.equal(f.session.get("camera.three").slot.style.opacity, "0");
  targets.clear();
  owner.visible = (entity) => entity === owner.value.selected;
  owner.muted = () => false;
  f.session.refresh();
  assert.equal(f.session.get("camera.one").provider.muted, false);
  assert.equal(f.session.get("camera.two").provider.muted, true);
  assert.deepEqual([...f.session.records.values()].map((record) => record.provider), original);
  f.session.dispose();
});
