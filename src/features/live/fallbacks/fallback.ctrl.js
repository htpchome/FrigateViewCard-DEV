import {
  applyFallbackImageHandlers,
  setFallbackImageSourceIfChanged,
} from "./fallback-image.js";
import { runFallbackRefreshCycleForCard } from "./fallback-refresh.js";
import {
  loadFallbackAltForCard,
  loadFallbackPrimaryForCard,
} from "./fallback-url.js";

const HA_DIRECT_LOADING_SNAPSHOT_REFRESH_MS = 1000;

export class LiveFallbackController {
  constructor(
    host,
    {
      getOrigin = () =>
        globalThis.window?.location?.origin ||
        globalThis.location?.origin ||
        "",
    } = {},
  ) {
    this._host = host;
    this._getOrigin = getOrigin;
    this._loadingRefreshGeneration = 0;
    this._loadingRefreshTimer = null;
  }

  originForAdapters() {
    this._host._fallbackOrigin = this._getOrigin();
    return this._host._fallbackOrigin;
  }

  async loadPrimary(entity, { requestHeight = 0 } = {}) {
    return await loadFallbackPrimaryForCard({
      card: this._host,
      entity,
      origin: this.originForAdapters(),
      requestHeight,
    });
  }

  loadAlternate(entity) {
    return loadFallbackAltForCard({
      card: this._host,
      entity,
      origin: this.originForAdapters(),
    });
  }

  async refreshImage({
    cacheBustValue = null,
    preferAlternate = false,
  } = {}) {
    const host = this._host;
    return await runFallbackRefreshCycleForCard({
      card: host,
      applyHandlers: (payload) =>
        applyFallbackImageHandlers({
          ...payload,
          t: host._localization.t,
        }),
      applySource: setFallbackImageSourceIfChanged,
      cacheBustValue,
      preferAlternate,
    });
  }

  startLoadingRefresh(
    intervalMs = HA_DIRECT_LOADING_SNAPSHOT_REFRESH_MS,
  ) {
    this.stopLoadingRefresh();
    const generation = this._loadingRefreshGeneration;
    const delayMs = Math.max(250, Number(intervalMs) || 1000);
    let active = true;

    const schedule = () => {
      if (!active || generation !== this._loadingRefreshGeneration) return;
      this._loadingRefreshTimer = globalThis.setTimeout(() => {
        this._loadingRefreshTimer = null;
        void this.refreshImage({
          cacheBustValue: Date.now(),
          preferAlternate: true,
        }).finally(schedule);
      }, delayMs);
      this._loadingRefreshTimer?.unref?.();
    };
    schedule();

    return () => {
      if (!active) return;
      active = false;
      if (generation !== this._loadingRefreshGeneration) return;
      this.stopLoadingRefresh();
    };
  }

  stopLoadingRefresh() {
    this._loadingRefreshGeneration += 1;
    if (this._loadingRefreshTimer != null) {
      clearTimeout(this._loadingRefreshTimer);
    }
    this._loadingRefreshTimer = null;
  }
}

export function getLiveFallbackController(host) {
  if (host._liveFallbackController instanceof LiveFallbackController) {
    return host._liveFallbackController;
  }
  const controller = new LiveFallbackController(host);
  host._liveFallbackController = controller;
  return controller;
}
