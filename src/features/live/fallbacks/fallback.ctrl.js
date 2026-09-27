import {
  applyFallbackImageHandlers,
  setFallbackImageSourceIfChanged,
} from "./fallback-image.js";
import { runFallbackRefreshCycleForCard } from "./fallback-refresh.js";
import {
  loadFallbackAltForCard,
  loadFallbackPrimaryForCard,
} from "./fallback-url.js";

const FALLBACK_HEIGHT_STEPS = Object.freeze([240, 360, 480, 720, 1080]);

export const selectFallbackRequestHeight = (height) => {
  const target = Math.max(0, Math.ceil(Number(height) || 0));
  if (!target) return 0;
  return (
    FALLBACK_HEIGHT_STEPS.find((candidate) => candidate >= target) ||
    FALLBACK_HEIGHT_STEPS.at(-1)
  );
};

export const resolveLiveFallbackRequestHeight = ({
  shadowRoot,
  devicePixelRatio = globalThis.devicePixelRatio || 1,
} = {}) => {
  const liveWrap = shadowRoot?.querySelector?.("#eng-wrap") || null;
  const cssHeight =
    Number(liveWrap?.clientHeight) ||
    Number(liveWrap?.getBoundingClientRect?.()?.height) ||
    0;
  if (cssHeight <= 0) return 0;
  const pixelRatio = Math.max(
    1,
    Math.min(3, Number(devicePixelRatio) || 1),
  );
  return selectFallbackRequestHeight(cssHeight * pixelRatio);
};

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

  async refreshImage() {
    const host = this._host;
    const requestHeight = resolveLiveFallbackRequestHeight({
      shadowRoot: host.shadowRoot,
    });
    return await runFallbackRefreshCycleForCard({
      card: host,
      loadPrimary: async (entity) =>
        await this.loadPrimary(entity, { requestHeight }),
      applyHandlers: (payload) =>
        applyFallbackImageHandlers({
          ...payload,
          t: host._localization.t,
        }),
      applySource: setFallbackImageSourceIfChanged,
    });
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
