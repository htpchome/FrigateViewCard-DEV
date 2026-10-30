import {
  buildGo2RtcTransportState,
  resolveGo2RtcEntity,
} from "./camera-context.js";
import {
  buildGo2rtcWsPath,
  makeGo2rtcCacheKey,
} from "./url.js";
import {
  buildSignedGo2RtcWebSocketUrl,
} from "./bootstrap.js";
import {
  getFreshCachedValue,
  setCachedValue,
} from "../../shared/media/url-utils.js";

export const GO2RTC_CACHE_TTL_MS = Object.freeze({
  wsSignedPath: 55 * 60 * 1000,
});

export function createGo2RtcResolver({
  getHass,
  getConfig,
  getActiveEntity,
  getCamCache,
  defaultConnectionType,
  normalizeCameraConnectionType,
  createCameraState,
  discoverEntity,
  getOrigin = () => window.location.origin,
  getNowMs = () => Date.now(),
}) {
  const wsUrlCache = new Map();
  const wsUrlInFlight = new Map();

  const resolveEntity = (entity = "") => {
    return resolveGo2RtcEntity({
      entity,
      activeEntity: getActiveEntity(),
      config: getConfig(),
      defaultConnectionType,
      normalizeCameraConnectionType,
    });
  };

  const resolveMountRequest = (options = {}) => {
    return {
      entity: resolveEntity(options?.entity),
      abortSignal: options?.abortSignal || null,
      commit: options.commit !== false,
    };
  };

  const resolveTransportStateForEntity = async (
    entity,
    { useConfiguredStream = true } = {},
  ) => {
    const targetEntity = resolveEntity(entity);
    if (!targetEntity) return null;
    await discoverEntity(targetEntity);
    const state = buildGo2RtcTransportState({
      entity,
      activeEntity: getActiveEntity(),
      config: getConfig(),
      defaultConnectionType,
      normalizeCameraConnectionType,
      camCache: getCamCache(),
      createCameraState,
      makeGo2rtcCacheKey,
      nowMs: getNowMs(),
    });
    if (!state || useConfiguredStream) return state;
    return {
      ...state,
      cam: state.cameraName,
      cacheKey: makeGo2rtcCacheKey({
        clientId: state.clientId,
        cam: state.cameraName,
      }),
    };
  };

  const websocketUrlForEntity = async (entity, options = {}) => {
    const state = await resolveTransportStateForEntity(entity, options);
    if (!state) return null;

    const { clientId, cam, cacheKey, nowMs } = state;
    const cachedUrl = getFreshCachedValue({
      cacheMap: wsUrlCache,
      cacheKey,
      nowMs,
    });
    if (cachedUrl) return cachedUrl;

    const inFlight = wsUrlInFlight.get(cacheKey);
    if (inFlight) return inFlight;

    const wsUrlPromise = (async () => {
      const path = buildGo2rtcWsPath({ clientId, cam });
      const wsUrl = await buildSignedGo2RtcWebSocketUrl({
        hass: getHass(),
        path,
        origin: getOrigin(),
      });
      setCachedValue({
        cacheMap: wsUrlCache,
        cacheKey,
        url: wsUrl,
        ttlMs: GO2RTC_CACHE_TTL_MS.wsSignedPath,
        nowMs,
      });
      return wsUrl;
    })().finally(() => {
      wsUrlInFlight.delete(cacheKey);
    });

    wsUrlInFlight.set(cacheKey, wsUrlPromise);
    return wsUrlPromise;
  };

  return {
    resolveMountRequest,
    websocketUrlForEntity,
  };
}
