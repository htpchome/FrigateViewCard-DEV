import { createStationaryMediaProjection } from "../../shared/media/stationary-projection.js";
import { createHaDirectCameraProvider } from "../../integrations/home-assistant/camera-provider.js";
import { CARD_CONFIG_COMMIT_EVENT } from "../../product-identity.mjs";

const registries = new WeakMap();
let sessionSequence = 0;
const rank = (context) => context === "config" ? 2 : context === "preconfig" ? 1 : 0;

export function createHaDirectSession({
  createProjection,
  createProvider = createHaDirectCameraProvider,
  onDispose = () => {},
  releaseDelayMs = 20000,
}) {
  const records = new Map();
  const clients = new Map();
  let active = null;
  let starting = null;
  let disposed = false;
  let lastHass = null;
  let releaseTimer = null;
  let lastMuted;

  const notify = (record) => {
    if (record.provider) {
      record.provider.haDirectProviderReady = record.status === "ready";
      record.provider.streamType = record.streamType;
    }
    for (const client of clients.keys()) client.onState?.(record, client === active);
  };
  const present = () => {
    const previous = active;
    if (previous) lastMuted = Boolean(previous.muted());
    const candidates = [...clients.keys()].filter((client) => client.host.isConnected);
    candidates.sort((a, b) => rank(b.context()) - rank(a.context()) || clients.get(b) - clients.get(a));
    active = candidates[0] || null;
    if (active !== previous) {
      previous?.onPresentationChange?.(false);
      if (active && lastMuted !== undefined) active.setMuted?.(lastMuted);
      active?.onPresentationChange?.(true);
    }
    for (const record of records.values()) {
      const target = active?.target(record.entity);
      if (target) record.projection.project(target);
      else record.projection.clear();
      const visible = Boolean(target && active?.visible(record.entity));
      record.slot.style.opacity = visible ? "1" : "0";
      record.slot.style.zIndex = visible ? "3" : "0";
      if (record.provider) record.provider.muted = visible ? Boolean(active.muted(record.entity)) : true;
      active?.onState?.(record, true);
    }
  };
  const requestedEntities = () => [...new Set([...clients.keys()].flatMap((client) => client.entities()))];
  const start = (entity) => {
    const stateObj = lastHass?.states?.[entity];
    if (!stateObj) return false;
    const projection = createProjection();
    const slot = projection.deck;
    slot.style.opacity = "0";
    slot.dataset.fvcHaDirectProvider = entity;
    const record = { entity, slot, projection, provider: null, status: "loading", streamType: "", video: null, cleanup: () => {} };
    starting = record;
    try {
      const result = createProvider({
        hass: lastHass,
        stateObj,
        onState: (state) => {
          if (disposed || records.get(entity) !== record) return;
          Object.assign(record, state);
          notify(record);
          if (state.status !== "loading" && starting === record) {
            starting = null;
            queueMicrotask(pump);
          }
        },
      });
      record.provider = result.provider;
      record.cleanup = result.dispose;
      Object.assign(record.provider, {
        type: "ha_direct", haDirectProvider: true, haDirectEntity: entity,
        haDirectSession: api, haDirectProviderSlot: slot,
      });
      records.set(entity, record);
      slot.appendChild(record.provider);
    } catch (error) {
      starting = null;
      record.status = "failed";
      record.error = error;
      // Failed creation still settles this camera; it must not stall the queue.
      records.set(entity, record);
      queueMicrotask(pump);
    }
    present();
    return true;
  };
  function pump() {
    if (disposed || starting || !active?.canStart()) return;
    const entities = requestedEntities();
    const selected = active.selected();
    const next = entities.includes(selected) && !records.has(selected)
      ? selected : entities.find((entity) => !records.has(entity));
    if (next) start(next);
  }
  const removeRecord = (entity) => {
    const record = records.get(entity);
    if (!record) return;
    records.delete(entity);
    if (starting === record) starting = null;
    record.cleanup();
    record.projection.dispose();
    if (record.provider) delete record.provider.haDirectSession;
  };
  const sync = (client, { activate = false } = {}) => {
    if (disposed || !clients.has(client)) return;
    if (activate) clients.set(client, ++sessionSequence);
    lastHass = client.hass() || lastHass;
    const entities = new Set(requestedEntities());
    for (const [entity, record] of records) {
      if (!entities.has(entity)) {
        removeRecord(entity);
        continue;
      }
      const stateObj = lastHass?.states?.[entity];
      if (record.provider && stateObj && record.provider.stateObj !== stateObj) record.provider.stateObj = stateObj;
    }
    present();
    pump();
  };
  const api = {
    clients,
    records,
    attach(client) {
      if (releaseTimer != null) clearTimeout(releaseTimer);
      releaseTimer = null;
      clients.set(client, ++sessionSequence);
      sync(client);
    },
    sync,
    refresh: present,
    get: (entity) => records.get(entity),
    isActive: (client) => active === client,
    remove: removeRecord,
    detach(client) {
      clients.delete(client);
      if (clients.size) {
        present();
        if (active) sync(active);
      } else {
        present();
        releaseTimer = setTimeout(() => api.dispose(), releaseDelayMs);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (releaseTimer != null) clearTimeout(releaseTimer);
      for (const entity of [...records.keys()]) removeRecord(entity);
      clients.clear();
      onDispose();
    },
  };
  return api;
}

// A registry is scoped to one HA application root and websocket connection.
// It retains sessions, not movable video nodes. Independent visible cards do
// not share sessions merely because they contain the same camera entities.
export function acquireHaDirectSession({ anchor, client, identity, connection }) {
  let registry = registries.get(anchor);
  if (!registry) {
    registry = { sessions: new Set(), editorSession: null };
    registry.onDialog = (event) => {
      if (event.detail?.dialogTag !== "hui-dialog-edit-card") return;
      const config = event.detail.dialogParams?.cardConfig;
      const matches = [...registry.sessions].filter((entry) =>
        [...entry.session.clients.keys()].some((owner) => owner.identity().config === config));
      registry.editorSession = matches.length === 1 ? matches[0] : null;
      for (const entry of registry.sessions) entry.savedConfig = null;
    };
    registry.onCommit = (event) => {
      const { previousConfig, config } = event.detail || {};
      if (!previousConfig || !config) return;
      const matches = [...registry.sessions].filter((entry) =>
        [entry.baselineIdentity, entry.lastIdentity,
          ...[...entry.session.clients.keys()].map((owner) => owner.identity())]
          .some((candidate) => candidate.sourceConfig === previousConfig || candidate.config === previousConfig));
      const entry = matches.includes(registry.editorSession) ? registry.editorSession
        : matches.length === 1 ? matches[0] : null;
      if (entry) entry.savedConfig = config;
    };
    anchor.addEventListener("show-dialog", registry.onDialog, true);
    anchor.addEventListener(CARD_CONFIG_COMMIT_EVENT, registry.onCommit, true);
    registries.set(anchor, registry);
  }
  const compatible = [...registry.sessions].filter((entry) => {
    const identities = [entry.baselineIdentity, entry.lastIdentity,
      ...[...entry.session.clients.keys()].map((owner) => owner.identity())];
    return entry.connection === connection && identities.some((candidate) =>
      candidate.config === identity.config || candidate.signature === identity.signature);
  });
  const eligible = compatible.filter((entry) => {
    const owners = [...entry.session.clients.keys()];
    return owners.every((owner) => !owner.host.isConnected) ||
      client.context() === "config" ||
      owners.every((owner) => !owner.host.isConnected || owner.context() === "config") ||
      (client.context() === "preconfig" && owners.every((owner) => owner.context() !== "preconfig"));
  });
  // Save replaces the dashboard while the old card/editor may still be mounted.
  // Only the explicit saved-config handoff may bypass that ownership exclusion.
  const savedSourceConfig = identity.sourceConfig || identity.config;
  const saved = [...registry.sessions].filter((entry) => entry.connection === connection && entry.savedConfig && (
    entry.savedConfig === savedSourceConfig || (
      [...entry.session.clients.keys()].every((owner) => !owner.host.isConnected || owner.context() === "config") &&
      JSON.stringify(entry.savedConfig) === JSON.stringify(savedSourceConfig)
    )
  ));
  let entry = saved.length === 1 ? saved[0]
    : client.context() === "config" && compatible.includes(registry.editorSession)
      ? registry.editorSession : eligible.length === 1 ? eligible[0] : null;
  if (saved.includes(entry) && client.context() !== "config") {
    entry.savedConfig = null;
    // Late state updates from the outgoing card must not erase the Save identity.
    entry.baselineIdentity = identity;
  }
  if (!entry) {
    entry = { connection, baselineIdentity: identity, lastIdentity: identity, savedConfig: null, session: null };
    entry.session = createHaDirectSession({
      createProjection: () => createStationaryMediaProjection({ anchor, name: `fvc-ha-camera-${++sessionSequence}` }),
      onDispose: () => {
        registry.sessions.delete(entry);
        if (registry.editorSession === entry) registry.editorSession = null;
        if (!registry.sessions.size) {
          anchor.removeEventListener("show-dialog", registry.onDialog, true);
          anchor.removeEventListener(CARD_CONFIG_COMMIT_EVENT, registry.onCommit, true);
          registries.delete(anchor);
        }
      },
    });
    registry.sessions.add(entry);
  }
  entry.session.rememberIdentity = (nextIdentity) => {
    entry.lastIdentity = nextIdentity;
  };
  entry.lastIdentity = identity;
  entry.session.attach(client);
  return entry.session;
}
