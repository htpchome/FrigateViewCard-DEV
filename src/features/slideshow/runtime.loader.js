import { SLIDESHOW_ROTATION_OPTIONS_SECONDS, VERSION } from "../../constants.js";
import { flattenCameraMembers } from "../camera-groups/model.js";
import { setLocalizedText } from "../localization/localized-dom.js";
import { shouldHandleSlideshowReview } from "./routing.js";

const SLIDESHOW_RUNTIME_ASSET_NAME = "frigate-view-card-slideshow.js";
const slideshowRuntimeModuleState = { promise: null };

export const ensureSlideshowRuntimeModule = ({
  importModule = (url) => import(url),
  baseUrl = import.meta.url,
} = {}) => {
  if (slideshowRuntimeModuleState.promise) {
    return slideshowRuntimeModuleState.promise;
  }
  const assetUrl = new URL(`./${SLIDESHOW_RUNTIME_ASSET_NAME}`, baseUrl);
  assetUrl.searchParams.set("fvc-version", VERSION);
  slideshowRuntimeModuleState.promise = Promise.resolve()
    .then(() => importModule(assetUrl.href))
    .catch((error) => {
      slideshowRuntimeModuleState.promise = null;
      throw error;
    });
  return slideshowRuntimeModuleState.promise;
};

export class LazySlideshowFeatureController {
  constructor(
    host,
    options = {},
    { loadModule = ensureSlideshowRuntimeModule } = {},
  ) {
    this._host = host;
    this._options = options;
    this._loadModule = loadModule;
    this._controllers = null;
    this._controllersPromise = null;
    this._disposed = false;
  }

  isSupported() {
    return (
      this._host?._config?.slideshow_rotation_enabled === true &&
      flattenCameraMembers(this._host?._config?.cameras).length > 1
    );
  }

  isLoaded() {
    return Boolean(this._controllers);
  }

  shouldPrepareForLandingPage(pageId, pageIds = {}) {
    if (!this.isSupported()) return false;
    let startMode = "";
    if (pageId === pageIds.singleView) {
      startMode = this._host?._config?.single_view_start_mode;
    } else if (pageId === pageIds.wideView) {
      startMode = this._host?._config?.wide_view_start_mode;
    } else if (
      pageId === pageIds.cardView &&
      this._host?._config?.card_view_view_mode === "video-only"
    ) {
      startMode = this._host?._config?.card_view_start_mode;
    }
    return String(startMode || "").trim().toLowerCase() === "slideshow";
  }

  prepare() {
    if (!this.isSupported() || this._disposed) {
      return Promise.resolve(null);
    }
    return this._ensureControllers();
  }

  controller(name) {
    return this._controllers?.[name] || null;
  }

  dispose() {
    this._disposed = true;
    this._controllers?.page?.stop?.("dispose", false);
    this._controllers = null;
  }

  _ensureControllers() {
    if (this._controllers) return Promise.resolve(this._controllers);
    if (this._controllersPromise) return this._controllersPromise;

    const controllersPromise = Promise.resolve()
      .then(() => this._loadModule())
      .then((module) => {
        if (this._disposed || !this.isSupported()) return null;
        const createControllers = module?.createSlideshowRuntimeControllers;
        if (typeof createControllers !== "function") {
          throw new TypeError(
            "Slideshow runtime module did not export its controller factory",
          );
        }
        const controllers = createControllers(this._host, this._options);
        if (!controllers?.alert || !controllers?.page) {
          throw new TypeError(
            "Slideshow runtime module did not create every required controller",
          );
        }
        this._controllers = controllers;
        return controllers;
      })
      .catch((error) => {
        if (this._controllersPromise === controllersPromise) {
          this._controllersPromise = null;
        }
        console.warn("[Frigate] Slideshow runtime could not load", error);
        return null;
      })
      .finally(() => {
        if (
          !this._controllers &&
          this._controllersPromise === controllersPromise
        ) {
          this._controllersPromise = null;
        }
      });
    this._controllersPromise = controllersPromise;
    return controllersPromise;
  }
}

export class LazySlideshowPageController {
  constructor(host, featureController) {
    this._host = host;
    this._featureController = featureController;
    this._activationSequence = 0;
  }

  _delegate() {
    return this._featureController.controller("page");
  }

  available() {
    return this._featureController.isSupported();
  }

  rotationMs() {
    const delegate = this._delegate();
    if (delegate) return delegate.rotationMs();
    const seconds = Number(this._host?._config?.slideshow_rotation_seconds);
    return SLIDESHOW_ROTATION_OPTIONS_SECONDS.includes(seconds)
      ? seconds * 1000
      : 30000;
  }

  clearTimers() {
    const delegate = this._delegate();
    if (delegate) {
      delegate.clearTimers();
      return;
    }
    for (const name of [
      "_slideshowSwitchT",
      "_slideshowPauseT",
      "_slideshowFadeT",
      "_slideshowReviewProbeT",
      "_slideshowReviewWatchT",
    ]) {
      if (this._host?.[name]) clearTimeout(this._host[name]);
      if (this._host) this._host[name] = null;
    }
  }

  clearCountdownOverlay() {
    const delegate = this._delegate();
    if (delegate) {
      delegate.clearCountdownOverlay();
      return;
    }
    if (!this._host) return;
    this._host._slideshowNextSwitchAtMs = 0;
    if (this._host._slideshowCountdownT) {
      clearInterval(this._host._slideshowCountdownT);
    }
    this._host._slideshowCountdownT = null;
    const chip = this._host._$?.("#slideshow-next-chip");
    if (chip) {
      chip.hidden = true;
      const translate = this._host._localization?.t;
      if (typeof translate === "function") {
        setLocalizedText(
          chip,
          "runtime.live.nextSlide",
          translate,
          { seconds: 0 },
        );
      } else {
        chip.textContent = "Next Slide: 0s";
      }
    }
    this._host._cardViewPageController?.syncStandaloneSlideshowCountdown?.();
  }

  syncCountdownOverlay() {
    const delegate = this._delegate();
    if (delegate) {
      delegate.syncCountdownOverlay();
      return;
    }
    this.clearCountdownOverlay();
  }

  setCountdown(waitMs) {
    this._delegate()?.setCountdown?.(waitMs);
  }

  stop(reason = "manual-stop", sync = true) {
    this._activationSequence += 1;
    const delegate = this._delegate();
    if (delegate) {
      delegate.stop(reason, sync);
      return;
    }
    this._resetInactiveState();
    if (sync) this._host?._syncToolbarButtons?.();
  }

  start(source = "manual") {
    const delegate = this._delegate();
    if (delegate) return delegate.start(source);
    if (!this.available()) return false;
    this._queueActivation("start", source);
    return true;
  }

  pauseForPopup() {
    this._delegate()?.pauseForPopup?.();
  }

  resumeAfterPopup() {
    this._delegate()?.resumeAfterPopup?.();
  }

  toggle() {
    const delegate = this._delegate();
    if (delegate) {
      delegate.toggle();
      return;
    }
    if (!this.available()) {
      this._host?._syncToolbarButtons?.();
      return;
    }
    this._queueActivation("toggle");
  }

  handleAlertTakeoverStateChange(enabled) {
    this._delegate()?.handleAlertTakeoverStateChange?.(enabled);
  }

  handlePageChange(previousPageId, nextPageId) {
    if (previousPageId !== nextPageId) this._activationSequence += 1;
    return (
      this._delegate()?.handlePageChange?.(previousPageId, nextPageId) === true
    );
  }

  pause() {
    this._delegate()?.pause?.();
  }

  schedule(reason = "") {
    this._delegate()?.schedule?.(reason);
  }

  advance() {
    return this._delegate()?.advance?.() || Promise.resolve();
  }

  _queueActivation(method, source = "manual") {
    const requestedPageId = this._host?._pageId;
    const activationSequence = ++this._activationSequence;
    void this._featureController.prepare().then((controllers) => {
      if (
        !controllers ||
        this._activationSequence !== activationSequence ||
        this._host?._pageId !== requestedPageId ||
        !this.available() ||
        !this._startRequestStillApplies(source)
      ) {
        return;
      }
      controllers.page?.[method]?.(source);
    });
  }

  _startRequestStillApplies(source) {
    const startModeKey = {
      "single-view-start": "single_view_start_mode",
      "wide-view-start": "wide_view_start_mode",
      "card-view-start": "card_view_start_mode",
    }[source];
    if (!startModeKey) return true;
    return (
      String(this._host?._config?.[startModeKey] || "")
        .trim()
        .toLowerCase() === "slideshow"
    );
  }

  _resetInactiveState() {
    this.clearTimers();
    this.clearCountdownOverlay();
    if (!this._host) return;
    this._host._slideshowActive = false;
    this._host._slideshowPopupPaused = false;
    this._host._slideshowPausedUntil = 0;
    this._host._slideshowPendingAlertCam = "";
    this._host._slideshowPendingAlertType = "";
    this._host._slideshowLastAlertAt = 0;
    this._host._slideshowLastAlertCam = "";
    this._host._slideshowStartedAtSec = 0;
    this._host._slideshowReviewProbeInFlight = false;
    this._host._liveAlertTakeoverController?.setVisualState?.("");
    this._host._slideshowHandledReviewIds?.clear?.();
  }
}

export class LazySlideshowAlertController {
  constructor(host, featureController) {
    this._host = host;
    this._featureController = featureController;
  }

  _delegate() {
    return this._featureController.controller("alert");
  }

  shouldHandleReview(entity, severity) {
    return shouldHandleSlideshowReview(
      this._host?._config,
      entity,
      severity,
    );
  }

  startSession() {
    this._delegate()?.startSession?.();
  }

  stopSession() {
    this._delegate()?.stopSession?.();
  }

  releaseAlertPresentation(entity) {
    return this._delegate()?.releaseAlertPresentation?.(entity) === true;
  }

  completeAlertPresentation(entity) {
    return this._delegate()?.completeAlertPresentation?.(entity) === true;
  }

  resetPresentations() {
    this._delegate()?.resetPresentations?.();
  }

  handleReviewsUpdated(...args) {
    this._delegate()?.handleReviewsUpdated?.(...args);
  }

  probeLatestReview() {
    return this._delegate()?.probeLatestReview?.() || Promise.resolve();
  }

  scheduleReviewProbe(delayMs = 180) {
    this._delegate()?.scheduleReviewProbe?.(delayMs);
  }

  handleHaStatusCandidate(entity, severity = "alert") {
    return (
      this._delegate()?.handleHaStatusCandidate?.(entity, severity) === true
    );
  }

  syncHaAlertState(options = {}) {
    return this._delegate()?.syncHaAlertState?.(options) === true;
  }

  scheduleReviewWatch(delayMs = null) {
    this._delegate()?.scheduleReviewWatch?.(delayMs);
  }

  handleRealtimeMessage(message) {
    this._delegate()?.handleRealtimeMessage?.(message);
  }
}
