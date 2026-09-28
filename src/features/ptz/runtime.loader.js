import { VERSION } from "../../constants.js";
import { hasCameraPtz } from "./index.js";

const PTZ_RUNTIME_ASSET_NAME = "frigate-view-card-ptz.js";
const ptzRuntimeModuleState = { promise: null };

export const ensurePtzRuntimeModule = ({
  importModule = (url) => import(url),
  baseUrl = import.meta.url,
} = {}) => {
  if (ptzRuntimeModuleState.promise) return ptzRuntimeModuleState.promise;
  const assetUrl = new URL(`./${PTZ_RUNTIME_ASSET_NAME}`, baseUrl);
  assetUrl.searchParams.set("fvc-version", VERSION);
  ptzRuntimeModuleState.promise = Promise.resolve()
    .then(() => importModule(assetUrl.href))
    .catch((error) => {
      ptzRuntimeModuleState.promise = null;
      throw error;
    });
  return ptzRuntimeModuleState.promise;
};

export class LazyPtzFeatureController {
  constructor(host, { loadModule = ensurePtzRuntimeModule } = {}) {
    this._host = host;
    this._loadModule = loadModule;
    this._runtime = null;
    this._runtimePromise = null;
    this._pendingControlsList = null;
    this._controlsRenderPending = false;
  }

  isSupported() {
    const visible = this._host?._isControlsButtonVisible?.();
    return typeof visible === "boolean"
      ? visible
      : hasCameraPtz(this._host?._activeCam);
  }

  isLoaded() {
    return Boolean(this._runtime);
  }

  prepare() {
    if (!this.isSupported()) return Promise.resolve(null);
    return this._ensureRuntime();
  }

  controller(name) {
    return this._runtime?.controllers?.[name] || null;
  }

  activeInfo() {
    const delegate = this.controller("capability");
    if (delegate) return delegate.activeInfo();
    return (
      this._host?._camCache?.[this._host?._activeCam?.entity]?.ptzInfo ||
      null
    );
  }

  invokeAsync(controllerName, method, ...args) {
    const delegate = this.controller(controllerName);
    if (delegate) return Promise.resolve(delegate[method]?.(...args));
    return this.prepare().then((runtime) =>
      runtime?.controllers?.[controllerName]?.[method]?.(...args),
    );
  }

  invokeLoaded(controllerName, method, ...args) {
    return this.controller(controllerName)?.[method]?.(...args);
  }

  renderControls(list) {
    if (!list || !this.isSupported()) return;
    if (this._runtime) {
      this._runtime.renderPtzControls(this._host, list);
      return;
    }

    this._pendingControlsList = list;
    if (this._controlsRenderPending) return;
    this._host?._setListHtmlIfChanged?.(list, "");
    this._controlsRenderPending = true;
    void this.prepare()
      .then((runtime) => {
        if (!runtime || this._host?._tab !== "controls") return;
        const currentList =
          this._host?._pageShellRegionElement?.("browse", "#list") ||
          this._pendingControlsList;
        if (currentList) runtime.renderPtzControls(this._host, currentList);
      })
      .finally(() => {
        this._pendingControlsList = null;
        this._controlsRenderPending = false;
      });
  }

  syncControlsLabels() {
    this._runtime?.syncPtzControlsLabels?.(this._host);
  }

  _ensureRuntime() {
    if (this._runtime) return Promise.resolve(this._runtime);
    if (this._runtimePromise) return this._runtimePromise;

    const runtimePromise = Promise.resolve()
      .then(() => this._loadModule())
      .then((module) => {
        if (!this.isSupported()) return null;
        const createControllers = module?.createPtzRuntimeControllers;
        if (
          typeof createControllers !== "function" ||
          typeof module?.renderPtzControls !== "function" ||
          typeof module?.syncPtzControlsLabels !== "function"
        ) {
          throw new TypeError(
            "PTZ runtime did not export its controllers and presentation helpers",
          );
        }
        const controllers = createControllers(this._host);
        if (
          !controllers?.action ||
          !controllers?.capability ||
          !controllers?.interaction ||
          !controllers?.motion
        ) {
          throw new TypeError(
            "PTZ runtime did not create every required controller",
          );
        }
        this._runtime = {
          controllers,
          renderPtzControls: module.renderPtzControls,
          syncPtzControlsLabels: module.syncPtzControlsLabels,
        };
        return this._runtime;
      })
      .catch((error) => {
        if (this._runtimePromise === runtimePromise) {
          this._runtimePromise = null;
        }
        console.warn("[Frigate] PTZ runtime could not load", error);
        return null;
      })
      .finally(() => {
        if (!this._runtime && this._runtimePromise === runtimePromise) {
          this._runtimePromise = null;
        }
      });
    this._runtimePromise = runtimePromise;
    return runtimePromise;
  }
}

class LazyPtzCapabilityController {
  constructor(featureController) {
    this._featureController = featureController;
  }

  activeInfo() {
    return this._featureController.activeInfo();
  }

  ensureActiveInfo() {
    return this._featureController.invokeAsync(
      "capability",
      "ensureActiveInfo",
    );
  }

  resolveContext() {
    return this._featureController.invokeAsync(
      "capability",
      "resolveContext",
    );
  }
}

class LazyPtzActionController {
  constructor(featureController) {
    this._featureController = featureController;
  }

  execute(context) {
    return this._featureController.invokeAsync("action", "execute", context);
  }
}

class LazyPtzMotionController {
  constructor(featureController) {
    this._featureController = featureController;
  }

  start(action) {
    return this._featureController.invokeAsync("motion", "start", action);
  }

  stop(reason = "release") {
    return (
      this._featureController.invokeLoaded("motion", "stop", reason) ||
      Promise.resolve()
    );
  }

  dispose() {
    return (
      this._featureController.invokeLoaded("motion", "dispose") ||
      Promise.resolve()
    );
  }
}

class LazyPtzInteractionController {
  constructor(featureController) {
    this._featureController = featureController;
  }

  handleCirclePadEvent(event, eventType) {
    return this._featureController.invokeAsync(
      "interaction",
      "handleCirclePadEvent",
      event,
      eventType,
    );
  }

  handlePreset(presetName, button = null) {
    return this._featureController.invokeAsync(
      "interaction",
      "handlePreset",
      presetName,
      button,
    );
  }

  stopMotion(reason = "release") {
    return (
      this._featureController.invokeLoaded(
        "interaction",
        "stopMotion",
        reason,
      ) || Promise.resolve()
    );
  }

  handleControlPointerDown(event) {
    if (!event?.target?.closest?.("[data-ptz-control]")) {
      return Promise.resolve();
    }
    return this._featureController.invokeAsync(
      "interaction",
      "handleControlPointerDown",
      event,
    );
  }

  handleControlPointerStop(event) {
    return (
      this._featureController.invokeLoaded(
        "interaction",
        "handleControlPointerStop",
        event,
      ) || Promise.resolve()
    );
  }

  dispose() {
    return (
      this._featureController.invokeLoaded("interaction", "dispose") ||
      Promise.resolve()
    );
  }
}

export const createLazyPtzControllers = (
  host,
  { loadModule = ensurePtzRuntimeModule } = {},
) => {
  const featureController = new LazyPtzFeatureController(host, {
    loadModule,
  });
  return {
    _ptzFeatureController: featureController,
    _ptzCapabilityController: new LazyPtzCapabilityController(
      featureController,
    ),
    _ptzExec: new LazyPtzActionController(featureController),
    _ptzMotionController: new LazyPtzMotionController(featureController),
    _ptzInteractionController: new LazyPtzInteractionController(
      featureController,
    ),
  };
};
