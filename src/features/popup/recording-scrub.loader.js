import { VERSION } from "../../constants.js";

const RECORDING_SCRUB_ASSET_NAME =
  "frigate-view-card-recording-scrub.js";
const recordingScrubModuleState = { promise: null };

export const ensurePopupRecordingScrubModule = ({
  importModule = (url) => import(url),
  baseUrl = import.meta.url,
} = {}) => {
  if (recordingScrubModuleState.promise) {
    return recordingScrubModuleState.promise;
  }
  const assetUrl = new URL(`./${RECORDING_SCRUB_ASSET_NAME}`, baseUrl);
  assetUrl.searchParams.set("fvc-version", VERSION);
  recordingScrubModuleState.promise = Promise.resolve(
    importModule(assetUrl.href),
  ).catch((error) => {
    recordingScrubModuleState.promise = null;
    throw error;
  });
  return recordingScrubModuleState.promise;
};

export class LazyPopupRecordingScrubController {
  constructor(
    options = {},
    { loadModule = ensurePopupRecordingScrubModule } = {},
  ) {
    this._options = options;
    this._loadModule = loadModule;
    this._delegate = null;
    this._delegatePromise = null;
    this._delegateEpoch = 0;
    this._generation = 0;
    this._pendingSourceUrl = "";
  }

  range() {
    return this._delegate?.range?.() ?? null;
  }

  segmentRange() {
    return this._delegate?.segmentRange?.() ?? null;
  }

  setSourceUrl(sourceUrl = "") {
    this._pendingSourceUrl = String(sourceUrl || "");
    return this._delegate?.setSourceUrl?.(this._pendingSourceUrl) === true;
  }

  toggleSegmentManager(force = null) {
    return this._delegate?.toggleSegmentManager?.(force) ?? false;
  }

  resetSegmentSelection() {
    return this._delegate?.resetSegmentSelection?.() ?? null;
  }

  cancelSegmentSelection(options) {
    return this._delegate?.cancelSegmentSelection?.(options) ?? false;
  }

  handleClick(event, target = event?.target) {
    return this._delegate?.handleClick?.(event, target) === true;
  }

  async initialize(payload = {}) {
    const generation = ++this._generation;
    this._pendingSourceUrl = String(payload?.sourceUrl || "");
    let delegate;
    try {
      delegate = await this._ensureDelegate();
    } catch (error) {
      console.warn(
        "[Frigate] Popup recording scrubber could not load",
        error,
      );
      return null;
    }
    if (
      !delegate || generation !== this._generation
    ) {
      return null;
    }
    const result = await delegate.initialize({
      ...payload,
      sourceUrl: this._pendingSourceUrl,
    });
    return generation === this._generation ? result : null;
  }

  teardown() {
    this._generation += 1;
    this._pendingSourceUrl = "";
    return this._delegate?.teardown?.();
  }

  dispose() {
    this._generation += 1;
    this._pendingSourceUrl = "";
    this._delegateEpoch += 1;
    const delegate = this._delegate;
    this._delegate = null;
    this._delegatePromise = null;
    return delegate?.dispose?.();
  }

  async openSegmentPreview() {
    return (await this._delegate?.openSegmentPreview?.()) === true;
  }

  closeSegmentPreview(options) {
    return this._delegate?.closeSegmentPreview?.(options) === true;
  }

  _ensureDelegate() {
    if (this._delegate) return Promise.resolve(this._delegate);
    if (this._delegatePromise) return this._delegatePromise;
    const epoch = this._delegateEpoch;
    const delegatePromise = Promise.resolve(this._loadModule())
      .then((module) => {
        if (epoch !== this._delegateEpoch) return null;
        const Controller = module?.PopupRecordingScrubController;
        if (typeof Controller !== "function") {
          throw new TypeError(
            "Popup recording scrubber module did not export its controller",
          );
        }
        this._delegate = new Controller(this._options);
        return this._delegate;
      })
      .catch((error) => {
        if (this._delegatePromise === delegatePromise) {
          this._delegatePromise = null;
        }
        throw error;
      });
    this._delegatePromise = delegatePromise;
    return delegatePromise;
  }
}
