import { VERSION } from "../../constants.js";
import { CARD_PICKER_DEMO_ASSET_NAME } from "../../release-artifacts.mjs";
const cardPickerDemoModuleState = { promise: null };

export const ensureCardPickerDemoModule = ({
  importModule = (url) => import(url),
  baseUrl = import.meta.url,
} = {}) => {
  if (cardPickerDemoModuleState.promise) {
    return cardPickerDemoModuleState.promise;
  }
  const assetUrl = new URL(`./${CARD_PICKER_DEMO_ASSET_NAME}`, baseUrl);
  assetUrl.searchParams.set("fvc-version", VERSION);
  cardPickerDemoModuleState.promise = Promise.resolve()
    .then(() => importModule(assetUrl.href))
    .catch((error) => {
      cardPickerDemoModuleState.promise = null;
      throw error;
    });
  return cardPickerDemoModuleState.promise;
};

export class LazyCardPickerDemoController {
  constructor(
    host,
    {
      loadModule = ensureCardPickerDemoModule,
      onLoadError = (error) =>
        console.warn("[Frigate] Card-picker demo could not load", error),
    } = {},
  ) {
    this._host = host;
    this._loadModule = loadModule;
    this._onLoadError = onLoadError;
    this._delegate = null;
    this._delegatePromise = null;
    this._renderRequested = false;
  }

  render(active = true) {
    this._renderRequested = active;
    this._host.classList?.toggle?.("card-picker-demo-host", active);
    if (!active) {
      this._deactivateShell();
      this._delegate?.render?.(false);
      return false;
    }
    if (this._delegate) {
      this._delegate.render(true);
    } else {
      void this.prepare();
    }
    return true;
  }

  prepare() {
    if (this._delegate) return Promise.resolve(this._delegate);
    if (this._delegatePromise) return this._delegatePromise;

    const delegatePromise = Promise.resolve()
      .then(() => this._loadModule())
      .then((module) => {
        const Controller = module?.CardPickerDemoController;
        if (typeof Controller !== "function") {
          throw new TypeError(
            "Card-picker demo module did not export its controller",
          );
        }
        this._delegate = new Controller(this._host);
        this._delegate.render(this._renderRequested);
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

  dispose() {
    this._renderRequested = false;
    this._deactivateShell();
    this._delegate?.dispose?.();
  }

  _deactivateShell() {
    this._host.classList?.remove?.("card-picker-demo-host");
    this._host.shadowRoot
      ?.querySelector?.("#card")
      ?.classList?.remove?.("card-picker-demo");
  }
}
