import {
  createHaCameraStreamElement,
  findActiveHaCameraStreamPlayer,
  findActiveHaCameraStreamVideo,
} from "./playback.js";
import { preserveHaCameraHlsFallback } from "./camera-stream-compat.js";
import { createHaCameraWebRtcRetry } from "./camera-webrtc-retry.js";
import { createHaCameraHlsRecovery } from "./camera-hls-recovery.js";
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
export function createHaDirectCameraProvider({ hass, stateObj, onState }) {
  const provider = createHaCameraStreamElement({
    stateObj, muted: true, defaultMuted: true, controls: false, fitMode: "contain",
    styleText: "display:block;width:100%;height:100%",
  });
  let selection = [];
  let hlsPending = false;
  let disposed = false;
  let scheduled = false;
  let watchedVideo = null;
  let stopFrameWatch = () => {};
  let stopVideoEvents = () => {};
  let observer = null;
  let observedPlayerRoot;
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
    watchedVideo = video;
    const selected = selection.find((item) => item.visible);
    if (selected?.type === "mjpeg" && !hlsPending) {
      onState({ status: "failed", streamType: "", video: null });
      return;
    }
    const loading = () => onState({ status: "loading", streamType: "", video: null });
    if (!video) { loading(); return; }
    const current = () => !disposed && video === watchedVideo && findActiveHaCameraStreamVideo(provider) === video;
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
    if (!ready) loading();
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
    dispose: () => {
      disposed = true;
      webRtcRetry.dispose();
      hlsRecovery.dispose();
      stopFrameWatch();
      stopVideoEvents();
      observer?.disconnect();
      provider.removeEventListener("streams", reconcile, true);
      provider.removeEventListener("load", reconcile, true);
    },
  };
}
