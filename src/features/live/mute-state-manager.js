const DEFAULT_STORAGE_KEY = "frigate-view-card:camera-mute-state:v1";

const normalizeEntity = (entity) => String(entity || "").trim();

const resolveSessionStorage = () => {
  try {
    return globalThis.sessionStorage || null;
  } catch (_) {
    return null;
  }
};

export class MuteStateManager {
  constructor({
    storage = resolveSessionStorage(),
    storageKey = DEFAULT_STORAGE_KEY,
  } = {}) {
    this._storage = storage;
    this._storageKey = storageKey;
    this._states = new Map();
    this._load();
  }

  resolve(entity) {
    const normalizedEntity = normalizeEntity(entity);
    if (!normalizedEntity) return undefined;
    this._load();
    return this._states.get(normalizedEntity);
  }

  remember(entity, muted) {
    const normalizedEntity = normalizeEntity(entity);
    if (!normalizedEntity) return false;
    this._load();
    this._states.set(normalizedEntity, muted === true);
    this._save();
    return true;
  }

  clear(entity) {
    const normalizedEntity = normalizeEntity(entity);
    if (!normalizedEntity) return false;
    this._load();
    const removed = this._states.delete(normalizedEntity);
    if (removed) this._save();
    return removed;
  }

  _load() {
    if (!this._storage?.getItem) return;
    try {
      const parsed = JSON.parse(this._storage.getItem(this._storageKey) || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      this._states = new Map(
        Object.entries(parsed)
          .filter(([entity, muted]) => entity && typeof muted === "boolean"),
      );
    } catch (_) {}
  }

  _save() {
    if (!this._storage?.setItem) return;
    try {
      this._storage.setItem(
        this._storageKey,
        JSON.stringify(Object.fromEntries(this._states)),
      );
    } catch (_) {}
  }
}
