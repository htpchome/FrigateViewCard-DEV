import { VERSION, SUPPORTED_CARD_TAGS } from "../../constants.js";
import { NAVBAR_ASSET_NAME } from "../../release-artifacts.mjs";
import {
  findCurrentHomeAssistantLovelaceRoot,
  findHomeAssistantLovelacePanel,
  findHomeAssistantLovelaceRoot,
} from "./lovelace-dom.js";
import { resolveDashboardNavbarOwnership } from "./navbar-policy.js";

const NAVBAR_LOADER_KEY = Symbol.for(
  "frigate-view-card.dashboard-navbar-loader",
);
const LOADER_RETRY_FRAMES = 120;
const navbarModuleState = { promise: null };

export const dashboardConfigNeedsPreMountNavbar = (
  dashboardConfig,
  { cardTag = SUPPORTED_CARD_TAGS } = {},
) =>
  Boolean(resolveDashboardNavbarOwnership(dashboardConfig, cardTag).owner);

const hostIsMobile = (host, options) => {
  const detected = host?._isLikelyMobileClient?.();
  return typeof detected === "boolean"
    ? detected
    : options?.isMobile === true;
};

const hostIsPhone = (host, options) => {
  const detected = host?._isLikelyPhoneClient?.();
  return typeof detected === "boolean"
    ? detected
    : options?.isPhone === true;
};

export const cardNeedsNavbarModule = (host, options = {}) => {
  if (!hostIsMobile(host, options)) return false;
  if (host?._config?.mobile_view_ha_navbar_bottom === true) return true;
  if (
    host?._config?.mobile_view_rotate_to_fullscreen === true &&
    hostIsPhone(host, options)
  ) {
    return true;
  }
  if (host?._isRotateOverlayViewportCoverActive?.() === true) return true;

  const documentRef = options.documentRef || globalThis.document;
  const currentHuiRoot =
    findHomeAssistantLovelaceRoot(host) ||
    options.findCurrentHuiRoot?.() ||
    findCurrentHomeAssistantLovelaceRoot(documentRef);
  const panel =
    options.findPanel?.(currentHuiRoot) ||
    findHomeAssistantLovelacePanel(currentHuiRoot, documentRef);
  return dashboardConfigNeedsPreMountNavbar(panel?.lovelace?.config, {
    cardTag: options.cardTag,
  });
};

export const ensureHomeAssistantNavbarModule = ({
  importModule = (url) => import(url),
  baseUrl = import.meta.url,
} = {}) => {
  if (navbarModuleState.promise) return navbarModuleState.promise;
  const assetUrl = new URL(`./${NAVBAR_ASSET_NAME}`, baseUrl);
  assetUrl.searchParams.set("fvc-version", VERSION);
  navbarModuleState.promise = Promise.resolve(importModule(assetUrl.href)).catch(
    (error) => {
      navbarModuleState.promise = null;
      throw error;
    },
  );
  return navbarModuleState.promise;
};

export class LazyHomeAssistantNavbarController {
  constructor(
    host,
    options = {},
    { loadModule = ensureHomeAssistantNavbarModule } = {},
  ) {
    this._host = host;
    this._options = options;
    this._loadModule = loadModule;
    this._delegate = null;
    this._delegatePromise = null;
    this._syncRequested = false;
  }

  sync() {
    const shouldLoad = cardNeedsNavbarModule(this._host, this._options);
    this._syncRequested = shouldLoad;
    if (this._delegate) return this._delegate.sync();
    if (!shouldLoad) return false;
    if (!this._delegatePromise) {
      void this._ensureDelegate()
        .then((delegate) => {
          if (!this._syncRequested) return;
          delegate.sync();
          this._host?._applyCardStyle?.();
          this._host?._previewPageController?.syncBottomNavbarPreviewChrome?.();
          this._host?._scheduleRotateOverlayUpdate?.();
        })
        .catch((error) => {
          console.warn(
            "[Frigate] Home Assistant navbar customization could not load",
            error,
          );
        });
    }
    return false;
  }

  disconnect(options) {
    this._syncRequested = false;
    this._delegate?.disconnect?.(options);
  }

  shouldCustomizeNavbar() {
    return this._delegate?.shouldCustomizeNavbar?.() === true;
  }

  shouldMoveNavbarToBottom() {
    return this._delegate?.shouldMoveNavbarToBottom?.() === true;
  }

  isNavbarAtBottom() {
    return this._delegate?.isNavbarAtBottom?.() === true;
  }

  bottomNavbarExtraHeightPx() {
    return Number(this._delegate?.bottomNavbarExtraHeightPx?.()) || 0;
  }

  homeAssistantViewContentHeightPx() {
    return this._delegate?.homeAssistantViewContentHeightPx?.() ?? null;
  }

  shouldStackNavbarTabs() {
    return this._delegate?.shouldStackNavbarTabs?.() === true;
  }

  _ensureDelegate() {
    if (this._delegate) return Promise.resolve(this._delegate);
    if (this._delegatePromise) return this._delegatePromise;
    this._delegatePromise = Promise.resolve(this._loadModule())
      .then((module) => {
        module.installHomeAssistantDashboardNavbarCustomization?.({
          ...this._options,
          isMobile: hostIsMobile(this._host, this._options),
        });
        this._delegate = new module.HomeAssistantNavbarController(
          this._host,
          this._options,
        );
        return this._delegate;
      })
      .catch((error) => {
        this._delegatePromise = null;
        throw error;
      });
    return this._delegatePromise;
  }
}

const findNavbarLoaderObserverTargets = (documentRef) => {
  const homeAssistant = documentRef?.querySelector?.("home-assistant");
  const homeAssistantRoot = homeAssistant?.shadowRoot || null;
  const mainRoot = homeAssistantRoot?.querySelector?.(
    "home-assistant-main",
  )?.shadowRoot;
  const resolver = mainRoot?.querySelector?.("partial-panel-resolver") || null;
  const panel = findHomeAssistantLovelacePanel(null, documentRef);
  return [
    documentRef?.documentElement,
    homeAssistantRoot,
    mainRoot,
    resolver,
    resolver?.shadowRoot,
    panel?.shadowRoot,
  ].filter(
    (target, index, targets) =>
      Boolean(target) && targets.indexOf(target) === index,
  );
};

export const installLazyHomeAssistantDashboardNavbarCustomization = ({
  cardTag = SUPPORTED_CARD_TAGS,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  MutationObserverCtor = globalThis.MutationObserver,
  getComputedStyleFn = globalThis.getComputedStyle,
  queueMicrotaskFn = globalThis.queueMicrotask,
  isMobile = false,
  isPhone = false,
  isIOS = false,
  requestAnimationFrameFn = windowRef?.requestAnimationFrame?.bind(windowRef),
  setTimeoutFn = windowRef?.setTimeout?.bind(windowRef) || globalThis.setTimeout,
  findCurrentHuiRoot = () =>
    findCurrentHomeAssistantLovelaceRoot(documentRef),
  findPanel = (huiRoot) =>
    findHomeAssistantLovelacePanel(huiRoot, documentRef),
  loadModule = ensureHomeAssistantNavbarModule,
} = {}) => {
  if (!windowRef || !documentRef || isMobile !== true) return null;
  if (windowRef[NAVBAR_LOADER_KEY]) return windowRef[NAVBAR_LOADER_KEY];

  let retryToken = 0;
  let disconnected = false;
  let fullBootstrap = null;
  let activationPromise = null;
  let observer = null;
  let observedTargets = [];

  const stopWatching = () => {
    retryToken += 1;
    observer?.disconnect?.();
    observer = null;
    observedTargets = [];
    windowRef.removeEventListener?.("location-changed", scheduleSync);
    windowRef.removeEventListener?.("popstate", scheduleSync);
  };
  const activate = () => {
    if (activationPromise) return activationPromise;
    activationPromise = Promise.resolve(loadModule())
      .then((module) => {
        if (disconnected) return;
        fullBootstrap =
          module.installHomeAssistantDashboardNavbarCustomization?.({
            cardTag,
            documentRef,
            windowRef,
            MutationObserverCtor,
            getComputedStyleFn,
            queueMicrotaskFn,
            isMobile,
            isPhone,
            isIOS,
            findCurrentHuiRoot,
            findPanel,
          });
        stopWatching();
      })
      .catch((error) => {
        activationPromise = null;
        throw error;
      });
    return activationPromise;
  };
  const observeShell = () => {
    const targets = findNavbarLoaderObserverTargets(documentRef);
    if (
      targets.length === observedTargets.length &&
      targets.every((target, index) => target === observedTargets[index])
    ) {
      return;
    }
    observer?.disconnect?.();
    observer = null;
    observedTargets = targets;
    if (!targets.length || typeof MutationObserverCtor !== "function") return;
    observer = new MutationObserverCtor(() => {
      observeShell();
      scheduleSync();
    });
    targets.forEach((target) =>
      observer.observe(target, { childList: true, subtree: true }),
    );
  };
  function scheduleSync() {
    const token = retryToken + 1;
    retryToken = token;
    observeShell();
    let remaining = LOADER_RETRY_FRAMES;
    const run = () => {
      if (disconnected || token !== retryToken || fullBootstrap) return;
      const huiRoot = findCurrentHuiRoot?.() || null;
      const dashboardConfig = huiRoot
        ? findPanel?.(huiRoot)?.lovelace?.config || null
        : null;
      if (huiRoot && dashboardConfig) {
        if (
          dashboardConfigNeedsPreMountNavbar(dashboardConfig, { cardTag })
        ) {
          void activate().catch((error) => {
            console.warn(
              "[Frigate] Home Assistant navbar customization could not load",
              error,
            );
          });
        }
        return;
      }
      remaining -= 1;
      if (remaining <= 0) return;
      if (typeof requestAnimationFrameFn === "function") {
        requestAnimationFrameFn(run);
      } else {
        setTimeoutFn(run, 16);
      }
    };
    run();
  }
  const disconnect = () => {
    if (disconnected) return;
    disconnected = true;
    stopWatching();
    fullBootstrap?.disconnect?.();
    if (windowRef[NAVBAR_LOADER_KEY]?.disconnect === disconnect) {
      delete windowRef[NAVBAR_LOADER_KEY];
    }
  };
  const bootstrap = { disconnect, sync: scheduleSync };
  windowRef[NAVBAR_LOADER_KEY] = bootstrap;
  windowRef.addEventListener?.("location-changed", scheduleSync);
  windowRef.addEventListener?.("popstate", scheduleSync);
  scheduleSync();
  void windowRef.customElements
    ?.whenDefined?.("hui-root")
    ?.then?.(scheduleSync);
  return bootstrap;
};
