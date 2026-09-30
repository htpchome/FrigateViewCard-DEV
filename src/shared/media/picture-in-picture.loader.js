import { VERSION } from "../../constants.js";
import { PICTURE_IN_PICTURE_ASSET_NAME } from "../../release-artifacts.mjs";
import {
  disableNativePictureInPicture,
  enableNativePictureInPicture,
} from "./video-factory.js";

const pictureInPictureModuleState = { promise: null };

export const ensurePictureInPictureModule = ({
  importModule = (url) => import(url),
  baseUrl = import.meta.url,
} = {}) => {
  if (pictureInPictureModuleState.promise) {
    return pictureInPictureModuleState.promise;
  }
  const assetUrl = new URL(`./${PICTURE_IN_PICTURE_ASSET_NAME}`, baseUrl);
  assetUrl.searchParams.set("fvc-version", VERSION);
  pictureInPictureModuleState.promise = Promise.resolve()
    .then(() => importModule(assetUrl.href))
    .catch((error) => {
      pictureInPictureModuleState.promise = null;
      throw error;
    });
  return pictureInPictureModuleState.promise;
};

export class LazyPictureInPictureController {
  constructor(
    options = {},
    {
      loadModule = ensurePictureInPictureModule,
      onLoadError = (error) =>
        console.warn(
          "[Frigate] Picture-in-Picture controls could not load",
          error,
        ),
    } = {},
  ) {
    this._options = options;
    this._loadModule = loadModule;
    this._onLoadError = onLoadError;
    this._delegate = null;
    this._delegatePromise = null;
    this._syncRequested = false;
    this._active = true;
  }

  clear(scope) {
    if (this._delegate) {
      this._delegate.clear(scope);
      return;
    }
    this._hideButton(scope);
  }

  sync() {
    this._active = true;
    if (this._delegate) {
      this._delegate.sync();
      return;
    }

    this._applyNativePolicy();
    this._hideButton("live");
    this._hideButton("popup");
    if (this._options.isMobileTabletViewport?.() === true) return;

    this._syncRequested = true;
    void this._ensureDelegate();
  }

  async toggle(video, options = {}) {
    this._active = true;
    const delegate = await this._ensureDelegate();
    return delegate?.toggle?.(video, options);
  }

  dispose() {
    this._active = false;
    this._syncRequested = false;
    this._delegate?.dispose?.();
    this._hideButton("live");
    this._hideButton("popup");
  }

  _hideButton(scope) {
    const button = this._options.resolveButton?.(scope);
    if (!button) return;
    button.hidden = true;
    button.disabled = true;
  }

  _applyNativePolicy() {
    const popupOpen = this._options.isPopupOpen?.() === true;
    const updateNative =
      this._options.isFirefox?.() === true
        ? disableNativePictureInPicture
        : enableNativePictureInPicture;
    updateNative(this._options.resolveLiveVideo?.());
    updateNative(
      popupOpen ? this._options.resolvePopupVideo?.() : null,
    );
  }

  _ensureDelegate() {
    if (this._delegate) return Promise.resolve(this._delegate);
    if (this._delegatePromise) return this._delegatePromise;

    const delegatePromise = Promise.resolve()
      .then(() => this._loadModule())
      .then((module) => {
        if (!this._active) return null;
        const Controller = module?.PictureInPictureController;
        if (typeof Controller !== "function") {
          throw new TypeError(
            "Picture-in-Picture module did not export its controller",
          );
        }
        this._delegate = new Controller(this._options);
        if (this._syncRequested) this._delegate.sync();
        this._syncRequested = false;
        return this._delegate;
      })
      .catch((error) => {
        this._onLoadError?.(error);
        return null;
      })
      .finally(() => {
        if (this._delegatePromise === delegatePromise) {
          this._delegatePromise = null;
        }
      });
    this._delegatePromise = delegatePromise;
    return delegatePromise;
  }
}
