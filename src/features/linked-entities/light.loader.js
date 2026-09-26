import { VERSION } from "../../constants.js";
import { flattenCameraMembers } from "../camera-groups/model.js";
import {
  linkedLightForCamera,
  linkedLightsForCamera,
  normalizeLinkedLightPosition,
} from "./config.js";

const LINKED_LIGHT_ASSET_NAME = "frigate-view-card-linked-light.js";
const linkedLightModuleState = { promise: null };

export const ensureLinkedLightModule = ({
  importModule = (url) => import(url),
  baseUrl = import.meta.url,
} = {}) => {
  if (linkedLightModuleState.promise) return linkedLightModuleState.promise;
  const assetUrl = new URL(`./${LINKED_LIGHT_ASSET_NAME}`, baseUrl);
  assetUrl.searchParams.set("fvc-version", VERSION);
  linkedLightModuleState.promise = Promise.resolve()
    .then(() => importModule(assetUrl.href))
    .catch((error) => {
      linkedLightModuleState.promise = null;
      throw error;
    });
  return linkedLightModuleState.promise;
};

export class LazyLinkedLightController {
  constructor(
    host,
    {
      loadModule = ensureLinkedLightModule,
      onLoadError = (error) =>
        console.warn("[Frigate] Linked-light controls could not load", error),
    } = {},
  ) {
    this.host = host;
    this._loadModule = loadModule;
    this._onLoadError = onLoadError;
    this._delegate = null;
    this._delegatePromise = null;
    this._syncRequested = false;
  }

  config(camera = this.host?._activeCam) {
    return linkedLightForCamera(camera);
  }

  configs(camera = this.host?._activeCam) {
    return linkedLightsForCamera(camera);
  }

  position(config = this.config()) {
    return normalizeLinkedLightPosition(config?.position);
  }

  hasConfiguredLights(camera = null) {
    const cameras = camera
      ? flattenCameraMembers([camera])
      : flattenCameraMembers(this.host?._config?.cameras);
    return cameras.some((candidate) => this.configs(candidate).length > 0);
  }

  stateSignature() {
    if (!this.hasConfiguredLights()) return "";
    if (this._delegate) return this._delegate.stateSignature?.() || "";
    void this._ensureDelegate();
    return "loading";
  }

  buildMarkup(options = {}) {
    const camera = options.camera || this.host?._activeCam;
    if (!this.hasConfiguredLights(camera)) return "";
    if (this._delegate) return this._delegate.buildMarkup?.(options) || "";
    this._syncRequested = true;
    void this._ensureDelegate();
    return "";
  }

  sync() {
    if (!this.hasConfiguredLights()) {
      if (this._delegate) {
        this._delegate.sync?.();
      } else {
        this._hideRegions();
      }
      return;
    }
    if (this._delegate) {
      this._delegate.sync?.();
      return;
    }
    this._syncRequested = true;
    this._hideRegions();
    void this._ensureDelegate();
  }

  handlePointerDown(event) {
    return this._delegate?.handlePointerDown?.(event) === true;
  }

  handlePointerStop(event) {
    return this._delegate?.handlePointerStop?.(event);
  }

  handleClick(event, target = event?.target) {
    return this._delegate?.handleClick?.(event, target) === true;
  }

  handleDocumentPointerDown(event) {
    return this._delegate?.handleDocumentPointerDown?.(event) === true;
  }

  closeDimmers(exceptControl = null) {
    return this._delegate?.closeDimmers?.(exceptControl);
  }

  cancelInteractions() {
    return this._delegate?.cancelInteractions?.();
  }

  _hideRegions() {
    this.host?.shadowRoot
      ?.querySelectorAll?.('[data-fvc-region="linked-entities"]')
      ?.forEach((region) => {
        region.hidden = true;
      });
  }

  _ensureDelegate() {
    if (this._delegate) return Promise.resolve(this._delegate);
    if (this._delegatePromise) return this._delegatePromise;
    const delegatePromise = Promise.resolve()
      .then(() => this._loadModule())
      .then((module) => {
        const Controller = module?.LinkedLightController;
        if (typeof Controller !== "function") {
          throw new TypeError(
            "Linked-light module did not export its controller",
          );
        }
        this._delegate = new Controller(this.host);
        if (this._syncRequested || this.hasConfiguredLights()) {
          this._delegate.sync?.();
        }
        this._syncRequested = false;
        return this._delegate;
      })
      .catch((error) => {
        if (this._delegatePromise === delegatePromise) {
          this._delegatePromise = null;
        }
        this._onLoadError?.(error);
        return null;
      });
    this._delegatePromise = delegatePromise;
    return delegatePromise;
  }
}
