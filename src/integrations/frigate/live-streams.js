const normalizeText = (value) => String(value ?? "").trim();

export const normalizeFrigateGo2RtcStream = (value) => {
  const stream = normalizeText(value);
  if (!stream || /[\u0000-\u001f\u007f]/.test(stream)) return "";
  return stream.slice(0, 512);
};

export const resolveFrigateLiveStreamOptions = (streams, cameraName) => {
  const normalizedCameraName = normalizeText(cameraName);
  if (
    !normalizedCameraName ||
    !streams ||
    typeof streams !== "object" ||
    Array.isArray(streams)
  ) {
    return [];
  }
  const relatedPrefix = `${normalizedCameraName.toLowerCase()}_`;
  const audioStream = `${normalizedCameraName.toLowerCase()}_audio`;

  return Object.keys(streams)
    .map((value) => normalizeFrigateGo2RtcStream(value))
    .filter((value) => {
      const normalizedValue = value.toLowerCase();
      return (
        normalizedValue.startsWith(relatedPrefix) &&
        normalizedValue !== audioStream
      );
    })
    .map((value) => ({ label: value, value }))
    .sort((left, right) => left.value.localeCompare(right.value));
};

export const fetchFrigateLiveStreamOptions = async ({
  hass,
  instanceId,
  cameraName,
  fetchImpl = globalThis.fetch,
  origin = globalThis.location?.origin || "",
}) => {
  if (!hass?.callWS || typeof fetchImpl !== "function") {
    throw new Error("Frigate go2rtc stream discovery is unavailable");
  }
  const targetInstance = normalizeText(instanceId);
  const targetCamera = normalizeText(cameraName);
  if (!targetInstance || !targetCamera) return [];

  const path = `/api/frigate/${encodeURIComponent(targetInstance)}/go2rtc/api/streams`;
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
    throw new Error(`Frigate go2rtc stream request failed (${response?.status || "unknown"})`);
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
