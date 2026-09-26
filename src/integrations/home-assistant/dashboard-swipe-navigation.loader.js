import { VERSION } from "../../constants.js";
import { findCurrentHomeAssistantLovelaceRoot } from "./navbar.ctrl.js";

const DASHBOARD_SWIPE_ASSET_NAME =
  "frigate-view-card-dashboard-swipe-navigation.js";
const DASHBOARD_SWIPE_LOADER_KEY = Symbol.for(
  "frigate-view-card.dashboard-swipe-navigation-loader",
);
const LOADER_RETRY_FRAMES = 120;
const dashboardSwipeModuleState = { promise: null };

const normalizeCardTag = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^custom:/, "");

const findDashboardSwipeOwnerConfig = (
  dashboardConfig,
  cardTag = "frigate-view-card",
) => {
  const normalizedCardTag = normalizeCardTag(cardTag);
  if (!normalizedCardTag || !Array.isArray(dashboardConfig?.views)) {
    return null;
  }
  for (const view of dashboardConfig.views) {
    const visited = new Set();
    let ownerConfig = null;
    const visit = (value, depth = 0) => {
      if (
        ownerConfig ||
        !value ||
        typeof value !== "object" ||
        depth > 30 ||
        visited.has(value)
      ) {
        return;
      }
      visited.add(value);
      if (
        !Array.isArray(value) &&
        normalizeCardTag(value.type) === normalizedCardTag
      ) {
        if (value.ha_dashboard_swipe_navigation_owner === true) {
          ownerConfig = value;
        }
        return;
      }
      Object.values(value).forEach((entry) => visit(entry, depth + 1));
    };
    visit(view);
    if (ownerConfig) return ownerConfig;
  }
  return null;
};

const composedParent = (element) => {
  if (!element) return null;
  if (element.parentNode) return element.parentNode;
  const root = element.getRootNode?.();
  return root && root !== element ? root.host || null : element.host || null;
};

const findLovelacePanel = (huiRoot, documentRef = globalThis.document) => {
  let current = huiRoot;
  for (let depth = 0; current && depth < 12; depth += 1) {
    if (String(current.tagName || "").toUpperCase() === "HA-PANEL-LOVELACE") {
      return current;
    }
    current = composedParent(current);
  }
  const homeAssistant = documentRef?.querySelector?.("home-assistant");
  const mainRoot = homeAssistant?.shadowRoot?.querySelector?.(
    "home-assistant-main",
  )?.shadowRoot;
  const resolver = mainRoot?.querySelector?.("partial-panel-resolver");
  return (
    resolver?.querySelector?.("ha-panel-lovelace") ||
    resolver?.shadowRoot?.querySelector?.("ha-panel-lovelace") ||
    mainRoot?.querySelector?.("ha-panel-lovelace") ||
    null
  );
};

const findCurrentDashboardHuiRoot = (documentRef) =>
  findCurrentHomeAssistantLovelaceRoot(documentRef) ||
  findLovelacePanel(null, documentRef)?.shadowRoot?.querySelector?.(
    "hui-root",
  ) ||
  null;

export const cardConfigEnablesDashboardSwipeNavigation = (
  config,
  { hasTouch = true } = {},
) =>
  config?.ha_dashboard_swipe_navigation_owner === true &&
  config?.ha_dashboard_swipe_navigation !== "none" &&
  (hasTouch || config?.ha_dashboard_swipe_mouse_enabled === true);

export const dashboardConfigNeedsPreMountSwipeNavigation = (
  dashboardConfig,
  {
    cardTag = "frigate-view-card",
    hasTouch = true,
  } = {},
) => {
  const ownerConfig = findDashboardSwipeOwnerConfig(dashboardConfig, cardTag);
  if (!ownerConfig) return false;
  if (!hasTouch && ownerConfig.ha_dashboard_swipe_mouse_enabled !== true) {
    return false;
  }
  const mode = String(ownerConfig.ha_dashboard_swipe_navigation || "")
    .trim()
    .toLowerCase()
    .replace(/[_+\s]+/g, "-");
  if (mode === "none") return false;
  if (mode === "inside-card") {
    return ownerConfig.ha_dashboard_swipe_include_other_cards === true;
  }
  // The runtime normalizer treats missing and legacy values as dashboard-wide.
  return true;
};

export const ensureDashboardSwipeNavigationModule = ({
  importModule = (url) => import(url),
  baseUrl = import.meta.url,
} = {}) => {
  if (dashboardSwipeModuleState.promise) {
    return dashboardSwipeModuleState.promise;
  }
  const assetUrl = new URL(`./${DASHBOARD_SWIPE_ASSET_NAME}`, baseUrl);
  assetUrl.searchParams.set("fvc-version", VERSION);
  dashboardSwipeModuleState.promise = Promise.resolve(
    importModule(assetUrl.href),
  ).catch((error) => {
    dashboardSwipeModuleState.promise = null;
    throw error;
  });
  return dashboardSwipeModuleState.promise;
};

export class LazyHomeAssistantDashboardSwipeNavigationController {
  constructor(
    host,
    options = {},
    { loadModule = ensureDashboardSwipeNavigationModule } = {},
  ) {
    this._host = host;
    this._options = options;
    this._loadModule = loadModule;
    this._delegate = null;
    this._delegatePromise = null;
    this._syncRequested = false;
  }

  sync() {
    this._syncRequested = true;
    if (this._delegate) {
      this._delegate.sync();
      return;
    }
    if (
      !cardConfigEnablesDashboardSwipeNavigation(this._host?._config, {
        hasTouch: this._options.hasTouch !== false,
      })
    ) {
      return;
    }
    if (this._delegatePromise) return;
    void this._ensureDelegate()
      .then((delegate) => {
        if (this._syncRequested) delegate.sync();
      })
      .catch((error) => {
        console.warn(
          "[Frigate] Dashboard swipe navigation could not load",
          error,
        );
      });
  }

  disconnect(options) {
    this._syncRequested = false;
    this._delegate?.disconnect?.(options);
  }

  isCurrentDashboardScope() {
    return this._delegate?.isCurrentDashboardScope?.() === true;
  }

  _ensureDelegate() {
    if (this._delegate) return Promise.resolve(this._delegate);
    if (this._delegatePromise) return this._delegatePromise;
    this._delegatePromise = Promise.resolve(this._loadModule())
      .then((module) => {
        module.installHomeAssistantDashboardSwipeNavigation?.({
          cardTag: this._options.cardTag,
        });
        this._delegate =
          new module.HomeAssistantDashboardSwipeNavigationController(
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

export const installLazyHomeAssistantDashboardSwipeNavigation = ({
  cardTag = "frigate-view-card",
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  MutationObserverCtor = globalThis.MutationObserver,
  hasTouch =
    Boolean(windowRef && "ontouchstart" in windowRef) ||
    Number(windowRef?.navigator?.maxTouchPoints || 0) > 0,
  getComputedStyleFn = globalThis.getComputedStyle,
  queueMicrotaskFn = globalThis.queueMicrotask,
  nowFn = () => globalThis.performance?.now?.() || Date.now(),
  requestAnimationFrameFn = windowRef?.requestAnimationFrame?.bind(windowRef),
  setTimeoutFn = windowRef?.setTimeout?.bind(windowRef) || globalThis.setTimeout,
  createLocationChangedEvent = null,
  findCurrentHuiRoot = () => findCurrentDashboardHuiRoot(documentRef),
  findPanel = (huiRoot) => findLovelacePanel(huiRoot, documentRef),
  loadModule = ensureDashboardSwipeNavigationModule,
} = {}) => {
  if (!windowRef || !documentRef) return null;
  if (windowRef[DASHBOARD_SWIPE_LOADER_KEY]) {
    return windowRef[DASHBOARD_SWIPE_LOADER_KEY];
  }

  let retryToken = 0;
  let disconnected = false;
  let fullBootstrap = null;
  let activationPromise = null;
  const stopWatching = () => {
    retryToken += 1;
    windowRef.removeEventListener?.("location-changed", scheduleSync);
    windowRef.removeEventListener?.("popstate", scheduleSync);
  };
  const activate = () => {
    if (activationPromise) return activationPromise;
    activationPromise = Promise.resolve(loadModule())
      .then((module) => {
        if (disconnected) return;
        fullBootstrap =
          module.installHomeAssistantDashboardSwipeNavigation?.({
            cardTag,
            documentRef,
            windowRef,
            MutationObserverCtor,
            hasTouch,
            getComputedStyleFn,
            queueMicrotaskFn,
            nowFn,
            requestAnimationFrameFn,
            setTimeoutFn,
            createLocationChangedEvent,
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
  function scheduleSync() {
    const token = retryToken + 1;
    retryToken = token;
    let remaining = LOADER_RETRY_FRAMES;
    const run = () => {
      if (disconnected || token !== retryToken || fullBootstrap) return;
      const huiRoot = findCurrentHuiRoot?.() || null;
      const dashboardConfig = huiRoot
        ? findPanel?.(huiRoot)?.lovelace?.config || null
        : null;
      if (huiRoot && dashboardConfig) {
        if (
          dashboardConfigNeedsPreMountSwipeNavigation(dashboardConfig, {
            cardTag,
            hasTouch,
          })
        ) {
          void activate().catch((error) => {
            console.warn(
              "[Frigate] Dashboard swipe navigation could not load",
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
    if (windowRef[DASHBOARD_SWIPE_LOADER_KEY]?.disconnect === disconnect) {
      delete windowRef[DASHBOARD_SWIPE_LOADER_KEY];
    }
  };
  const bootstrap = { disconnect, sync: scheduleSync };
  windowRef[DASHBOARD_SWIPE_LOADER_KEY] = bootstrap;
  windowRef.addEventListener?.("location-changed", scheduleSync);
  windowRef.addEventListener?.("popstate", scheduleSync);
  scheduleSync();
  void windowRef.customElements
    ?.whenDefined?.("hui-root")
    ?.then?.(scheduleSync);
  return bootstrap;
};
