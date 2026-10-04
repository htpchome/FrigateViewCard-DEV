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
  let resumeFailure = false;
  let stoppedAt = 0;
  let disposed = false;
  let refreshing = false;
  let lastRefreshAt = -Infinity;
  let retryTimer = null;
  const document = provider.ownerDocument;
  const hasClearedVideo = (target) => {
    const media = target?.shadowRoot?.querySelector("video");
    return Boolean(usableStreams && media?.readyState === 0 && !media.getAttribute("src"));
  };
  const cancelRetry = () => {
    if (retryTimer !== null) clearTimer(retryTimer);
    retryTimer = null;
  };
  const isCurrentFailure = (target) => !disposed && player === target &&
    provider.shadowRoot?.querySelector("ha-hls-player") === target &&
    target?.isConnected && failedStreams && !recovered && target._errorIsFatal === false &&
    (target._error || resumeFailure || hasClearedVideo(target));

  const refreshUrl = async () => {
    if (!requestHls || refreshing || document?.hidden || !isCurrentFailure(player)) return;
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
      if (document?.hidden || !isCurrentFailure(target)) return;
      const path = typeof response?.url === "string" ? response.url.trim() : "";
      if (!path) throw new Error("HA stream URL unavailable");
      const url = resolveUrl(path);
      // startLoad cannot retry a manifest that never parsed. Reuse HA's URL
      // update lifecycle even if its backend retained the same stream URL.
      if (url !== (target.url || target._url)) target.url = url;
      else if (hasClearedVideo(target) || target._hlsPolyfillInstance?.levels?.length === 0) {
        if (target.url !== url) target.url = url;
        else target.requestUpdate("url", undefined);
      }
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

  const onVisibility = () => {
    if (document.hidden) cancelRetry();
    // HA restarts an emptied player on return. Wait for that attempt's
    // metadata/error instead of racing its pending master fetch with a new URL.
    else if (!hasClearedVideo(player)) void refreshUrl();
  };
  document?.addEventListener("visibilitychange", onVisibility);

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
    resumeFailure = false;
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
        resumeFailure = false;
        unwatch();
        return streams;
      }
      // On foreground return HA can parse an expired master as streams:false
      // before its engine reports an error. Do not discard that emptied player.
      if ((player._error || hasClearedVideo(player)) && streams !== failedStreams) {
        unwatch();
        failedStreams = streams;
        recovered = false;
        // Attaching a new MediaSource clears HA's error before the refreshed
        // URL arrives; only successful metadata/playback settles this failure.
        resumeFailure ||= hasClearedVideo(player);
        void refreshUrl();
      }
      if (streams !== failedStreams) return streams;
      observe();
      // Undefined means pending to HA; never claim readiness during an outage.
      return recovered ? (usableStreams || { hasVideo: true, hasAudio: false }) : undefined;
    },
    dispose() {
      disposed = true;
      document?.removeEventListener("visibilitychange", onVisibility);
      cancelRetry();
      unwatch();
      player = null;
    },
  };
}
