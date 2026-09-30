import { VERSION } from "../../constants.js";
import { RECORDINGS_RUNTIME_ASSET_NAME } from "../../release-artifacts.mjs";
const recordingsRuntimeModuleState = { promise: null };

export const ensureRecordingsRuntimeModule = ({
  importModule = (url) => import(url),
  baseUrl = import.meta.url,
} = {}) => {
  if (recordingsRuntimeModuleState.promise) {
    return recordingsRuntimeModuleState.promise;
  }
  const assetUrl = new URL(`./${RECORDINGS_RUNTIME_ASSET_NAME}`, baseUrl);
  assetUrl.searchParams.set("fvc-version", VERSION);
  recordingsRuntimeModuleState.promise = Promise.resolve()
    .then(() => importModule(assetUrl.href))
    .catch((error) => {
      recordingsRuntimeModuleState.promise = null;
      throw error;
    });
  return recordingsRuntimeModuleState.promise;
};

export class LazyRecordingsBrowseNavController {
  constructor(
    host,
    { loadModule = ensureRecordingsRuntimeModule } = {},
  ) {
    this._host = host;
    this._loadModule = loadModule;
    this._delegate = null;
    this._delegatePromise = null;
  }

  prepare() {
    return this._ensureDelegate();
  }

  fetchRecordingsInBounds(...args) {
    return this._invokeAsync("fetchRecordingsInBounds", ...args);
  }

  fetchRecordingsInBoundsProgressively(...args) {
    return this._invokeAsync(
      "fetchRecordingsInBoundsProgressively",
      ...args,
    );
  }

  hasRecordingsInBounds(...args) {
    return this._invokeAsync("hasRecordingsInBounds", ...args);
  }

  prepareDayTransition(...args) {
    return this._invokeAsync("prepareDayTransition", ...args);
  }

  navigateDayAnimated(...args) {
    return this._invokeAsync("navigateDayAnimated", ...args);
  }

  commitDayTransition(...args) {
    return this._invokeAsync("commitDayTransition", ...args);
  }

  stepDay(...args) {
    return this._invokeAsync("stepDay", ...args);
  }

  updateBrowseNav(...args) {
    return this._invokeAsync("updateBrowseNav", ...args);
  }

  prepareBrowseNav() {
    if (this._host?._tab !== "recordings") return;
    if (this._delegate) {
      this._delegate.prepareBrowseNav();
      return;
    }
    this._setNavigationDisabled();
    void this._ensureDelegate().then((delegate) => {
      if (this._host?._tab === "recordings") {
        delegate?.prepareBrowseNav?.();
      }
    });
  }

  scheduleBrowseNavUpdate() {
    if (this._host?._tab !== "recordings") return false;
    if (this._delegate) {
      return this._delegate.scheduleBrowseNavUpdate();
    }
    this._setNavigationDisabled();
    void this._ensureDelegate().then((delegate) => {
      if (this._host?._tab === "recordings") {
        delegate?.scheduleBrowseNavUpdate?.();
      }
    });
    return true;
  }

  _setNavigationDisabled() {
    for (const selector of ["#rec-day-prev", "#rec-day-next"]) {
      const button = this._host?._pageShellRegionElement?.(
        "browseHeader",
        selector,
      );
      if (button) button.disabled = true;
    }
  }

  _invokeAsync(method, ...args) {
    if (this._delegate) {
      return Promise.resolve(this._delegate[method]?.(...args));
    }
    return this._ensureDelegate().then((delegate) =>
      delegate?.[method]?.(...args),
    );
  }

  _ensureDelegate() {
    if (this._delegate) return Promise.resolve(this._delegate);
    if (this._delegatePromise) return this._delegatePromise;

    const delegatePromise = Promise.resolve()
      .then(() => this._loadModule())
      .then((module) => {
        const Controller = module?.RecordingsBrowseNavController;
        if (typeof Controller !== "function") {
          throw new TypeError(
            "Recordings runtime did not export its browse navigation controller",
          );
        }
        this._delegate = new Controller(this._host);
        return this._delegate;
      })
      .catch((error) => {
        if (this._delegatePromise === delegatePromise) {
          this._delegatePromise = null;
        }
        console.warn("[Frigate] Recordings runtime could not load", error);
        return null;
      })
      .finally(() => {
        if (!this._delegate && this._delegatePromise === delegatePromise) {
          this._delegatePromise = null;
        }
      });
    this._delegatePromise = delegatePromise;
    return delegatePromise;
  }
}
