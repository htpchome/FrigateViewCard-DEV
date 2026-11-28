import {
  toAbsoluteSignedUrl,
  toWebSocketUrl,
} from "../../shared/media/url-utils.js";

const FRIGATE_PROXY_PREFIX = "/api/frigate/";

export async function signHomeAssistantPath({ hass, path, expires = 3600 }) {
  try {
    const result = await hass.callWS({
      type: "auth/sign_path",
      path,
      expires,
    });
    return result?.path || path;
  } catch (_) {
    return path;
  }
}

export function resolveAbsoluteSignedPath({ signedPath, origin }) {
  return toAbsoluteSignedUrl({ signedPath, origin });
}

export function resolveUnsignedFrigatePath({ url, origin }) {
  try {
    const resolvedOrigin = new URL(origin);
    const resolvedUrl = new URL(url, resolvedOrigin);
    if (resolvedUrl.origin !== resolvedOrigin.origin) return "";
    if (!resolvedUrl.pathname.startsWith(FRIGATE_PROXY_PREFIX)) return "";
    resolvedUrl.searchParams.delete("authSig");
    return `${resolvedUrl.pathname}${resolvedUrl.search}`;
  } catch (_) {
    return "";
  }
}

export async function openSignedFrigateRequest({
  xhr,
  url,
  origin = globalThis.location?.origin || "http://localhost",
  signPath,
}) {
  const path = resolveUnsignedFrigatePath({ url, origin });
  if (!path || typeof signPath !== "function") return false;
  const signedPath = await signPath(path);
  xhr.open("GET", resolveAbsoluteSignedPath({ signedPath, origin }), true);
  return true;
}

export async function buildSignedGo2RtcWebSocketUrl({
  hass,
  path,
  origin,
  expires = 3600,
}) {
  const signedPath = await signHomeAssistantPath({ hass, path, expires });
  const abs = resolveAbsoluteSignedPath({ signedPath, origin });
  return toWebSocketUrl(abs);
}
