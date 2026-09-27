export const ensureShadowStyle = (
  host,
  { attribute = "", cssText = "" } = {},
) => {
  const root = host?.shadowRoot;
  const marker = String(attribute || "").trim();
  if (!root || !marker) return null;

  const existing = root.querySelector?.(`style[${marker}]`) || null;
  if (existing) {
    if (existing.textContent !== cssText) existing.textContent = cssText;
    return existing;
  }

  const ownerDocument = root.ownerDocument || host?.ownerDocument;
  const style = ownerDocument?.createElement?.("style");
  if (!style || typeof root.append !== "function") return null;
  style.setAttribute(marker, "");
  style.textContent = cssText;
  root.append(style);
  return style;
};
