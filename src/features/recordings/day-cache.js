export const RECORDINGS_DAY_CACHE_MAX_ENTRIES = 64;

const hasOwn = (value, key) =>
  Object.prototype.hasOwnProperty.call(value || {}, key);

export class RecordingsDayCache {
  constructor({ maxEntries = RECORDINGS_DAY_CACHE_MAX_ENTRIES } = {}) {
    this._entries = new Map();
    this._maxEntries = Math.max(1, Math.floor(Number(maxEntries) || 0));
    this._disposed = false;
  }

  get size() {
    return this._entries.size;
  }

  get maxEntries() {
    return this._maxEntries;
  }

  get disposed() {
    return this._disposed;
  }

  hasRecordings(key) {
    return hasOwn(this._touch(key), "recordings");
  }

  getRecordings(key) {
    const entry = this._touch(key);
    return hasOwn(entry, "recordings") ? entry.recordings : undefined;
  }

  hasAvailability(key) {
    return hasOwn(this._touch(key), "available");
  }

  getAvailability(key) {
    const entry = this._touch(key);
    return hasOwn(entry, "available") ? entry.available : undefined;
  }

  getFetchedAt(key) {
    const entry = this._touch(key);
    return hasOwn(entry, "fetchedAt") ? entry.fetchedAt : undefined;
  }

  setRecordings(key, recordings, { fetchedAt } = {}) {
    const safeRecordings = Array.isArray(recordings) ? recordings : [];
    const patch = {
      recordings: safeRecordings,
      available: safeRecordings.length > 0,
    };
    if (Number.isFinite(fetchedAt)) patch.fetchedAt = fetchedAt;
    return this._set(key, patch);
  }

  setAvailability(key, available) {
    return this._set(key, { available: available === true });
  }

  delete(key) {
    return this._entries.delete(String(key || ""));
  }

  clear() {
    this._entries.clear();
  }

  dispose() {
    this.clear();
    this._disposed = true;
  }

  _touch(key) {
    if (this._disposed) return null;
    const cacheKey = String(key || "");
    if (!cacheKey || !this._entries.has(cacheKey)) return null;
    const entry = this._entries.get(cacheKey);
    this._entries.delete(cacheKey);
    this._entries.set(cacheKey, entry);
    return entry;
  }

  _set(key, patch) {
    if (this._disposed) return null;
    const cacheKey = String(key || "");
    if (!cacheKey) return null;
    const current = this._entries.get(cacheKey) || {};
    const entry = { ...current, ...patch };
    this._entries.delete(cacheKey);
    this._entries.set(cacheKey, entry);
    while (this._entries.size > this._maxEntries) {
      this._entries.delete(this._entries.keys().next().value);
    }
    return entry;
  }
}

export const ensureRecordingsDayCache = (host) => {
  if (!host) return null;
  if (
    !(host._recordingsDayCache instanceof RecordingsDayCache) ||
    host._recordingsDayCache.disposed
  ) {
    host._recordingsDayCache = new RecordingsDayCache();
  }
  return host._recordingsDayCache;
};

export const disposeRecordingsDayCache = (host) => {
  if (!host) return;
  host?._recordingsDayCache?.dispose?.();
  host._recordingsDayCache = null;
  host._recordingsDayRequestCache?.clear?.();
  host._recordingsDayRequestCache = null;
};

export const resetRecordingsDayCache = (host) => {
  if (!host) return null;
  disposeRecordingsDayCache(host);
  host._recordingsDayCache = new RecordingsDayCache();
  host._recordingsDayRequestCache = new Map();
  return host._recordingsDayCache;
};
