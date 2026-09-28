import { VERSION } from "../../constants.js";

const EDITOR_PREVIEW_DRAFT_ASSET_NAME =
  "frigate-view-card-editor-preview-draft.js";
const editorPreviewDraftModuleState = { promise: null };

export const ensureEditorPreviewDraftModule = ({
  importModule = (url) => import(url),
  baseUrl = import.meta.url,
} = {}) => {
  if (editorPreviewDraftModuleState.promise) {
    return editorPreviewDraftModuleState.promise;
  }
  const assetUrl = new URL(`./${EDITOR_PREVIEW_DRAFT_ASSET_NAME}`, baseUrl);
  assetUrl.searchParams.set("fvc-version", VERSION);
  editorPreviewDraftModuleState.promise = Promise.resolve()
    .then(() => importModule(assetUrl.href))
    .catch((error) => {
      editorPreviewDraftModuleState.promise = null;
      throw error;
    });
  return editorPreviewDraftModuleState.promise;
};

export class LazyEditorPreviewDraftController {
  constructor(
    host,
    {
      loadModule = ensureEditorPreviewDraftModule,
      resolveLandingPage = (pageId) => pageId,
      onLoadError = (error) =>
        console.warn("[Frigate] Editor preview updates could not load", error),
    } = {},
  ) {
    this._host = host;
    this._loadModule = loadModule;
    this._resolveLandingPage = resolveLandingPage;
    this._onLoadError = onLoadError;
    this._delegate = null;
    this._delegatePromise = null;
    this._operationQueue = Promise.resolve();
    this._generation = 0;
  }

  applyConfigDraft(options = {}) {
    if (this._delegate) return this._delegate.applyConfigDraft(options);
    const generation = this._generation;
    const operation = this._operationQueue.then(async () => {
      if (generation !== this._generation) return null;
      const delegate = await this.prepare();
      if (generation !== this._generation) return null;
      return delegate?.applyConfigDraft?.(options) ?? null;
    });
    this._operationQueue = operation.catch(() => null);
    return operation;
  }

  prepare() {
    if (this._delegate) return Promise.resolve(this._delegate);
    if (this._delegatePromise) return this._delegatePromise;
    const generation = this._generation;
    const delegatePromise = Promise.resolve()
      .then(() => this._loadModule())
      .then((module) => {
        if (generation !== this._generation) return null;
        const Controller = module?.EditorPreviewDraftController;
        if (typeof Controller !== "function") {
          throw new TypeError(
            "Editor-preview draft module did not export its controller",
          );
        }
        this._delegate = new Controller(this._host, {
          resolveLandingPage: this._resolveLandingPage,
        });
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
    this._generation += 1;
    this._delegate?.dispose?.();
    this._delegate = null;
    this._delegatePromise = null;
    this._operationQueue = Promise.resolve();
  }
}
