export const isAbsoluteOrDataUrl = (url) =>
  /^https?:\/\//i.test(url) || String(url || "").startsWith("data:");

export const FALLBACK_SIGNED_URL_TTL_MS = 55 * 60 * 1000;

export const normalizeFallbackRequestHeight = (height) => {
  const value = Math.round(Number(height) || 0);
  return value > 0 ? value : 0;
};

export const buildFallbackCameraProxyPath = ({ entity, requestHeight = 0 }) => {
  const basePath = `/api/camera_proxy/${entity}`;
  const height = normalizeFallbackRequestHeight(requestHeight);
  return height > 0 ? `${basePath}?height=${height}` : basePath;
};

export const toAbsoluteLocalUrl = ({ url, origin }) => {
  if (!url) return "";
  return isAbsoluteOrDataUrl(url) ? url : `${origin}${url}`;
};

export const appendCacheBustParam = (
  url,
  cacheBustValue,
  key = "fvc_snapshot",
) => {
  const source = String(url || "");
  if (!source) return "";
  const token = String(cacheBustValue || Date.now());
  const hashIndex = source.indexOf("#");
  const base = hashIndex >= 0 ? source.slice(0, hashIndex) : source;
  const hash = hashIndex >= 0 ? source.slice(hashIndex) : "";
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}${encodeURIComponent(key)}=${encodeURIComponent(token)}${hash}`;
};

export const getCachedEntityUrl = ({
  cacheMap,
  entity,
  nowMs,
  requestHeight = 0,
}) => {
  const cached = cacheMap?.get?.(entity);
  if (
    cached &&
    cached.url &&
    cached.exp > nowMs &&
    normalizeFallbackRequestHeight(cached.requestHeight) ===
      normalizeFallbackRequestHeight(requestHeight)
  ) {
    return cached.url;
  }
  return "";
};

export const setCachedEntityUrl = ({
  cacheMap,
  entity,
  url,
  ttlMs,
  nowMs,
  requestHeight = 0,
}) => {
  if (!cacheMap || !entity || !url) return;
  cacheMap.set(entity, {
    url,
    exp: nowMs + ttlMs,
    requestHeight: normalizeFallbackRequestHeight(requestHeight),
  });
};

export const resolveSignedFallbackUrl = async ({
  entity,
  canCallWs,
  signedPathResolver,
  cacheMap,
  nowMs,
  origin,
  requestHeight = 0,
  ttlMs = FALLBACK_SIGNED_URL_TTL_MS,
}) => {
  if (!entity) return "";
  if (!canCallWs) return "";

  const cached = getCachedEntityUrl({
    cacheMap,
    entity,
    nowMs,
    requestHeight,
  });
  if (cached) return cached;

  const basePath = buildFallbackCameraProxyPath({
    entity,
    requestHeight,
  });
  const signedPath = await signedPathResolver(basePath);
  const abs = toAbsoluteLocalUrl({
    url: signedPath,
    origin,
  });

  setCachedEntityUrl({
    cacheMap,
    entity,
    url: abs,
    ttlMs,
    nowMs,
    requestHeight,
  });

  return abs;
};

export const resolveEntityPictureFallbackUrl = ({
  entity,
  stateMap,
  origin,
}) => {
  if (!entity) return "";
  const state = stateMap?.[entity];
  const pic = state?.attributes?.entity_picture || "";
  if (!pic) return "";
  return toAbsoluteLocalUrl({
    url: pic,
    origin,
  });
};

export const createFallbackSourceResolvers = ({
  canCallWs,
  signedPathResolver,
  cacheMap,
  stateMap,
  origin,
  ttlMs = FALLBACK_SIGNED_URL_TTL_MS,
  nowMsProvider = () => Date.now(),
}) => ({
  loadPrimary: async (entity, { requestHeight = 0 } = {}) =>
    await resolveSignedFallbackUrl({
      entity,
      canCallWs,
      signedPathResolver,
      cacheMap,
      nowMs: nowMsProvider(),
      origin,
      requestHeight,
      ttlMs,
    }),
  loadAlt: (entity) =>
    resolveEntityPictureFallbackUrl({
      entity,
      stateMap,
      origin,
    }),
});

export const resolveFallbackOrigin = ({ origin, defaultOrigin }) =>
  origin || defaultOrigin || "";

export const resolveFallbackOriginForCard = ({ card, origin }) =>
  resolveFallbackOrigin({
    origin,
    defaultOrigin: card?._fallbackOrigin,
  });

export const createFallbackSourceResolversForCard = ({ card, origin }) => {
  const resolvedOrigin = resolveFallbackOriginForCard({ card, origin });
  if (!card) {
    return {
      loadPrimary: async () => "",
      loadAlt: () => "",
    };
  }

  return createFallbackSourceResolvers({
    canCallWs: !!card._hass?.callWS,
    signedPathResolver: async (path) => await card._signed(path),
    cacheMap: card._fallbackImgUrlCache,
    stateMap: card._hass?.states,
    origin: resolvedOrigin,
  });
};

export const resolveFallbackSourceResolversForCard =
  createFallbackSourceResolversForCard;

export const withFallbackSourceResolversForCard = ({ card, origin, run }) =>
  run(
    resolveFallbackSourceResolversForCard({
      card,
      origin,
    }),
  );

export const loadFallbackPrimaryForCard = async ({
  card,
  entity,
  origin,
  requestHeight = 0,
}) => {
  return withFallbackSourceResolversForCard({
    card,
    origin,
    run: async (resolvers) =>
      resolvers.loadPrimary(entity, { requestHeight }),
  });
};

export const loadFallbackAltForCard = ({ card, entity, origin }) => {
  return withFallbackSourceResolversForCard({
    card,
    origin,
    run: (resolvers) => resolvers.loadAlt(entity),
  });
};
