import { VERSION } from "../../constants.js";

const WIDE_TIMELINE_ASSET_NAME = "frigate-view-card-wide-timeline.js";
const wideTimelineModuleState = { promise: null };

export const ensureWideViewTimelineModule = ({
  importModule = (url) => import(url),
  baseUrl = import.meta.url,
} = {}) => {
  if (wideTimelineModuleState.promise) {
    return wideTimelineModuleState.promise;
  }
  const assetUrl = new URL(`./${WIDE_TIMELINE_ASSET_NAME}`, baseUrl);
  assetUrl.searchParams.set("fvc-version", VERSION);
  wideTimelineModuleState.promise = Promise.resolve()
    .then(() => importModule(assetUrl.href))
    .catch((error) => {
      wideTimelineModuleState.promise = null;
      throw error;
    });
  return wideTimelineModuleState.promise;
};

export class LazyWideViewTimelineController {
  constructor(
    host,
    deps = {},
    {
      loadModule = ensureWideViewTimelineModule,
      isActive = () =>
        host?._wideViewPageController?.isWideViewPageActive?.() === true,
      onReady = () => {
        if (typeof host?._renderShellPreserveLive !== "function") return false;
        host._renderShellPreserveLive();
        // The companion can finish after the initial browse request. Repaint
        // the replacement list so a completed Alerts load is not discarded.
        host._renderList?.({ renderWideTimeline: false });
        return true;
      },
    } = {},
  ) {
    this._host = host;
    this._deps = deps;
    this._loadModule = loadModule;
    this._isActive = isActive;
    this._onReady = onReady;
    this._delegate = null;
    this._delegatePromise = null;
    this._bindRequested = false;
    this._pendingRenderOptions = null;
  }

  enabled() {
    return this._host?._config?.wide_view_timeline_enabled === true;
  }

  buildRegionMarkup() {
    if (!this.enabled()) return "";
    if (this._delegate) return this._delegate.buildRegionMarkup?.() || "";
    void this._ensureDelegate();
    return "";
  }

  bind() {
    if (!this.enabled()) return;
    this._bindRequested = true;
    if (this._delegate) {
      this._delegate.bind?.();
      return;
    }
    void this._ensureDelegate();
  }

  teardown(options = {}) {
    this._bindRequested = false;
    this._pendingRenderOptions = null;
    return this._delegate?.teardown?.(options);
  }

  applyConfigUpdate(options = {}) {
    if (this._delegate) {
      return this._delegate.applyConfigUpdate?.(options);
    }
    if (this.enabled() && this._isActive()) {
      void this._ensureDelegate();
    }
    return undefined;
  }

  handleClick(event, target) {
    return this._delegate?.handleClick?.(event, target) === true;
  }

  render(options = {}) {
    if (!this.enabled()) return;
    if (this._delegate) {
      this._delegate.render?.(options);
      return;
    }
    this._pendingRenderOptions = options;
    void this._ensureDelegate();
  }

  scheduleRender(options = {}) {
    if (!this.enabled()) return;
    if (this._delegate) {
      this._delegate.scheduleRender?.(options);
      return;
    }
    this._pendingRenderOptions = options;
    void this._ensureDelegate();
  }

  _ensureDelegate() {
    if (this._delegate) return Promise.resolve(this._delegate);
    if (this._delegatePromise) return this._delegatePromise;
    const delegatePromise = Promise.resolve()
      .then(() => this._loadModule())
      .then((module) => {
        const Controller = module?.WideViewTimelineController;
        if (typeof Controller !== "function") {
          throw new TypeError(
            "Wide View timeline module did not export its controller",
          );
        }
        this._delegate = new Controller(this._host, this._deps);
        const shouldActivate = this.enabled() && this._isActive();
        const refreshed = shouldActivate && this._onReady?.() === true;
        if (shouldActivate && this._bindRequested && !refreshed) {
          this._delegate.bind?.();
        }
        if (shouldActivate && this._pendingRenderOptions) {
          this._delegate.scheduleRender?.(this._pendingRenderOptions);
        }
        this._pendingRenderOptions = null;
        return this._delegate;
      })
      .catch((error) => {
        if (this._delegatePromise === delegatePromise) {
          this._delegatePromise = null;
        }
        console.warn("[Frigate] Wide View timeline could not load", error);
        return null;
      });
    this._delegatePromise = delegatePromise;
    return delegatePromise;
  }
}
