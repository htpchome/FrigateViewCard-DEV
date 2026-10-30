export const toAbsoluteSignedUrl = ({ signedPath, origin }) =>
  signedPath.startsWith("http") ? signedPath : `${origin}${signedPath}`;

export const toWebSocketUrl = (httpUrl) => httpUrl.replace(/^http/i, "ws");

export const isM3u8Url = (url = "") =>
  String(url || "")
    .toLowerCase()
    .includes(".m3u8");

export const getFreshCachedValue = ({ cacheMap, cacheKey, nowMs }) => {
  const entry = cacheMap.get(cacheKey);
  if (entry && entry.exp > nowMs) return entry.url ?? null;
  return undefined;
};

export const setCachedValue = ({ cacheMap, cacheKey, url, ttlMs, nowMs }) => {
  cacheMap.set(cacheKey, {
    url,
    exp: nowMs + ttlMs,
  });
};

export const buildPopupMediaUrl = ({ baseUrl = "", cacheKey }) => {
  const normalizedBaseUrl = String(baseUrl || "");
  if (!normalizedBaseUrl) return "";
  if (cacheKey === null || cacheKey === undefined || cacheKey === "") {
    return normalizedBaseUrl;
  }
  const separator = normalizedBaseUrl.includes("?") ? "&" : "?";
  return `${normalizedBaseUrl}${separator}fvc=${encodeURIComponent(String(cacheKey))}`;
};
