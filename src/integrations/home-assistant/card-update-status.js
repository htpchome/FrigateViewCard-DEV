const normalizeMatchText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const normalizeVersionLabel = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return normalized.toLowerCase().startsWith("v")
    ? normalized
    : `v${normalized}`;
};

export const findFrigateViewCardUpdateEntity = (states = {}) => {
  const entries = Object.entries(states || {});
  return (
    entries.find(([entityId, state]) => {
      if (!String(entityId).startsWith("update.")) return false;
      const attributes = state?.attributes || {};
      const identity = normalizeMatchText(
        [
          entityId,
          attributes.title,
          attributes.friendly_name,
          attributes.repository,
          attributes.release_url,
        ].join(" "),
      );
      return identity.includes("frigateviewcard");
    }) || null
  );
};

export const resolveFrigateViewCardUpdateStatus = ({
  states = {},
} = {}) => {
  const match = findFrigateViewCardUpdateEntity(states);
  if (!match) {
    return {
      entityId: "",
      status: "unavailable",
      label: "Update status unavailable",
    };
  }

  const [entityId, entityState] = match;
  const attributes = entityState?.attributes || {};
  const latestVersion = normalizeVersionLabel(attributes.latest_version);
  if (attributes.in_progress === true) {
    return {
      entityId,
      status: "updating",
      label: latestVersion
        ? `Updating to ${latestVersion}`
        : "Update in progress",
    };
  }

  const state = String(entityState?.state || "").toLowerCase();
  if (state === "on") {
    return {
      entityId,
      status: "available",
      label: latestVersion
        ? `Update available: ${latestVersion}`
        : "Update available",
    };
  }
  if (state === "off") {
    return {
      entityId,
      status: "current",
      label: "Up to date",
    };
  }

  return {
    entityId,
    status: "unavailable",
    label: "Update status unavailable",
  };
};
