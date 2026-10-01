import { VERSION } from "../../constants.js";
import { WIDE_VIEW_PAGE_ASSET_NAME } from "../../release-artifacts.mjs";
const wideViewPageModuleState = { promise: null };

export const ensureWideViewPageModule = ({
  importModule = (url) => import(url),
  baseUrl = import.meta.url,
} = {}) => {
  if (wideViewPageModuleState.promise) {
    return wideViewPageModuleState.promise;
  }
  const assetUrl = new URL(`./${WIDE_VIEW_PAGE_ASSET_NAME}`, baseUrl);
  assetUrl.searchParams.set("fvc-version", VERSION);
  wideViewPageModuleState.promise = Promise.resolve()
    .then(() => importModule(assetUrl.href))
    .catch((error) => {
      wideViewPageModuleState.promise = null;
      throw error;
    });
  return wideViewPageModuleState.promise;
};

export class LazyWideViewPageController {
  constructor(
    host,
    constants,
    {
      companionController = null,
      timelineController = null,
      loadModule = ensureWideViewPageModule,
    } = {},
  ) {
    this._host = host;
    this._constants = constants;
    this._companionController = companionController;
    this._timelineController = timelineController;
    this._loadModule = loadModule;
    this._delegate = null;
    this._delegatePromise = null;
    this._shellBuilder = null;
    this._pendingActivationContext = null;
    this._pendingPageConfigOptions = null;
    this._pendingStart = false;
    this._pendingResume = false;
    this._disposed = false;
  }

  isWideViewPageActive() {
    return this._host?._pageId === this._constants?.PAGE_IDS?.wideView;
  }

  isWideViewSupported() {
    if (this._host?._config?.wide_view_page_enabled !== true) return false;
    const mobileBucket = this._constants?.DEVICE_ROUTE_BUCKETS?.mobile;
    const deviceBucket = this._host?._deviceRouteBucket?.();
    return !mobileBucket || deviceBucket !== mobileBucket;
  }

  prepare({ startup = false } = {}) {
    if (!this.isWideViewSupported()) return Promise.resolve(null);
    return this._ensureDelegate().then(async (delegate) => {
      if (
        !delegate ||
        startup !== true ||
        !this.isWideViewPageActive()
      ) {
        return delegate;
      }
      await this._prepareStartupDependencies();
      return delegate;
    });
  }

  buildMainLayoutShellMarkup(options = {}) {
    if (this._shellBuilder) return this._shellBuilder(options);
    if (this.isWideViewPageActive() && this.isWideViewSupported()) {
      void this._ensureDelegate();
    }
    return "";
  }

  activateWideViewPageRoute(context = {}) {
    if (!this.isWideViewSupported()) return;
    if (this._delegate) {
      this._delegate.activateWideViewPageRoute(context);
      return;
    }
    this._pendingActivationContext = context;
    void this._ensureDelegate();
  }

  applyConfiguredStartMode(options = {}) {
    return this._delegate?.applyConfiguredStartMode?.(options) === true;
  }

  applyPageConfigUpdate(options = {}) {
    if (this._delegate) {
      this._delegate.applyPageConfigUpdate(options);
      return;
    }
    if (!this.isWideViewPageActive() || !this.isWideViewSupported()) return;
    this._pendingPageConfigOptions = options;
    void this._ensureDelegate();
  }

  buildCompanionRegionMarkup() {
    return this._delegate?.buildCompanionRegionMarkup?.() || "";
  }

  renderCompanionCameras() {
    this._delegate?.renderCompanionCameras?.();
  }

  buildTimelineRegionMarkup() {
    return this._delegate?.buildTimelineRegionMarkup?.() || "";
  }

  bindTimeline() {
    this._delegate?.bindTimeline?.();
  }

  renderTimeline(options = {}) {
    this._delegate?.renderTimeline?.(options);
  }

  teardownTimeline(options = {}) {
    if (this._delegate) {
      this._delegate.teardownTimeline(options);
      return;
    }
    this._timelineController?.teardown?.(options);
  }

  handleTimelineClick(event, target) {
    return this._delegate?.handleTimelineClick?.(event, target) === true;
  }

  applyTimelineConfigUpdate(options = {}) {
    if (this._delegate) {
      this._delegate.applyTimelineConfigUpdate(options);
      return;
    }
    this._timelineController?.applyConfigUpdate?.(options);
  }

  teardownCompanionMedia() {
    if (this._delegate) {
      this._delegate.teardownCompanionMedia();
      return;
    }
    this._companionController?.teardownMedia?.();
  }

  startCompanionMode() {
    if (this._delegate) {
      this._delegate.startCompanionMode();
      return;
    }
    if (!this.isWideViewPageActive() || !this.isWideViewSupported()) return;
    this._pendingStart = true;
    void this._ensureDelegate();
  }

  startWideViewMode() {
    if (this._delegate) {
      this._delegate.startWideViewMode();
      return;
    }
    this.startCompanionMode();
  }

  resumeCompanionMedia() {
    if (this._delegate) {
      this._delegate.resumeCompanionMedia();
      return;
    }
    if (!this.isWideViewPageActive() || !this.isWideViewSupported()) return;
    this._pendingResume = true;
    void this._ensureDelegate();
  }

  stopCompanionMode() {
    this._pendingStart = false;
    this._pendingResume = false;
    if (this._delegate) {
      this._delegate.stopCompanionMode();
      return;
    }
    this._companionController?.stop?.();
  }

  stopWideViewMode() {
    this._pendingActivationContext = null;
    this._pendingPageConfigOptions = null;
    this._pendingStart = false;
    this._pendingResume = false;
    if (this._delegate) {
      this._delegate.stopWideViewMode();
      return;
    }
    this._companionController?.stop?.();
    this._timelineController?.teardown?.({ preserveScroll: true });
  }

  dispose() {
    this._disposed = true;
    this._pendingActivationContext = null;
    this._pendingPageConfigOptions = null;
    this._pendingStart = false;
    this._pendingResume = false;
    this._delegate?.dispose?.();
  }

  disconnectResizeHandle() {
    this._delegate?.disconnectResizeHandle?.();
  }

  handleCompanionRealtimeMessage(message) {
    if (this._delegate) {
      this._delegate.handleCompanionRealtimeMessage(message);
      return;
    }
    this._companionController?.handleRealtimeMessage?.(message);
  }

  handleCompanionHaReviewStatus(entity, severity) {
    if (this._delegate) {
      return (
        this._delegate.handleCompanionHaReviewStatus(entity, severity) === true
      );
    }
    return (
      this._companionController?.handleHaReviewStatus?.(entity, severity) ===
      true
    );
  }

  handleCompanionHassUpdate() {
    if (this._delegate) {
      this._delegate.handleCompanionHassUpdate();
      return;
    }
    this._companionController?.handleHassUpdate?.();
  }

  applyCompanionConfigUpdate(options = {}) {
    if (this._delegate) {
      this._delegate.applyCompanionConfigUpdate(options);
      return;
    }
    this._companionController?.applyConfigUpdate?.(options);
  }

  companionLiveCamerasEnabled() {
    if (this._delegate) {
      return this._delegate.companionLiveCamerasEnabled() === true;
    }
    return this._companionController?.liveCamerasEnabled?.() === true;
  }

  companionAlertTakeoverEnabled() {
    if (this._delegate) {
      return this._delegate.companionAlertTakeoverEnabled() === true;
    }
    return this._companionController?.alertTakeoverEnabled?.() === true;
  }

  toggleCompanionAlertTakeover() {
    if (this._delegate) {
      return this._delegate.toggleCompanionAlertTakeover() === true;
    }
    return this._companionController?.toggleAlertTakeover?.() === true;
  }

  selectCompanionCamera(index) {
    if (this._delegate) {
      this._delegate.selectCompanionCamera(index);
      return;
    }
    this._companionController?.selectCamera?.(index);
  }

  applyStyleLayoutForCard() {
    if (this._delegate) {
      this._delegate.applyStyleLayoutForCard();
      return;
    }
    this._host?._applyCardStyle?.();
  }

  applyLayoutAndWideSyncForCard() {
    this._delegate?.applyLayoutAndWideSyncForCard?.();
  }

  applyStyleLayoutAndWideSyncForCard() {
    if (this._delegate) {
      this._delegate.applyStyleLayoutAndWideSyncForCard();
      return;
    }
    this._host?._applyCardStyle?.();
  }

  applyLayoutModeForCard() {
    this._delegate?.applyLayoutModeForCard?.();
  }

  syncColHeightIfWideView() {
    this._delegate?.syncColHeightIfWideView?.();
  }

  syncColHeight() {
    this._delegate?.syncColHeight?.();
  }

  resolveLiveResizeMaxHeightRatio(options = {}) {
    return this._delegate?.resolveLiveResizeMaxHeightRatio?.(options) ?? null;
  }

  scheduleToolbarPanelPlacement() {
    return this._delegate?.scheduleToolbarPanelPlacement?.() === true;
  }

  wideViewLayoutState(leftWidthPct) {
    return (
      this._delegate?.wideViewLayoutState?.(leftWidthPct) || {
        isWide: false,
        leftWidth: "",
        rightWidth: "",
      }
    );
  }

  applyWideLayoutMode(layout, leftWidthPct) {
    this._delegate?.applyWideLayoutMode?.(layout, leftWidthPct);
  }

  initResizeHandle() {
    this._delegate?.initResizeHandle?.();
  }

  _ensureDelegate() {
    if (this._delegate) return Promise.resolve(this._delegate);
    if (this._delegatePromise) return this._delegatePromise;
    if (!this.isWideViewSupported() || this._disposed) {
      return Promise.resolve(null);
    }

    const delegatePromise = Promise.resolve()
      .then(() => this._loadModule())
      .then(async (module) => {
        if (this._disposed || !this.isWideViewSupported()) return null;
        const Controller = module?.WideViewPageController;
        const shellBuilder = module?.buildWideViewMainLayoutShellMarkup;
        if (
          typeof Controller !== "function" ||
          typeof shellBuilder !== "function"
        ) {
          throw new TypeError(
            "Wide View module did not export its controller and shell builder",
          );
        }

        module.installWideViewPageStyles?.(this._host);
        this._shellBuilder = shellBuilder;
        this._delegate = new Controller(this._host, this._constants, {
          companionController: this._companionController,
          timelineController: this._timelineController,
        });

        const activationContext = this._pendingActivationContext;
        this._pendingActivationContext = null;
        if (!this.isWideViewPageActive()) return this._delegate;

        if (activationContext?.startup === true) {
          this._host?._renderShellPreserveLive?.();
          // Landing directly on Wide View starts its optional timeline only
          // after this module arrives. Let that shell replacement finish
          // before opening live media so Firefox does not interrupt a newly
          // established MSE WebSocket when the timeline becomes ready.
          await this._prepareStartupDependencies();
          if (this._disposed || !this.isWideViewPageActive()) {
            return this._delegate;
          }
        }
        if (activationContext) {
          this._delegate.activateWideViewPageRoute(activationContext);
        } else {
          this._host?._renderShellPreserveLive?.();
        }
        if (this._pendingPageConfigOptions) {
          this._delegate.applyPageConfigUpdate(
            this._pendingPageConfigOptions,
          );
          this._pendingPageConfigOptions = null;
        }
        if (this._pendingStart && !activationContext) {
          this._delegate.startCompanionMode();
        }
        if (this._pendingResume) {
          this._delegate.resumeCompanionMedia();
        }
        this._pendingStart = false;
        this._pendingResume = false;
        return this._delegate;
      })
      .catch((error) => {
        if (this._delegatePromise === delegatePromise) {
          this._delegatePromise = null;
        }
        console.warn("[Frigate] Wide View page could not load", error);
        return null;
      })
      .finally(() => {
        if (
          !this._delegate &&
          this._delegatePromise === delegatePromise
        ) {
          this._delegatePromise = null;
        }
      });
    this._delegatePromise = delegatePromise;
    return delegatePromise;
  }

  async _prepareStartupDependencies() {
    await this._timelineController?.prepare?.();
  }
}
