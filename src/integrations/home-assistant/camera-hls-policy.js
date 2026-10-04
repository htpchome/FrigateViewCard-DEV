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
