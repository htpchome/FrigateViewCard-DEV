export const composedParent = (element) => {
  if (!element) return null;
  if (element.parentNode) return element.parentNode;
  const root = element.getRootNode?.();
  return root && root !== element ? root.host || null : element.host || null;
};

export const findHomeAssistantLovelaceRoot = (host) => {
  let current = host;
  for (let depth = 0; current && depth < 40; depth += 1) {
    if (String(current.tagName || "").toUpperCase() === "HUI-ROOT") {
      return current;
    }
    current = composedParent(current);
  }
  return null;
};

export const findCurrentHomeAssistantLovelaceRoot = (
  documentRef = globalThis.document,
) => {
  const homeAssistant = documentRef?.querySelector?.("home-assistant");
  const mainRoot = homeAssistant?.shadowRoot?.querySelector?.(
    "home-assistant-main",
  )?.shadowRoot;
  const resolver = mainRoot?.querySelector?.("partial-panel-resolver");
  const lovelacePanel =
    resolver?.querySelector?.("ha-panel-lovelace") ||
    resolver?.shadowRoot?.querySelector?.("ha-panel-lovelace") ||
    mainRoot?.querySelector?.("ha-panel-lovelace");
  return lovelacePanel?.shadowRoot?.querySelector?.("hui-root") || null;
};

export const findHomeAssistantLovelacePanel = (
  huiRoot,
  documentRef = globalThis.document,
) => {
  let current = huiRoot;
  for (let depth = 0; current && depth < 12; depth += 1) {
    if (String(current.tagName || "").toUpperCase() === "HA-PANEL-LOVELACE") {
      return current;
    }
    current = composedParent(current);
  }

  const homeAssistant = documentRef?.querySelector?.("home-assistant");
  const mainRoot = homeAssistant?.shadowRoot?.querySelector?.(
    "home-assistant-main",
  )?.shadowRoot;
  const resolver = mainRoot?.querySelector?.("partial-panel-resolver");
  return (
    resolver?.querySelector?.("ha-panel-lovelace") ||
    resolver?.shadowRoot?.querySelector?.("ha-panel-lovelace") ||
    mainRoot?.querySelector?.("ha-panel-lovelace") ||
    null
  );
};

const normalizeDashboardPath = (value) => {
  const normalized = String(value || "")
    .trim()
    .replace(/\/+$/, "");
  return normalized || "";
};

export const resolveHomeAssistantDashboardKey = (
  huiRoot,
  windowRef = globalThis.window,
) => {
  const routePrefix = normalizeDashboardPath(
    huiRoot?.route?.prefix || huiRoot?._route?.prefix,
  );
  if (routePrefix) return `route:${routePrefix}`;

  const firstPathSegment = String(windowRef?.location?.pathname || "")
    .split("/")
    .filter(Boolean)[0];
  if (firstPathSegment) return `path:/${firstPathSegment}`;

  return huiRoot || null;
};
