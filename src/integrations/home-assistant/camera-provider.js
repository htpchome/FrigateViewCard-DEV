import {
  createHaCameraStreamElement,
  findActiveHaCameraStreamPlayer,
  findActiveHaCameraStreamVideo,
} from "./playback.js";
import { preserveHaCameraHlsFallback } from "./camera-stream-compat.js";
import { createHaCameraWebRtcRetry } from "./camera-webrtc-retry.js";
import { createHaCameraHlsRecovery } from "./camera-hls-recovery.js";
import { configureStandardHaHlsPlayer } from "./camera-hls-policy.js";
import { checkHaCameraResume } from "./camera-resume-health.js";
import { watchMediaFirstFrame } from "../../shared/media/first-frame.js";

export function findHaCameraContextHost(element) {
  let node = element;
  while (node) {
    if (node.localName === "home-assistant" && node.shadowRoot) return node;
    node = node.parentNode || node.host;
  }
  return null;
}

export function getHaCameraPresentationIdentity(element, config, sourceConfig) {
  let node = element;
  while (node && node.localName !== "hui-card") node = node.parentNode || node.host;
  // Save transfers the actual setConfig input, not a layout wrapper or defaults.
  return { config: node?.config || config, sourceConfig, signature: JSON.stringify(config) };
}

// All normal HA Direct presentations share this provider. Catalyst and HA's
// own cards keep their separate factories.
export function createHaDirectCameraProvider({
  hass,
  stateObj,
  onState,
  muted = true,
  outputMuted = muted,
  startupUnmuted = false,
  createStartupPlayback,
}) {
  const provider = createHaCameraStreamElement({
    stateObj, muted, defaultMuted: muted, controls: false, fitMode: "contain",
    styleText: "display:block;width:100%;height:100%",
  });
  const providerAutoplay = provider.autoPlay;
  if (startupUnmuted) provider.autoPlay = false;
  let selection = [];
  let hlsPending = false;
  let disposed = false;
  let scheduled = false;
  let watchedVideo = null;
  let stopFrameWatch = () => {};
  let stopVideoEvents = () => {};
  let initialPlayback = null;
  let restoreAutoplay = () => {};
  let observer = null;
  let observedPlayerRoot;
  let intendedOutputMuted = Boolean(outputMuted);
  let holdStartupAutoplay = startupUnmuted === true;
  const heldPlayerAutoplay = new Map();
  const heldVideoAutoplay = new Map();
  const holdNativeAutoplay = () => {
    if (!holdStartupAutoplay) return;
    const players =
      provider.shadowRoot?.querySelectorAll(
        "ha-hls-player,ha-web-rtc-player",
      ) || [];
    for (const player of players) {
      if (!heldPlayerAutoplay.has(player)) {
        heldPlayerAutoplay.set(player, player.autoPlay);
      }
      const playerVideo = player.shadowRoot?.querySelector("video") || player.video;
      if (playerVideo && !heldVideoAutoplay.has(playerVideo)) {
        heldVideoAutoplay.set(playerVideo, playerVideo.autoplay);
      }
      player.autoPlay = false;
      if (playerVideo) playerVideo.autoplay = false;
    }
  };
  const restoreNativeAutoplay = () => {
    holdStartupAutoplay = false;
    if (startupUnmuted) provider.autoPlay = providerAutoplay;
    for (const [player, autoplay] of heldPlayerAutoplay) {
      player.autoPlay = autoplay;
    }
    for (const [video, autoplay] of heldVideoAutoplay) {
      video.autoplay = autoplay;
    }
    heldPlayerAutoplay.clear();
    heldVideoAutoplay.clear();
  };
  provider.fvcReleaseStartupAutoplay = restoreNativeAutoplay;
  const applyOutputMute = () => {
    const activePlayer = findActiveHaCameraStreamPlayer(provider);
    for (const player of provider.shadowRoot?.querySelectorAll("ha-hls-player,ha-web-rtc-player") || []) {
      player.muted = player === activePlayer ? intendedOutputMuted : true;
    }
    const video = findActiveHaCameraStreamVideo(provider);
    if (video) video.muted = intendedOutputMuted;
    return video;
  };
  provider.fvcSetOutputMuted = (nextMuted) => {
    intendedOutputMuted = Boolean(nextMuted);
    return applyOutputMute();
  };
  // Install this before the provider is connected. HA creates its native child
  // asynchronously; the mutation microtask runs before its timer/autoplay task,
  // so the selected audio stream can still begin with muted output.
  if (provider.shadowRoot) {
    observer = new MutationObserver(() => {
      applyOutputMute();
      holdNativeAutoplay();
      void reconcile();
    });
    observer.observe(provider.shadowRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "hidden"],
    });
  }
  const webRtcRetry = createHaCameraWebRtcRetry({ provider });
  const requestHls = () => hass.callWS({ type: "camera/stream", entity_id: stateObj.entity_id, format: "hls" });
  const hlsRecovery = createHaCameraHlsRecovery(provider, {
    requestHls, resolveUrl: (url) => hass.hassUrl?.(url) || url,
  });
  const reconcile = async () => {
    if (scheduled || disposed) return;
    scheduled = true;
    await Promise.resolve();
    await provider.updateComplete;
    scheduled = false;
    if (disposed) return;
    configureStandardHaHlsPlayer(provider.shadowRoot?.querySelector("ha-hls-player"));
    applyOutputMute();
    const playerRoot = findActiveHaCameraStreamPlayer(provider)?.shadowRoot;
    if (provider.shadowRoot && (!observer || observedPlayerRoot !== playerRoot)) {
      observer ??= new MutationObserver(reconcile);
      observer.disconnect();
      observedPlayerRoot = playerRoot;
      observer.observe(provider.shadowRoot, {
        childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"],
      });
      if (playerRoot) observer.observe(playerRoot, { childList: true, subtree: true });
    }
    webRtcRetry.observe();
    hlsRecovery.observe();
    const video = findActiveHaCameraStreamVideo(provider);
    if (video === watchedVideo && video) return;
    stopFrameWatch();
    stopVideoEvents();
    restoreAutoplay();
    initialPlayback?.dispose();
    initialPlayback = null;
    watchedVideo = video;
    const selected = selection.find((item) => item.visible);
    if (selected?.type === "mjpeg" && !hlsPending) {
      onState({ status: "failed", streamType: "", video: null });
      return;
    }
    const loading = () => onState({ status: "loading", streamType: "", video: null });
    if (!video) { loading(); return; }
    const current = () => !disposed && video === watchedVideo && findActiveHaCameraStreamVideo(provider) === video;
    initialPlayback = createStartupPlayback?.(video, {
      isCurrent: current,
      replaceExisting: true,
      onUnmuted: () => {
        intendedOutputMuted = false;
        applyOutputMute();
      },
      onDispose: () => restoreAutoplay(),
      onMuted: () => {
        intendedOutputMuted = true;
        applyOutputMute();
      },
    });
    if (initialPlayback) {
      holdNativeAutoplay();
      let restored = false;
      restoreAutoplay = () => {
        if (restored) return;
        restored = true;
        restoreNativeAutoplay();
      };
      void initialPlayback.play();
    }
    let ready = false;
    let waitingTime = video.currentTime;
    const onReady = () => {
      if (!current()) return;
      ready = true;
      video.removeEventListener("timeupdate", onProgress);
      const tag = findActiveHaCameraStreamPlayer(provider)?.localName;
      onState({ status: "ready", streamType: tag === "ha-web-rtc-player" ? "webrtc" : "hls", video });
    };
    const onProgress = () => {
      // WebKit can resume media time after waiting without another playing
      // event. Observe recovery, without starting or replacing any transport.
      if (ready || !current() || video.paused || video.ended || video.error ||
          video.readyState < 2 || !video.videoWidth || video.currentTime <= waitingTime ||
          findActiveHaCameraStreamPlayer(provider)?._error) return;
      onReady();
    };
    const onWaiting = () => {
      if (!current()) return;
      stopFrameWatch();
      ready = false;
      waitingTime = video.currentTime;
      video.addEventListener("timeupdate", onProgress);
      loading();
    };
    const waitingEvents = ["waiting", "emptied", "error", "ended"];
    for (const event of waitingEvents) video.addEventListener(event, onWaiting);
    video.addEventListener("playing", onReady);
    stopVideoEvents = () => {
      for (const event of waitingEvents) video.removeEventListener(event, onWaiting);
      video.removeEventListener("playing", onReady);
      video.removeEventListener("timeupdate", onProgress);
    };
    stopFrameWatch = watchMediaFirstFrame({
      mediaRoot: provider,
      findVideo: findActiveHaCameraStreamVideo,
      isDestroyed: () => disposed || video !== watchedVideo,
      onReady,
    });
    // A ready HA-to-HA takeover is not a new connection/loading phase.
    if (!ready) onState({ status: "loading", streamType: "", video });
  };
  preserveHaCameraHlsFallback(provider, (streams, status) => {
    selection = streams;
    hlsPending = status.hlsPending;
    void reconcile();
  }, {
    requestHls,
    isDestroyed: () => disposed,
    webRtcRetry,
    hlsRecovery,
  });
  provider.addEventListener("streams", reconcile, true);
  provider.addEventListener("load", reconcile, true);
  return {
    provider,
    onSelected: () => webRtcRetry.retryIfEligible(),
    checkResume: (onResult) => checkHaCameraResume({ provider, onResult }),
    dispose: () => {
      disposed = true;
      webRtcRetry.dispose();
      hlsRecovery.dispose();
      stopFrameWatch();
      stopVideoEvents();
      restoreAutoplay();
      initialPlayback?.dispose();
      observer?.disconnect();
      provider.removeEventListener("streams", reconcile, true);
      provider.removeEventListener("load", reconcile, true);
    },
  };
}
