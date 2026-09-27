import { VERSION } from "../../constants.js";
import {
  CARD_VIEW_VIEW_MODES,
  normalizeCardViewViewMode,
} from "./config.js";
import { POPUP_PRESENTATION_CARD_VIEW_DRAWER } from "../popup/media.js";

const CARD_VIEW_PAGE_ASSET_NAME = "frigate-view-card-card-view.js";
const cardViewPageModuleState = { promise: null };

export const ensureCardViewPageModule = ({
  importModule = (url) => import(url),
  baseUrl = import.meta.url,
} = {}) => {
  if (cardViewPageModuleState.promise) {
    return cardViewPageModuleState.promise;
  }
  const assetUrl = new URL(`./${CARD_VIEW_PAGE_ASSET_NAME}`, baseUrl);
  assetUrl.searchParams.set("fvc-version", VERSION);
  cardViewPageModuleState.promise = Promise.resolve()
    .then(() => importModule(assetUrl.href))
    .catch((error) => {
      cardViewPageModuleState.promise = null;
      throw error;
    });
  return cardViewPageModuleState.promise;
};

export const ensureCardViewPageStyles = async (host, options = {}) => {
  const module = await ensureCardViewPageModule(options);
  if (typeof module?.installCardViewPageStyles !== "function") {
    throw new TypeError(
      "Card View module did not export its style installer",
    );
  }
  return module.installCardViewPageStyles(host);
};

export class LazyCardViewPageController {
  constructor(
    host,
    constants = {},
    { loadModule = ensureCardViewPageModule } = {},
  ) {
    this._host = host;
    this._constants = constants;
    this._loadModule = loadModule;
    this._delegate = null;
    this._delegatePromise = null;
    this._shellBuilder = null;
    this._pendingActivationContext = null;
    this._pendingConfigOptions = null;
    this._disposed = false;

    return new Proxy(this, {
      get: (target, property, receiver) => {
        if (Reflect.has(target, property)) {
          return Reflect.get(target, property, receiver);
        }
        const value = target._delegate?.[property];
        return typeof value === "function"
          ? value.bind(target._delegate)
          : value;
      },
      set: (target, property, value, receiver) => {
        if (
          !Reflect.has(target, property) &&
          target._delegate &&
          property in target._delegate
        ) {
          target._delegate[property] = value;
          return true;
        }
        return Reflect.set(target, property, value, receiver);
      },
    });
  }

  isSupported() {
    return this._host?._config?.card_view_page_enabled === true;
  }

  isActive() {
    return this._host?._pageId === this._constants?.PAGE_IDS?.cardView;
  }

  isStandalone() {
    return (
      this.isActive() &&
      this._host?._config?.card_view_standalone === true
    );
  }

  usesOverlayPresentation() {
    return (
      this.isActive() &&
      normalizeCardViewViewMode(
        this._host?._config?.card_view_view_mode,
      ) === CARD_VIEW_VIEW_MODES.videoOnly
    );
  }

  prepare() {
    if (!this.isSupported()) return Promise.resolve(null);
    return this._ensureDelegate();
  }

  prepareStyles() {
    return this.prepare();
  }

  buildMainLayoutShellMarkup(options = {}) {
    if (this._shellBuilder) return this._shellBuilder(options);
    if (this.isActive() && this.isSupported()) {
      void this._ensureDelegate();
    }
    return "";
  }

  activateCardViewPageRoute(context = {}) {
    if (!this.isSupported()) return;
    if (this._delegate) {
      this._delegate.activateCardViewPageRoute(context);
      return;
    }
    this._pendingActivationContext = context;
    void this._ensureDelegate();
  }

  applyConfigUpdate(options = {}) {
    if (this._delegate) {
      this._delegate.applyConfigUpdate(options);
      return;
    }
    if (!this.isActive() || !this.isSupported()) return;
    this._pendingConfigOptions = {
      ...(this._pendingConfigOptions || {}),
      ...options,
    };
    void this._ensureDelegate();
  }

  deactivate() {
    this._pendingActivationContext = null;
    this._pendingConfigOptions = null;
    this._delegate?.deactivate?.();
  }

  dispose() {
    this._disposed = true;
    this._pendingActivationContext = null;
    this._pendingConfigOptions = null;
    this._delegate?.deactivate?.();
  }

  alertTakeoverEnabled() {
    if (this._delegate) {
      return this._delegate.alertTakeoverEnabled() === true;
    }
    if (this._host?._isAlertCameraTakeoverAvailable?.() === false) {
      return false;
    }
    return this._host?._config?.card_view_alert_takeover === true;
  }

  isPtzActive() {
    return this._delegate?.isPtzActive?.() === true;
  }

  liveFullscreenTarget() {
    if (this._delegate) return this._delegate.liveFullscreenTarget();
    const liveStage = this._host?._$?.("#live-stage") || null;
    if (!this.usesOverlayPresentation()) return liveStage;
    return this._host?._$?.("#card") || liveStage;
  }

  openDeepLinkEvent(event, { mediaHint = "" } = {}) {
    if (this._delegate) {
      return this._delegate.openDeepLinkEvent(event, { mediaHint });
    }
    if (!this.usesOverlayPresentation() || !event?.id) return false;
    const loader = this._host?._popupMediaLoaderController;
    const options = {
      presentation: POPUP_PRESENTATION_CARD_VIEW_DRAWER,
    };
    if (mediaHint === "snapshot" || !event.has_clip) {
      if (typeof loader?.showSnapshot !== "function") return false;
      loader.showSnapshot(event, options);
      return true;
    }
    if (typeof loader?.showClip !== "function") return false;
    loader.showClip(event, { ...options, mediaType: "clip" });
    return true;
  }

  handleRotateOverlayState(options = {}) {
    return this._delegate?.handleRotateOverlayState?.(options) === true;
  }

  applyConfiguredStartMode(options = {}) {
    if (this._delegate) {
      return this._delegate.applyConfiguredStartMode(options) === true;
    }
    if (this.isActive() && this.isSupported()) void this._ensureDelegate();
    return false;
  }

  start() {
    if (!this.isActive() || !this.isSupported()) {
      return Promise.resolve();
    }
    return this._ensureDelegate().then((delegate) => delegate?.start?.());
  }

  refreshActiveContent(options = {}) {
    if (!this.isActive() || !this.isSupported()) {
      return Promise.resolve();
    }
    return this._ensureDelegate().then((delegate) =>
      delegate?.refreshActiveContent?.(options),
    );
  }

  handleCameraChanged() {
    if (!this.isActive() || !this.isSupported()) {
      return Promise.resolve();
    }
    return this._ensureDelegate().then((delegate) =>
      delegate?.handleCameraChanged?.(),
    );
  }

  handleRealtimeMessage(message) {
    if (!this.isActive()) return;
    if (this._delegate) {
      this._delegate.handleRealtimeMessage(message);
      return;
    }
    void this._ensureDelegate().then((delegate) => {
      if (this.isActive()) delegate?.handleRealtimeMessage?.(message);
    });
  }

  handleHaAlertStateChanged(changed) {
    if (!this.isActive()) return;
    if (this._delegate) {
      this._delegate.handleHaAlertStateChanged(changed);
      return;
    }
    void this._ensureDelegate().then((delegate) => {
      if (this.isActive()) delegate?.handleHaAlertStateChanged?.(changed);
    });
  }

  handleClick(event, target) {
    return this._delegate?.handleClick?.(event, target) === true;
  }

  syncCardViewPageMarkup() {
    if (this._delegate) {
      this._delegate.syncCardViewPageMarkup();
      return;
    }
    if (this.isActive() && this.isSupported()) void this._ensureDelegate();
  }

  bind() {
    this._invokeWhenActive("bind");
  }

  renderToolbar(buttonStates = null) {
    this._invokeWhenActive("renderToolbar", buttonStates);
  }

  renderActivity() {
    this._invokeWhenActive("renderActivity");
  }

  renderCamSwitcher() {
    this._invokeWhenActive("renderCamSwitcher");
  }

  syncStatus() {
    this._invokeWhenActive("syncStatus");
  }

  renderStats() {
    this._invokeWhenActive("renderStats");
  }

  renderSubtitle() {
    this._delegate?.renderSubtitle?.();
  }

  renderLegend() {
    this._delegate?.renderLegend?.();
  }

  renderListLabel(...args) {
    this._delegate?.renderListLabel?.(...args);
  }

  syncBrowseHeadFromScroll() {
    this._delegate?.syncBrowseHeadFromScroll?.();
  }

  syncOlderHint(...args) {
    this._delegate?.syncOlderHint?.(...args);
  }

  renderList(...args) {
    this._delegate?.renderList?.(...args);
  }

  titleText() {
    return this._delegate?.titleText?.() || "";
  }

  subtitleText() {
    return this._delegate?.subtitleText?.() || "";
  }

  camSwitcherMarkup(options = {}) {
    if (this._delegate) return this._delegate.camSwitcherMarkup(options);
    if (this.isActive() && this.isSupported()) void this._ensureDelegate();
    return "";
  }

  setListHtmlIfChanged(...args) {
    return this._delegate?.setListHtmlIfChanged?.(...args) === true;
  }

  syncStandaloneSlideshowCountdown() {
    this._invokeWhenActive("syncStandaloneSlideshowCountdown");
  }

  _invokeWhenActive(method, ...args) {
    if (!this.isActive() || !this.isSupported()) return;
    if (this._delegate) {
      this._delegate[method]?.(...args);
      return;
    }
    void this._ensureDelegate().then((delegate) => {
      if (this.isActive()) delegate?.[method]?.(...args);
    });
  }

  _ensureDelegate() {
    if (this._delegate) return Promise.resolve(this._delegate);
    if (this._delegatePromise) return this._delegatePromise;
    if (!this.isSupported() || this._disposed) {
      return Promise.resolve(null);
    }

    const delegatePromise = Promise.resolve()
      .then(() => this._loadModule())
      .then((module) => {
        if (this._disposed || !this.isSupported()) return null;
        const createController = module?.createCardViewPageController;
        const shellBuilder = module?.buildCardViewMainLayoutShellMarkup;
        if (
          typeof createController !== "function" ||
          typeof shellBuilder !== "function"
        ) {
          throw new TypeError(
            "Card View module did not export its controller factory and shell builder",
          );
        }

        module.installCardViewPageStyles?.(this._host);
        this._shellBuilder = shellBuilder;
        this._delegate = createController(this._host, this._constants);

        if (!this.isActive()) return this._delegate;
        this._host?._renderShellPreserveLive?.();
        if (!this.isActive()) return this._delegate;

        const activationContext = this._pendingActivationContext;
        this._pendingActivationContext = null;
        if (activationContext) {
          this._delegate.activateCardViewPageRoute(activationContext);
        } else {
          this._delegate.syncCardViewPageMarkup();
        }
        if (this._pendingConfigOptions) {
          this._delegate.applyConfigUpdate(this._pendingConfigOptions);
          this._pendingConfigOptions = null;
        }
        return this._delegate;
      })
      .catch((error) => {
        if (this._delegatePromise === delegatePromise) {
          this._delegatePromise = null;
        }
        console.warn("[Frigate] Card View page could not load", error);
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
