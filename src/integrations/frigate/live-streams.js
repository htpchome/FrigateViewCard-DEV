const normalizeText = (value) => String(value ?? "").trim();

export const normalizeFrigateGo2RtcStream = (value) => {
  const stream = normalizeText(value);
  if (!stream || /[\u0000-\u001f\u007f]/.test(stream)) return "";
  return stream.slice(0, 512);
};

const resolveCameraConfig = (config, cameraName) => {
  const cameras = config?.cameras || config?.config?.cameras;
  if (!cameras || typeof cameras !== "object" || Array.isArray(cameras)) {
    return null;
  }
  return cameras[normalizeText(cameraName)] || null;
};

export const resolveFrigateLiveStreamOptions = (config, cameraName) => {
  const normalizedCameraName = normalizeText(cameraName);
  const streams = resolveCameraConfig(config, normalizedCameraName)?.live
    ?.streams;
  if (!streams || typeof streams !== "object" || Array.isArray(streams)) {
    return [];
  }

  const entries = Object.entries(streams)
    .map(([label, value]) => ({
      label: normalizeText(label),
      value: normalizeFrigateGo2RtcStream(value),
    }))
    .filter(({ value }) => !!value);
  const explicitMainIndex = entries.findIndex(
    ({ value }) => value === normalizedCameraName,
  );
  const labeledMainIndex = entries.findIndex(
    ({ label }) => label.toLowerCase() === "main stream",
  );
  const mainIndex =
    explicitMainIndex >= 0
      ? explicitMainIndex
      : labeledMainIndex >= 0
        ? labeledMainIndex
        : entries.length
          ? 0
          : -1;
  const seen = new Set();

  return entries
    .filter((_, index) => index !== mainIndex)
    .filter(({ value }) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .map(({ label, value }) => ({ label: label || value, value }));
};

export const fetchFrigateLiveStreamOptions = async ({
  hass,
  instanceId,
  cameraName,
  fetchImpl = globalThis.fetch,
  origin = globalThis.location?.origin || "",
}) => {
  if (!hass?.callWS || typeof fetchImpl !== "function") {
    throw new Error("Frigate configuration access is unavailable");
  }
  const targetInstance = normalizeText(instanceId);
  const targetCamera = normalizeText(cameraName);
  if (!targetInstance || !targetCamera) return [];

  const path = `/api/frigate/${encodeURIComponent(targetInstance)}/api/config`;
  const signed = await hass.callWS({
    type: "auth/sign_path",
    path,
    expires: 3600,
  });
  const response = await fetchImpl(
    `${origin}${signed?.path || path}`,
    {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    },
  );
  if (!response?.ok) {
    throw new Error(`Frigate configuration request failed (${response?.status || "unknown"})`);
  }
  return resolveFrigateLiveStreamOptions(await response.json(), targetCamera);
};

export const resolveConfiguredFrigateGo2RtcStream = ({
  config,
  entity,
}) => {
  const targetEntity = normalizeText(entity);
  if (!targetEntity || !Array.isArray(config?.cameras)) return "";
  const camera = config.cameras.find(
    (candidate) => normalizeText(candidate?.entity) === targetEntity,
  );
  return normalizeFrigateGo2RtcStream(camera?.frigate_go2rtc_stream);
};
