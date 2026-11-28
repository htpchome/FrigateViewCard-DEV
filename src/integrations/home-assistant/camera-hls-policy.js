const configuredPlayers = new WeakSet();

// Leave complete segments, authentication, timing and discontinuities intact.
// Removing LL delivery instructions also prevents blocking playlist requests.
export function standardHaHlsPlaylist(playlist) {
  if (typeof playlist !== "string") return playlist;
  return playlist.replace(/^#EXT-X-(?:PART-INF|PART|PRELOAD-HINT|RENDITION-REPORT|SERVER-CONTROL):[^\r\n]*(?:\r?\n|$)/gm, "");
}

export function configureStandardHaHlsPlayer(player) {
  if (!player || configuredPlayers.has(player)) return;
  const render = player._renderHLSPolyfill;
  if (typeof render !== "function") throw new Error("Unsupported Home Assistant HLS configuration boundary");
  // Only this card-owned instance is adapted. HA still constructs, retains,
  // recovers and destroys its own engine; no global defaults are modified.
  player._renderHLSPolyfill = function (video, Hls, url) {
    const StandardHls = class extends Hls {
      constructor(config) {
        const Loader = config.pLoader || config.loader || Hls.DefaultConfig.loader;
        const PlaylistLoader = class extends Loader {
          load(context, loaderConfig, callbacks) {
            return super.load(context, loaderConfig, {
              ...callbacks,
              onSuccess: (response, ...args) => callbacks.onSuccess({
                ...response, data: standardHaHlsPlaylist(response.data),
              }, ...args),
            });
          }
        };
        super({ ...config, lowLatencyMode: false, pLoader: PlaylistLoader });
      }
    };
    return render.call(this, video, StandardHls, url);
  };
  configuredPlayers.add(player);
}

const configureInsertedHlsPlayers = (node) => {
  if (!node || typeof node !== "object") return;
  if (
    node.localName === "ha-hls-player" &&
    typeof node._renderHLSPolyfill === "function"
  ) {
    configureStandardHaHlsPlayer(node);
  }
  for (const player of node.querySelectorAll?.("ha-hls-player") || []) {
    if (typeof player._renderHLSPolyfill === "function") {
      configureStandardHaHlsPlayer(player);
    }
  }
};

// HA may construct its HLS engine synchronously when a cached player connects.
// Configure only children inserted into this provider's own shadow root, before
// native insertion runs connectedCallback. No global element is modified.
export function configureStandardHaHlsInsertionBoundary(root) {
  if (!root) return () => {};
  const methods = [
    "append",
    "appendChild",
    "insertBefore",
    "prepend",
    "replaceChild",
    "replaceChildren",
  ];
  const originals = new Map();

  for (const method of methods) {
    const original = root[method];
    if (typeof original !== "function") continue;
    originals.set(method, original);
    Object.defineProperty(root, method, {
      configurable: true,
      writable: true,
      value(...args) {
        for (const node of args) configureInsertedHlsPlayers(node);
        return original.apply(this, args);
      },
    });
  }

  return () => {
    for (const [method, original] of originals) {
      if (Object.prototype.hasOwnProperty.call(root, method)) {
        delete root[method];
      }
      if (root[method] !== original) {
        Object.defineProperty(root, method, {
          configurable: true,
          writable: true,
          value: original,
        });
      }
    }
  };
}
