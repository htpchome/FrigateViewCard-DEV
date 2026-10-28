const FOREGROUND_PROGRESS_MS = 10000;

// Only inspect established playback after backgrounding, never cold startup.
export function createHaCameraWebRtcResume({
  provider, isUsable, onStalled, setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  const document = provider.ownerDocument;
  const window = document?.defaultView;
  let disposed = false;
  let presented = true;
  let hidden = Boolean(document?.hidden);
  let pending = null;
  let stopWatch = () => {};
  const currentPlayer = () => provider.shadowRoot?.querySelector("ha-web-rtc-player");
  const currentVideo = (player) => player?.shadowRoot?.querySelector("video");
  const frames = (video) => video.getVideoPlaybackQuality?.().totalVideoFrames;
  const clear = () => {
    stopWatch();
    stopWatch = () => {};
  };
  const capture = () => {
    clear();
    const player = currentPlayer();
    const video = currentVideo(player);
    pending = isUsable(player) && video && document?.pictureInPictureElement !== video &&
      video.webkitPresentationMode !== "picture-in-picture" ? { player, video } : null;
  };
  const resume = () => {
    if (disposed || hidden || document?.hidden || !presented || !pending) return;
    clear();
    const attempt = pending;
    const { player, video } = attempt;
    if (!player.isConnected || currentPlayer() !== player || currentVideo(player) !== video ||
        player.hidden || player.classList?.contains("hidden")) {
      pending = null;
      return;
    }
    const initialFrames = frames(video);
    const initialTime = video.currentTime;
    const current = () => !disposed && !hidden && !document?.hidden && presented && pending === attempt &&
      player.isConnected && !player.hidden && !player.classList?.contains("hidden") &&
      currentPlayer() === player && currentVideo(player) === video && isUsable(player);
    const progressed = () => !video.paused && !video.ended && !video.error && video.readyState >= 2 &&
      video.videoWidth > 0 && (Number.isFinite(initialFrames) && initialFrames > 0
        ? frames(video) > 0 && frames(video) !== initialFrames
        : video.currentTime > 0 && video.currentTime !== initialTime);
    const finish = () => {
      if (!current() || !progressed()) return;
      pending = null;
      clear();
    };
    const timer = setTimer(() => {
      if (pending !== attempt) return;
      const stalled = current() && !progressed();
      pending = null;
      clear();
      if (stalled) onStalled(player);
    }, FOREGROUND_PROGRESS_MS);
    const events = ["timeupdate", "playing", "loadeddata"];
    for (const event of events) video.addEventListener(event, finish);
    stopWatch = () => {
      clearTimer(timer);
      for (const event of events) video.removeEventListener(event, finish);
    };
    // iOS may only have paused the element; preserve its current audio choice.
    if (video.paused) {
      try {
        video.play()?.catch?.((error) => {
          if (!current() || error?.name !== "NotAllowedError") return;
          // Autoplay denial is not a failed transport.
          pending = null;
          clear();
        });
      } catch (error) {
        if (error?.name === "NotAllowedError") { pending = null; clear(); }
      }
    }
  };
  const onVisibility = () => {
    if (document.hidden) {
      if (!hidden) capture();
      hidden = true;
    } else if (hidden) {
      hidden = false;
      resume();
    }
  };
  const onPageHide = () => { if (!hidden) capture(); hidden = true; };
  const onPageShow = () => { if (!document?.hidden && hidden) { hidden = false; resume(); } };
  document?.addEventListener("visibilitychange", onVisibility);
  window?.addEventListener("pagehide", onPageHide);
  window?.addEventListener("pageshow", onPageShow);
  return {
    setPresented(value) {
      if (presented === value) return;
      presented = value;
      if (presented) resume();
      else clear();
    },
    observe() {
      if (pending && (currentPlayer() !== pending.player || currentVideo(pending.player) !== pending.video)) {
        pending = null;
        clear();
      }
    },
    dispose() {
      disposed = true;
      pending = null;
      clear();
      document?.removeEventListener("visibilitychange", onVisibility);
      window?.removeEventListener("pagehide", onPageHide);
      window?.removeEventListener("pageshow", onPageShow);
    },
  };
}
