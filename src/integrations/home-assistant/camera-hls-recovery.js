// A retryable HA error describes the current request, not the lifetime of the
// native player. Keep that candidate mounted so HA can finish its own recovery.
export function createHaCameraHlsRecovery(provider, {
  requestHls, resolveUrl = (url) => url, now = () => Date.now(),
  setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  let player = null;
  let video = null;
  let failedStreams = null;
  let usableStreams = null;
  let recovered = false;
  let stoppedAt = 0;
  let disposed = false;
  let refreshing = false;
  let lastRefreshAt = -Infinity;
  let retryTimer = null;
  const cancelRetry = () => {
    if (retryTimer !== null) clearTimer(retryTimer);
    retryTimer = null;
  };
  const isCurrentFailure = (target) => !disposed && player === target &&
    provider.shadowRoot?.querySelector("ha-hls-player") === target &&
    target?.isConnected && !recovered && target._error && target._errorIsFatal === false;

  const refreshUrl = async () => {
    if (!requestHls || refreshing || !isCurrentFailure(player)) return;
    const delay = Math.max(0, 5000 - (now() - lastRefreshAt));
    if (delay) {
      if (retryTimer === null) retryTimer = setTimer(() => {
        retryTimer = null;
        void refreshUrl();
      }, delay);
      return;
    }
    cancelRetry();
    refreshing = true;
    lastRefreshAt = now();
    const target = player;
    try {
      const response = await requestHls();
      if (!isCurrentFailure(target)) return;
      const path = typeof response?.url === "string" ? response.url.trim() : "";
      if (!path) throw new Error("HA stream URL unavailable");
      const url = resolveUrl(path);
      // The public URL input lets HA reset its own player. An unchanged URL
      // stays with HA's retry/backoff; no new instance or parallel stream.
      if (url !== (target.url || target._url)) target.url = url;
    } catch (_) {
      // A backend outage can outlast HA's native request retries.
      if (isCurrentFailure(target)) retryTimer = setTimer(() => {
        retryTimer = null;
        void refreshUrl();
      }, 5000);
    } finally {
      refreshing = false;
    }
  };

  const unwatch = () => {
    video?.removeEventListener("playing", onProgress);
    video?.removeEventListener("timeupdate", onProgress);
    video = null;
  };
  const syncPlayer = () => {
    const current = provider.shadowRoot?.querySelector("ha-hls-player") || null;
    if (player === current) return;
    cancelRetry();
    unwatch();
    player = current;
    failedStreams = null;
    usableStreams = null;
    recovered = false;
  };
  function onProgress() {
    if (disposed || !player?.isConnected || !video || player._error ||
        player._errorIsFatal !== false || video.error || video.paused ||
        video.readyState < 2 || !video.videoWidth || video.currentTime === stoppedAt) return;
    recovered = true;
    cancelRetry();
    unwatch();
    // HA clears its error on fragment load but does not re-emit streams:true.
    provider.requestUpdate();
  }
  function observe() {
    if (disposed) return;
    syncPlayer();
    if (!failedStreams || recovered) return;
    const current = player?.shadowRoot?.querySelector("video") || null;
    if (current === video) return;
    unwatch();
    video = current;
    if (!video) return;
    stoppedAt = video.currentTime;
    video.addEventListener("playing", onProgress);
    video.addEventListener("timeupdate", onProgress);
  }
  return {
    observe,
    adjustStreams(streams) {
      if (disposed) return streams;
      syncPlayer();
      if (streams?.hasVideo === true) usableStreams = streams;
      if (streams?.hasVideo !== false || !player?.isConnected || player._errorIsFatal !== false) {
        cancelRetry();
        failedStreams = null;
        unwatch();
        return streams;
      }
      if (player._error && streams !== failedStreams) {
        unwatch();
        failedStreams = streams;
        recovered = false;
        void refreshUrl();
      }
      if (streams !== failedStreams) return streams;
      observe();
      // Undefined means pending to HA; never claim readiness during an outage.
      return recovered ? (usableStreams || { hasVideo: true, hasAudio: false }) : undefined;
    },
    dispose() {
      disposed = true;
      cancelRetry();
      unwatch();
      player = null;
    },
  };
}
