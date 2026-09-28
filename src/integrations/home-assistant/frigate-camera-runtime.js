const normalizeState = (state) =>
  String(state?.state || "")
    .trim()
    .toLowerCase();

const normalizeSupportedFeatures = (state) => {
  const value = Number(state?.attributes?.supported_features);
  return Number.isFinite(value) ? value : null;
};

export const isFrigateCameraEntityState = (state) => {
  const attributes = state?.attributes || {};
  return Boolean(
    (attributes.client_id || attributes.mqtt_client_id) &&
      attributes.camera_name,
  );
};

export const resolveFrigateCameraRuntimeState = ({
  entity = "",
  state = null,
} = {}) => {
  const normalizedEntity = String(entity || "").trim();
  const rawState = normalizeState(state);
  const supportedFeatures = normalizeSupportedFeatures(state);
  const frigate = isFrigateCameraEntityState(state);
  const unavailable =
    !state || rawState === "unavailable" || rawState === "unknown";
  const suspended =
    frigate &&
    !unavailable &&
    rawState === "idle" &&
    supportedFeatures === 0;

  return {
    entity: normalizedEntity,
    rawState,
    supportedFeatures,
    frigate,
    controllable: Boolean(normalizedEntity && frigate && !unavailable),
    suspended,
    unavailable,
  };
};

export const setFrigateCameraRuntimeSuspended = async ({
  hass,
  entity = "",
  suspended,
} = {}) => {
  const normalizedEntity = String(entity || "").trim();
  if (!normalizedEntity || typeof hass?.callService !== "function") {
    throw new Error("Home Assistant camera service is unavailable.");
  }
  await hass.callService(
    "camera",
    suspended === true ? "turn_off" : "turn_on",
    {},
    { entity_id: normalizedEntity },
  );
};
