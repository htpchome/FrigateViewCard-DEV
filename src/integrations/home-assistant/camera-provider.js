import {
  createHaCameraStreamElement,
  findActiveHaCameraStreamPlayer,
  findActiveHaCameraStreamVideo,
} from "./playback.js";
import { preserveHaCameraHlsFallback } from "./camera-stream-compat.js";
import { watchMediaFirstFrame } from "../../shared/media/first-frame.js";

export function findHaCameraContextHost(element) {
  let node = element;
  while (node) {
    if (node.localName === "home-assistant" && node.shadowRoot) return node;
    node = node.parentNode || node.host;
  }
  return null;
}

export function getHaCameraPresentationIdentity(element, config) {
  let node = element;
  while (node && node.localName !== "hui-card") node = node.parentNode || node.host;
  return { config: node?.config || config, signature: JSON.stringify(config) };
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
  let observer = null;
  const reconcile = async () => {
    if (scheduled || disposed) return;
    scheduled = true;
    await Promise.resolve();
    await provider.updateComplete;
    scheduled = false;
    if (disposed) return;
    if (!observer && provider.shadowRoot) {
      observer = new MutationObserver(reconcile);
      observer.observe(provider.shadowRoot, {
        childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"],
      });
    }
    const video = findActiveHaCameraStreamVideo(provider);
    if (video === watchedVideo && video) return;
    stopFrameWatch();
    watchedVideo = video;
    const selected = selection.find((item) => item.visible);
    if (selected?.type === "mjpeg" && !hlsPending) {
      onState({ status: "failed", streamType: "", video: null });
      return;
    }
    onState({ status: "loading", streamType: "", video: null });
    if (!video) return;
    stopFrameWatch = watchMediaFirstFrame({
      mediaRoot: provider,
      findVideo: findActiveHaCameraStreamVideo,
      isDestroyed: () => disposed || video !== watchedVideo,
      onReady: () => {
        if (disposed || video !== watchedVideo) return;
        const tag = findActiveHaCameraStreamPlayer(provider)?.localName;
        onState({ status: "ready", streamType: tag === "ha-web-rtc-player" ? "webrtc" : "hls", video });
      },
    });
  };
  preserveHaCameraHlsFallback(provider, (streams, status) => {
    selection = streams;
    hlsPending = status.hlsPending;
    void reconcile();
  }, {
    requestHls: () => hass.callWS({ type: "camera/stream", entity_id: stateObj.entity_id, format: "hls" }),
    isDestroyed: () => disposed,
  });
  provider.addEventListener("streams", reconcile, true);
  provider.addEventListener("load", reconcile, true);
  return {
    provider,
    dispose: () => {
      disposed = true;
      stopFrameWatch();
      observer?.disconnect();
      provider.removeEventListener("streams", reconcile, true);
      provider.removeEventListener("load", reconcile, true);
    },
  };
}
