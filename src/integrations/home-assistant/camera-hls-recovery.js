// A retryable HA error describes the current request, not the lifetime of the
// native player. Keep that candidate mounted so HA can finish its own recovery.
export function createHaCameraHlsRecovery(provider, {
  requestHls, resolveUrl = (url) => url, now = () => Date.now(),
  setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  let player = null;
  let video = null;
  let failedStreams = null;
  let clearedStreams = null;
  let usableStreams = null;
  let recovered = false;
  let resumeFailure = false;
  let stoppedAt = 0;
  let disposed = false;
  let refreshing = false;
  let lastRefreshAt = -Infinity;
  let retryTimer = null;
  let foregroundResume = null;
  let restoreVisibility = () => {};
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
    target?.isConnected && target._errorIsFatal === false &&
    (foregroundResume?.player === target || (failedStreams && !recovered &&
      (target._error || resumeFailure || hasClearedVideo(target))));

  const refreshUrl = async () => {
    if (!requestHls || refreshing || foregroundResume?.started || document?.hidden || !isCurrentFailure(player)) return;
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
      if (foregroundResume?.player === target) foregroundResume.started = true;
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
    // The instance visibility adapter owns emptied foreground restarts. Other
    // deferred failures can resume without racing a pending native master fetch.
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
    restoreVisibility();
    restoreVisibility = () => {};
    player = current;
    foregroundResume = null;
    failedStreams = null;
    clearedStreams = null;
    usableStreams = null;
    recovered = false;
    resumeFailure = false;
    const nativeVisibility = player?._handleVisibilityChange;
    if (!requestHls || !document || typeof nativeVisibility !== "function") return;
    const target = player;
    let wasHidden = document.hidden;
    const visibility = (event) => {
      const returning = wasHidden && !document.hidden;
      wasHidden = document.hidden;
      if (!document.hidden && foregroundResume?.player === target && !returning) return;
      // Only replace HA's stale-URL restart after its hidden cleanup. Leave
      // the native timer, short returns, PiP and initial startup alone.
      if (!disposed && player === target && target.isConnected && !document.hidden &&
          !document.pictureInPictureElement && !target._hiddenCleanupTimeout &&
          target._errorIsFatal === false && hasClearedVideo(target)) {
        foregroundResume = { player: target, started: false };
        recovered = false;
        void refreshUrl();
        observe();
        return;
      }
      nativeVisibility.call(target, event);
      // A URL response may have been discarded during another short hide.
      if (!document.hidden && foregroundResume && !foregroundResume.started) void refreshUrl();
    };
    document.removeEventListener("visibilitychange", nativeVisibility);
    target._handleVisibilityChange = visibility;
    document.addEventListener("visibilitychange", visibility);
    restoreVisibility = () => {
      document.removeEventListener("visibilitychange", visibility);
      if (target._handleVisibilityChange !== visibility) return;
      target._handleVisibilityChange = nativeVisibility;
      if (target.isConnected) document.addEventListener("visibilitychange", nativeVisibility);
    };
  };
  const onStreams = (event) => {
    if (disposed || event.composedPath()[0] !== provider.shadowRoot?.querySelector("ha-hls-player")) return;
    syncPlayer();
    foregroundResume = null;
    // HA attaches MediaSource synchronously after reporting missing codecs;
    // its parent's deferred render can no longer see the cleared video then.
    if (event.detail?.hasVideo === false && player?._errorIsFatal === false && hasClearedVideo(player)) {
      clearedStreams = event.detail;
    }
  };
  provider.addEventListener("streams", onStreams, true);
  function onProgress() {
    if (disposed || !player?.isConnected || !video || player._error ||
        player._errorIsFatal !== false || video.error || video.paused ||
        video.readyState < 2 || !video.videoWidth || video.currentTime === stoppedAt) return;
    recovered = true;
    foregroundResume = null;
    cancelRetry();
    unwatch();
    // HA clears its error on fragment load but does not re-emit streams:true.
    provider.requestUpdate();
  }
  function observe() {
    if (disposed) return;
    syncPlayer();
    if ((!failedStreams || recovered) && !foregroundResume) return;
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
      // Cached parent metadata is not a response from the restarted player.
      if (foregroundResume && streams?.hasVideo !== false) return streams;
      if (streams?.hasVideo !== false || !player?.isConnected || player._errorIsFatal !== false) {
        cancelRetry();
        failedStreams = null;
        clearedStreams = null;
        resumeFailure = false;
        unwatch();
        return streams;
      }
      // On foreground return HA can parse an expired master as streams:false
      // before its engine reports an error. Do not discard that emptied player.
      const clearedFailure = streams === clearedStreams;
      if ((player._error || foregroundResume || hasClearedVideo(player) || clearedFailure) && streams !== failedStreams) {
        unwatch();
        failedStreams = streams;
        recovered = false;
        // Attaching a new MediaSource clears HA's error before the refreshed
        // URL arrives; only successful metadata/playback settles this failure.
        resumeFailure ||= clearedFailure || hasClearedVideo(player);
        void refreshUrl();
      }
      if (streams !== failedStreams) return streams;
      observe();
      // Undefined means pending to HA; never claim readiness during an outage.
      return recovered ? (usableStreams || { hasVideo: true, hasAudio: false }) : undefined;
    },
    dispose() {
      disposed = true;
      provider.removeEventListener("streams", onStreams, true);
      document?.removeEventListener("visibilitychange", onVisibility);
      cancelRetry();
      unwatch();
      restoreVisibility();
      foregroundResume = null;
      player = null;
    },
  };
}
