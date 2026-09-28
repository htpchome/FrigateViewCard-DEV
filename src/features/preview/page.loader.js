import { VERSION } from "../../constants.js";

const PREVIEW_PAGE_ASSET_NAME = "frigate-view-card-preview.js";
const previewPageModuleState = { promise: null };

export const ensurePreviewPageModule = ({
  importModule = (url) => import(url),
  baseUrl = import.meta.url,
} = {}) => {
  if (previewPageModuleState.promise) {
    return previewPageModuleState.promise;
  }
  const assetUrl = new URL(`./${PREVIEW_PAGE_ASSET_NAME}`, baseUrl);
  assetUrl.searchParams.set("fvc-version", VERSION);
  previewPageModuleState.promise = Promise.resolve()
    .then(() => importModule(assetUrl.href))
    .catch((error) => {
      previewPageModuleState.promise = null;
      throw error;
    });
  return previewPageModuleState.promise;
};

class PreviewPageRuntime {
  constructor(
    host,
    constants,
    { loadModule = ensurePreviewPageModule } = {},
  ) {
    this._host = host;
    this._constants = constants;
    this._loadModule = loadModule;
    this._pageDelegate = null;
    this._alertDelegate = null;
    this._delegatePromise = null;
    this._shellBuilder = null;
    this._pendingActivationContext = null;
    this._disposed = false;
  }

  isEnabled() {
    return this._host?._config?.preview_page_enabled === true;
  }

  isActive() {
    return (
      this.isEnabled() &&
      this._host?._pageId === this._constants?.page?.PAGE_IDS?.preview
    );
  }

  prepare() {
    if (!this.isEnabled()) return Promise.resolve(null);
    return this._ensureDelegates();
  }

  buildMainLayoutShellMarkup(options = {}) {
    if (this._shellBuilder) return this._shellBuilder(options);
    if (this.isActive()) void this._ensureDelegates();
    return "";
  }

  activate(context = {}) {
    if (!this.isEnabled()) return;
    if (this._pageDelegate) {
      this._pageDelegate.activatePreviewPageRoute(context);
      return;
    }
    this._pendingActivationContext = context;
    void this._ensureDelegates();
  }

  invokePageWhenActive(method, ...args) {
    if (!this.isActive()) return;
    if (this._pageDelegate) {
      this._pageDelegate[method]?.(...args);
      return;
    }
    void this._ensureDelegates().then((delegates) => {
      if (this.isActive()) delegates?.page?.[method]?.(...args);
    });
  }

  invokeAlertWhenActive(method, ...args) {
    if (!this.isActive()) return;
    if (this._alertDelegate) {
      this._alertDelegate[method]?.(...args);
      return;
    }
    void this._ensureDelegates().then((delegates) => {
      if (this.isActive()) delegates?.alert?.[method]?.(...args);
    });
  }

  stop() {
    this._pendingActivationContext = null;
    this._pageDelegate?.stopPreviewMode?.();
  }

  dispose() {
    this._disposed = true;
    this._pendingActivationContext = null;
    this._pageDelegate?.stopPreviewMode?.();
  }

  _ensureDelegates() {
    if (this._pageDelegate && this._alertDelegate) {
      return Promise.resolve({
        page: this._pageDelegate,
        alert: this._alertDelegate,
      });
    }
    if (this._delegatePromise) return this._delegatePromise;
    if (!this.isEnabled() || this._disposed) return Promise.resolve(null);

    const delegatePromise = Promise.resolve()
      .then(() => this._loadModule())
      .then((module) => {
        if (this._disposed || !this.isEnabled()) return null;
        const createControllers = module?.createPreviewControllers;
        const shellBuilder = module?.buildPreviewPageMainLayoutShellMarkup;
        if (
          typeof createControllers !== "function" ||
          typeof shellBuilder !== "function"
        ) {
          throw new TypeError(
            "Preview Page module did not export its controller factory and shell builder",
          );
        }

        module.installPreviewPageStyles?.(this._host);
        this._shellBuilder = shellBuilder;
        const delegates = createControllers(this._host, this._constants);
        this._pageDelegate = delegates?.page || null;
        this._alertDelegate = delegates?.alert || null;
        if (!this._pageDelegate || !this._alertDelegate) {
          throw new TypeError(
            "Preview Page module did not create both controllers",
          );
        }

        if (!this.isActive()) return delegates;
        const activationContext = this._pendingActivationContext;
        this._pendingActivationContext = null;
        if (activationContext) {
          this._pageDelegate.activatePreviewPageRoute(activationContext);
        } else {
          this._host?._renderShellPreserveLive?.();
        }
        return delegates;
      })
      .catch((error) => {
        if (this._delegatePromise === delegatePromise) {
          this._delegatePromise = null;
        }
        console.warn("[Frigate] Preview Page could not load", error);
        return null;
      })
      .finally(() => {
        if (
          (!this._pageDelegate || !this._alertDelegate) &&
          this._delegatePromise === delegatePromise
        ) {
          this._delegatePromise = null;
        }
      });
    this._delegatePromise = delegatePromise;
    return delegatePromise;
  }
}

export class LazyPreviewPageController {
  constructor(runtime) {
    this._runtime = runtime;
  }

  prepare(options = {}) {
    return this._runtime.prepare(options);
  }

  buildMainLayoutShellMarkup(options = {}) {
    return this._runtime.buildMainLayoutShellMarkup(options);
  }

  isPreviewPageEnabled() {
    return this._runtime.isEnabled();
  }

  isPreviewPageActive() {
    return this._runtime.isActive();
  }

  previewLiveCamerasEnabled() {
    const mobile = this._runtime._constants?.page?.DEVICE_PROFILE?.isMobile;
    return mobile === true
      ? this._runtime._host?._config?.preview_page_live_cameras_mobile === true
      : this._runtime._host?._config?.preview_page_live_cameras === true;
  }

  activatePreviewPageRoute(context = {}) {
    this._runtime.activate(context);
  }

  applyPreviewShellVisibility() {
    if (this._runtime._pageDelegate) {
      this._runtime._pageDelegate.applyPreviewShellVisibility();
      return;
    }
    this._runtime.invokePageWhenActive("applyPreviewShellVisibility");
  }

  renderPreviewPage() {
    this._runtime.invokePageWhenActive("renderPreviewPage");
  }

  startPreviewMode() {
    this._runtime.invokePageWhenActive("startPreviewMode");
  }

  stopPreviewMode() {
    this._runtime.stop();
  }

  updatePreviewMeta() {
    this._runtime.invokePageWhenActive("updatePreviewMeta");
  }

  syncBottomNavbarPreviewChrome() {
    this._runtime.invokePageWhenActive("syncBottomNavbarPreviewChrome");
  }

  exitPreviewPageToCamera(...args) {
    this._runtime.invokePageWhenActive("exitPreviewPageToCamera", ...args);
  }

  returnToPreviewPage() {
    if (!this.isPreviewPageEnabled() || this.isPreviewPageActive()) return;
    if (this._runtime._pageDelegate) {
      this._runtime._pageDelegate.returnToPreviewPage();
      return;
    }
    void this._runtime.prepare().then((delegates) => {
      delegates?.page?.returnToPreviewPage?.();
    });
  }

  prepareRetainedCameraExit() {
    this._runtime._pageDelegate?.prepareRetainedCameraExit?.();
  }

  resumeRetainedCameraAfterExit() {
    this._runtime._pageDelegate?.resumeRetainedCameraAfterExit?.();
  }

  handleAlertStateChange(detail) {
    this._runtime._pageDelegate?.handleAlertStateChange?.(detail);
  }

  dispose() {
    this._runtime.dispose();
  }
}

export class LazyPreviewAlertController {
  constructor(runtime) {
    this._runtime = runtime;
  }

  clearTimers() {
    this._runtime._alertDelegate?.clearTimers?.();
  }

  isCameraAlertLive(entity) {
    return this._runtime._alertDelegate?.isCameraAlertLive?.(entity) === true;
  }

  previewCellSeverity(entity) {
    return this._runtime._alertDelegate?.previewCellSeverity?.(entity) || "";
  }

  markAlertCamera(...args) {
    if (this._runtime._alertDelegate) {
      return this._runtime._alertDelegate.markAlertCamera(...args);
    }
    this._runtime.invokeAlertWhenActive("markAlertCamera", ...args);
    return false;
  }

  handleRealtimeMessage(message) {
    this._runtime.invokeAlertWhenActive("handleRealtimeMessage", message);
  }

  scheduleAlertWatch(delayMs = null) {
    this._runtime.invokeAlertWhenActive("scheduleAlertWatch", delayMs);
  }

  probeLatestAlert() {
    if (!this._runtime.isActive()) return Promise.resolve();
    return this._runtime.prepare().then((delegates) =>
      delegates?.alert?.probeLatestAlert?.(),
    );
  }

  start() {
    this._runtime.invokeAlertWhenActive("start");
  }
}

export const createLazyPreviewControllers = (
  host,
  constants,
  options = {},
) => {
  const runtime = new PreviewPageRuntime(host, constants, options);
  return {
    alert: new LazyPreviewAlertController(runtime),
    page: new LazyPreviewPageController(runtime),
  };
};
