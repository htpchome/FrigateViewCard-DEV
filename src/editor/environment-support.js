const normalizeVersionParts = (value) => {
  const normalized = String(value || "")
    .trim()
    .replace(/^v/i, "");
  if (!normalized) return null;
  const numericCore = normalized.match(/^\d+(?:\.\d+)*/)?.[0] || "";
  if (!numericCore) return null;
  return numericCore.split(".").map((part) => Number(part));
};

export const compareVersions = (left, right) => {
  const leftParts = normalizeVersionParts(left);
  const rightParts = normalizeVersionParts(right);
  if (!leftParts || !rightParts) return null;
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] || 0;
    const rightPart = rightParts[index] || 0;
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  return 0;
};

export const resolveHomeAssistantVersionNotice = ({
  currentVersion = "",
  recommendedVersion = "",
} = {}) => {
  if (compareVersions(currentVersion, recommendedVersion) !== -1) return "";
  return `Home Assistant ${currentVersion} is below the recommended ${recommendedVersion}.`;
};

export const resolveFrigateIntegrationVersionNotice = ({
  installed = null,
  currentVersion = "",
  recommendedVersion = "",
} = {}) => {
  if (installed === false) {
    return "Frigate integration is not installed in Home Assistant.";
  }
  if (
    installed !== true ||
    compareVersions(currentVersion, recommendedVersion) !== -1
  ) {
    return "";
  }
  return `Frigate integration ${currentVersion} is below the recommended ${recommendedVersion}.`;
};

export const isFrigateIntegrationLoaded = (hass) => {
  const components = hass?.config?.components;
  if (Array.isArray(components)) return components.includes("frigate");
  if (components instanceof Set) return components.has("frigate");
  return null;
};

export const fetchFrigateIntegrationVersion = async (hass) => {
  if (typeof hass?.callWS !== "function") {
    throw new Error("Home Assistant WebSocket API is unavailable");
  }
  const manifest = await hass.callWS({
    type: "config/integration/get_manifest",
    integration: "frigate",
  });
  const version = String(manifest?.version || "").trim();
  if (!version) throw new Error("Frigate integration version is unavailable");
  return version;
};
