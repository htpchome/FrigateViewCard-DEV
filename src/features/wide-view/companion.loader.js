import { VERSION } from "../../constants.js";
import { buildWideCompanionRegionMarkup } from "./companion.tmpl.js";

const WIDE_COMPANION_ASSET_NAME =
  "frigate-view-card-wide-companion.js";
const MAX_PENDING_REALTIME_MESSAGES = 50;
const wideCompanionModuleState = { promise: null };

export const ensureWideViewCompanionModule = ({
  importModule = (url) => import(url),
  baseUrl = import.meta.url,
} = {}) => {
  if (wideCompanionModuleState.promise) {
    return wideCompanionModuleState.promise;
  }
  const assetUrl = new URL(`./${WIDE_COMPANION_ASSET_NAME}`, baseUrl);
  assetUrl.searchParams.set("fvc-version", VERSION);
  wideCompanionModuleState.promise = Promise.resolve()
    .then(() => importModule(assetUrl.href))
    .catch((error) => {
      wideCompanionModuleState.promise = null;
      throw error;
    });
  return wideCompanionModuleState.promise;
};

export class LazyWideViewCompanionController {
  constructor(
    host,
    constants,
    {
      loadModule = ensureWideViewCompanionModule,
      isActive = () =>
        host?._pageId === constants?.PAGE_IDS?.wideView,
      onReady = () => false,
    } = {},
  ) {
    this._host = host;
    this._constants = constants;
    this._loadModule = loadModule;
    this._isActive = isActive;
    this._onReady = onReady;
    this._delegate = null;
    this._delegatePromise = null;
    this._started = false;
    this._renderRequested = false;
    this._resumeRequested = false;
    this._hassUpdateRequested = false;
    this._metaUpdateRequested = false;
    this._pendingLayoutOptions = null;
    this._pendingConfigOptions = null;
    this._pendingRealtimeMessages = [];
    this._pendingHaReviewStatuses = new Map();
    this._pendingToggleCount = 0;
  }

  isActive() {
    return this._isActive() === true;
  }

  buildRegionMarkup() {
    if (!this.isActive()) return "";
    if (this._delegate) {
      return this._delegate.buildRegionMarkup?.() || "";
    }
    void this._ensureDelegate();
    return buildWideCompanionRegionMarkup({
      chevronIcon: this._constants?.ICONS?.chevron || "",
    });
  }

  liveCamerasEnabled() {
    return this._delegate
      ? this._delegate.liveCamerasEnabled?.() === true
      : this._host?._config?.wide_view_live_cameras === true;
  }

  alertTakeoverEnabled() {
    if (this._host?._isAlertCameraTakeoverAvailable?.() === false) {
      return false;
    }
    if (this._delegate) {
      return this._delegate.alertTakeoverEnabled?.() === true;
    }
    const configured =
      this._host?._config?.wide_view_alert_takeover === true;
    return this._pendingToggleCount % 2 === 0
      ? configured
      : !configured;
  }

  toggleAlertTakeover() {
    if (this._delegate) {
      return this._delegate.toggleAlertTakeover?.() === true;
    }
    if (!this.isActive()) return false;
    if (this._host?._isAlertCameraTakeoverAvailable?.() === false) {
      this._host?._syncToolbarButtons?.();
      return false;
    }
    if (
      !this.alertTakeoverEnabled() &&
      this._host?._toolbarButtonStates?.().wideAlertTakeoverDisabled
    ) {
      this._host?._syncToolbarButtons?.();
      return false;
    }
    this._pendingToggleCount += 1;
    const enabled = this.alertTakeoverEnabled();
    this._host?._handleAlertTakeoverStateChange?.(enabled);
    this._host?._syncToolbarButtons?.();
    void this._ensureDelegate();
    return enabled;
  }

  cellSeverity(entity) {
    if (this._delegate) {
      return this._delegate.cellSeverity?.(entity) || "";
    }
    return this._pendingHaReviewStatuses.get(entity) || "";
  }

  updateLayout(options = {}) {
    if (this._delegate) {
      return this._delegate.updateLayout?.(options);
    }
    if (!this.isActive()) return undefined;
    this._pendingLayoutOptions = options;
    void this._ensureDelegate();
    return undefined;
  }

  teardownMedia() {
    return this._delegate?.teardownMedia?.();
  }

  render() {
    if (this._delegate) {
      this._delegate.render?.();
      return;
    }
    if (!this.isActive()) return;
    this._renderRequested = true;
    void this._ensureDelegate();
  }

  updateMeta() {
    if (this._delegate) {
      this._delegate.updateMeta?.();
      return;
    }
    if (!this.isActive()) return;
    this._metaUpdateRequested = true;
    void this._ensureDelegate();
  }

  start() {
    if (!this.isActive()) return;
    this._started = true;
    this._renderRequested = true;
    if (this._delegate) {
      this._delegate.start?.();
      return;
    }
    void this._ensureDelegate();
  }

  resumeVisible() {
    if (!this.isActive()) return;
    if (this._delegate) {
      this._delegate.resumeVisible?.();
      return;
    }
    this._resumeRequested = true;
    void this._ensureDelegate();
  }

  stop() {
    this._started = false;
    this._renderRequested = false;
    this._resumeRequested = false;
    this._hassUpdateRequested = false;
    this._metaUpdateRequested = false;
    this._pendingLayoutOptions = null;
    this._pendingConfigOptions = null;
    this._pendingRealtimeMessages = [];
    this._pendingHaReviewStatuses.clear();
    this._pendingToggleCount = 0;
    this._delegate?.stop?.();
  }

  handleRealtimeMessage(message) {
    if (this._delegate) {
      this._delegate.handleRealtimeMessage?.(message);
      return;
    }
    if (!this.isActive()) return;
    this._pendingRealtimeMessages.push(message);
    if (
      this._pendingRealtimeMessages.length >
      MAX_PENDING_REALTIME_MESSAGES
    ) {
      this._pendingRealtimeMessages.shift();
    }
    void this._ensureDelegate();
  }

  handleHaReviewStatus(entity, severity) {
    if (this._delegate) {
      return (
        this._delegate.handleHaReviewStatus?.(entity, severity) === true
      );
    }
    if (!this.isActive() || !entity) return false;
    this._pendingHaReviewStatuses.set(entity, severity);
    void this._ensureDelegate();
    return true;
  }

  handleHassUpdate() {
    if (this._delegate) {
      this._delegate.handleHassUpdate?.();
      return;
    }
    if (!this.isActive()) return;
    this._hassUpdateRequested = true;
    void this._ensureDelegate();
  }

  applyConfigUpdate(options = {}) {
    if (this._delegate) {
      this._delegate.applyConfigUpdate?.(options);
      return;
    }
    if (options.takeoverDefaultChanged) this._pendingToggleCount = 0;
    this._pendingConfigOptions = {
      ...(this._pendingConfigOptions || {}),
      ...options,
    };
    if (this.isActive()) void this._ensureDelegate();
  }

  selectCamera(index) {
    this._delegate?.selectCamera?.(index);
  }

  _resetPendingWork() {
    this._renderRequested = false;
    this._resumeRequested = false;
    this._hassUpdateRequested = false;
    this._metaUpdateRequested = false;
    this._pendingLayoutOptions = null;
    this._pendingConfigOptions = null;
    this._pendingRealtimeMessages = [];
    this._pendingHaReviewStatuses.clear();
    this._pendingToggleCount = 0;
  }

  _ensureDelegate() {
    if (this._delegate) return Promise.resolve(this._delegate);
    if (this._delegatePromise) return this._delegatePromise;
    const delegatePromise = Promise.resolve()
      .then(() => this._loadModule())
      .then((module) => {
        const Controller = module?.WideViewCompanionController;
        if (typeof Controller !== "function") {
          throw new TypeError(
            "Wide View companion module did not export its controller",
          );
        }
        const delegate = new Controller(this._host, this._constants);
        this._delegate = delegate;
        if (!this.isActive()) {
          this._resetPendingWork();
          return delegate;
        }

        if (this._started) delegate.start?.();
        if (this._pendingConfigOptions) {
          delegate.applyConfigUpdate?.(this._pendingConfigOptions);
        }
        for (let index = 0; index < this._pendingToggleCount; index += 1) {
          delegate.toggleAlertTakeover?.();
        }
        for (const message of this._pendingRealtimeMessages) {
          delegate.handleRealtimeMessage?.(message);
        }
        for (const [entity, severity] of this._pendingHaReviewStatuses) {
          delegate.handleHaReviewStatus?.(entity, severity);
        }
        if (this._hassUpdateRequested) delegate.handleHassUpdate?.();

        const refreshed = this._onReady?.() === true;
        if (!refreshed && this._renderRequested) delegate.render?.();
        if (!refreshed && this._metaUpdateRequested) delegate.updateMeta?.();
        if (!refreshed && this._pendingLayoutOptions) {
          delegate.updateLayout?.(this._pendingLayoutOptions);
        }
        if (this._resumeRequested) delegate.resumeVisible?.();
        this._resetPendingWork();
        return delegate;
      })
      .catch((error) => {
        if (this._delegatePromise === delegatePromise) {
          this._delegatePromise = null;
        }
        console.warn(
          "[Frigate] Wide View companion cameras could not load",
          error,
        );
        return null;
      });
    this._delegatePromise = delegatePromise;
    return delegatePromise;
  }
}
