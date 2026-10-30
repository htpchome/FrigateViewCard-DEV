import { hideFallbackStatus, showFallbackStatus } from "./fallback-status.js";

export const resolveFallbackDisplaySource = ({ primarySrc, altSrc }) =>
  primarySrc || altSrc || "";

export const resolveFallbackObjectFit = () => "contain";

export const applyFallbackImageHandlers = ({
  img,
  statusEl,
  altSrc,
  entity,
  t,
}) => {
  if (!img) return;
  hideFallbackStatus(statusEl);

  img.onerror = () => {
    if (altSrc && img.src !== altSrc) {
      img.src = altSrc;
      return;
    }
    showFallbackStatus(statusEl);
  };

  img.onload = () => {
    hideFallbackStatus(statusEl);
    const host = img.parentElement;
    img.style.objectFit = resolveFallbackObjectFit({
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      containerWidth: host?.clientWidth,
      containerHeight: host?.clientHeight,
    });
  };

  const altKey = entity
    ? "runtime.live.entitySnapshot"
    : "runtime.live.cameraSnapshot";
  const values = entity ? { entity } : {};
  img.setAttribute?.("data-fvc-i18n-alt", altKey);
  if (entity) {
    img.setAttribute?.("data-fvc-i18n-values", JSON.stringify(values));
  } else {
    img.removeAttribute?.("data-fvc-i18n-values");
  }
  img.alt = t?.(altKey, values) ||
    (entity ? `${entity} snapshot` : "Camera snapshot");
};

export const setFallbackImageSourceIfChanged = ({ img, src }) => {
  if (!img || !src) return;
  if (img.src !== src) img.src = src;
};
