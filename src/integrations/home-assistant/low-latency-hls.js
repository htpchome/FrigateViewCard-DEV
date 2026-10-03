import { RECORDING_HLS_JS_ASSET_NAME } from "../../release-artifacts.mjs";

const HLS_JS_INTEGRITY =
  "sha384-9v3HcdYrO3D+OPDTjZ40RXocgE4GtXVCd3/mCS62JsM93JXgI1afJVuwjFvsu6ni";

export const HA_LOW_LATENCY_HLS_CONFIG = Object.freeze({
  backBufferLength: 60,
  fragLoadingTimeOut: 30000,
  manifestLoadingTimeOut: 30000,
  levelLoadingTimeOut: 30000,
  maxLiveSyncPlaybackRate: 2,
  lowLatencyMode: true,
});

export const resolveHaLowLatencyHlsJsUrl = (moduleUrl = import.meta.url) =>
  new URL(`./${RECORDING_HLS_JS_ASSET_NAME}`, moduleUrl).href;

let hlsJsCtorPromise = null;

export async function ensureHaLowLatencyHlsPlayback({
  resolveHlsJsUrl = resolveHaLowLatencyHlsJsUrl,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
} = {}) {
  if (windowRef?.Hls) return windowRef.Hls;
  if (hlsJsCtorPromise) return await hlsJsCtorPromise;

  hlsJsCtorPromise = new Promise((resolve) => {
    let scriptSrc = "";
    try {
      scriptSrc = resolveHlsJsUrl?.() || "";
    } catch (_) {
      resolve(null);
      return;
    }
    const script = documentRef?.createElement?.("script");
    const head = documentRef?.head;
    if (!scriptSrc || !script || !head?.appendChild) {
      resolve(null);
      return;
    }
    const finish = (ctor) => {
      script.onload = null;
      script.onerror = null;
      script.remove?.();
      resolve(ctor || null);
    };
    script.src = scriptSrc;
    script.async = true;
    script.integrity = HLS_JS_INTEGRITY;
    script.crossOrigin = "anonymous";
    script.referrerPolicy = "no-referrer";
    script.onload = () => finish(windowRef?.Hls);
    script.onerror = () => finish(null);
    head.appendChild(script);
  });

  const ctor = await hlsJsCtorPromise;
  if (!ctor) hlsJsCtorPromise = null;
  return ctor;
}

export function createHaLowLatencyHlsVideoElement({
  hass,
  entity,
  muted = false,
  controls = false,
  defaultMuted,
  fitMode,
  styleText = "",
  loadHlsCtor = ensureHaLowLatencyHlsPlayback,
} = {}) {
  const entityId = String(entity || "").trim();
  if (!hass?.callWS || !entityId) return null;

  const video = document.createElement("video");
  let destroyed = false;
  let hls = null;
  video.autoplay = true;
  video.playsInline = true;
  video.controls = controls;
  video.muted = muted;
  video.preload = "auto";
  video.catalystHlsPlaybackMode = "pending";
  if (defaultMuted !== undefined) video.defaultMuted = defaultMuted;
  if (styleText) video.style.cssText = styleText;
  if (fitMode !== undefined) video.style.objectFit = fitMode;

  video.hlsUrlReady = Promise.all([
    hass.callWS({
      type: "camera/stream",
      entity_id: entityId,
      format: "hls",
    }),
    loadHlsCtor(),
  ])
    .then(([response, HlsCtor]) => {
      const path = String(response?.url || "").trim();
      if (destroyed || !path) return false;
      const streamUrl = hass.hassUrl?.(path) || path;

      if (HlsCtor?.isSupported?.()) {
        hls = new HlsCtor({ ...HA_LOW_LATENCY_HLS_CONFIG });
        video.catalystHlsPlaybackMode = "ll-hls-js";
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        return true;
      }

      // Keep a native fallback for a Catalyst runtime without MSE. The HA URL
      // can still negotiate LL-HLS natively when WebKit supports it.
      video.catalystHlsPlaybackMode = "native-hls";
      video.src = streamUrl;
      return true;
    })
    .catch(() => false);

  video.destroy = () => {
    if (destroyed) return;
    destroyed = true;
    try {
      hls?.destroy?.();
    } catch (_) {}
    hls = null;
    try {
      video.pause?.();
      video.removeAttribute?.("src");
      video.load?.();
    } catch (_) {}
  };

  return video;
}
