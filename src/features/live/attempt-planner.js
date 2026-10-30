const DEFAULT_LIVE_ORDER = Object.freeze(["webrtc", "mse"]);

/**
 * Builds the ordered set of live mount attempts.
 * Keeps policy (ordering/filtering) separate from mount implementation details.
 */
export const buildLiveAttemptPlan = ({
  connectionType,
  forcedType = null,
  builders = {},
}) => {
  if (connectionType === "ha_direct") return [];

  const requestedType = String(forcedType || "").trim().toLowerCase();
  const order = requestedType && DEFAULT_LIVE_ORDER.includes(requestedType)
    ? [requestedType]
    : requestedType
      ? []
      : DEFAULT_LIVE_ORDER;
  return order
    .filter((type) => typeof builders[type] === "function")
    .map((type) => ({ type, start: builders[type] }));
};
