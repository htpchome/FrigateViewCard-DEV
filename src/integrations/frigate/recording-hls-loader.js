const FRIGATE_PROXY_PREFIX = "/api/frigate/";

export function resolveUnsignedFrigateHlsPath(
  url,
  origin = globalThis.location?.origin || "http://localhost",
) {
  try {
    const resolved = new URL(url, origin);
    if (resolved.origin !== new URL(origin).origin) return "";
    if (!resolved.pathname.startsWith(FRIGATE_PROXY_PREFIX)) return "";
    resolved.searchParams.delete("authSig");
    return `${resolved.pathname}${resolved.search}`;
  } catch (_) {
    return "";
  }
}

export function resolveSignedFrigateHlsUrl(
  signedPath,
  requestUrl,
  origin = globalThis.location?.origin || "http://localhost",
) {
  try {
    const requestOrigin = new URL(requestUrl, origin).origin;
    return new URL(signedPath, requestOrigin).href;
  } catch (_) {
    return signedPath;
  }
}

export function createSignedFrigateHlsLoader(
  BaseLoader,
  {
    signPath = async (path) => path,
    origin = globalThis.location?.origin || "http://localhost",
    signedPathCache = new Map(),
  } = {},
) {
  if (typeof BaseLoader !== "function") return null;

  return class SignedFrigateHlsLoader extends BaseLoader {
    constructor(config) {
      super(config);
      this._fvcGeneration = 0;
      this._fvcDestroyed = false;
      this._fvcStarted = false;
    }

    load(context, config, callbacks) {
      const path = resolveUnsignedFrigateHlsPath(context?.url, origin);
      if (!path) {
        this._fvcStarted = true;
        return super.load(context, config, callbacks);
      }

      const generation = ++this._fvcGeneration;
      let signedPathPromise = signedPathCache.get(path);
      if (!signedPathPromise) {
        signedPathPromise = Promise.resolve(signPath(path));
        signedPathCache.set(path, signedPathPromise);
      }

      void signedPathPromise
        .then((signedPath) => {
          if (this._fvcDestroyed || generation !== this._fvcGeneration) return;
          this._fvcStarted = true;
          super.load(
            {
              ...context,
              url: resolveSignedFrigateHlsUrl(
                signedPath || path,
                context.url,
                origin,
              ),
            },
            config,
            callbacks,
          );
        })
        .catch((error) => {
          if (this._fvcDestroyed || generation !== this._fvcGeneration) return;
          callbacks?.onError?.(
            {
              code: 0,
              text:
                error?.message || "Unable to authenticate Frigate HLS media",
            },
            context,
            null,
          );
        });
      return undefined;
    }

    abort() {
      this._fvcGeneration += 1;
      if (this._fvcStarted) super.abort?.();
    }

    destroy() {
      this._fvcDestroyed = true;
      this._fvcGeneration += 1;
      super.destroy?.();
    }
  };
}
