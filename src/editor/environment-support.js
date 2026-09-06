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

export const resolveHomeAssistantVersionStatus = ({
  currentVersion = "",
  recommendedVersion = "",
} = {}) => {
  const version = String(currentVersion || "").trim();
  if (!version) return { visible: false, status: "unavailable", label: "" };
  const warning = resolveHomeAssistantVersionNotice({
    currentVersion: version,
    recommendedVersion,
  });
  if (warning) return { visible: true, status: "warning", label: warning };
  return {
    visible: true,
    status: "current",
    label: `Home Assistant ${version}`,
  };
};

export const resolveFrigateIntegrationStatus = ({ installed = null } = {}) => {
  if (installed === true) {
    return {
      visible: true,
      status: "current",
      label: "Frigate integration is installed.",
    };
  }
  if (installed === false) {
    return {
      visible: true,
      status: "error",
      label: "Frigate integration is not installed in Home Assistant.",
    };
  }
  return { visible: false, status: "unavailable", label: "" };
};

export const isFrigateIntegrationLoaded = (hass) => {
  const components = hass?.config?.components;
  if (Array.isArray(components)) return components.includes("frigate");
  if (components instanceof Set) return components.has("frigate");
  return null;
};
