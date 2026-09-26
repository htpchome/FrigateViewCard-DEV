export const resolveWideTimelineCameraContextKey = ({
  gridMixed = false,
  cameraEntity = "",
  cameraMembers = [],
} = {}) => {
  if (gridMixed) return "wide-grid-mixed";
  const members = [
    ...new Set(
      (Array.isArray(cameraMembers) ? cameraMembers : [])
        .map((entity) => String(entity || "").trim())
        .filter(Boolean),
    ),
  ];
  if (members.length > 1) return `wide-group-mixed:${members.join("|")}`;
  return String(cameraEntity || members[0] || "").trim();
};
