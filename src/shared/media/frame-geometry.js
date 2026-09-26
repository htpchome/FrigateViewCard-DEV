const positiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export function resolveDisplayedFrameDimensions(media) {
  return {
    width: positiveNumber(media?.videoWidth || media?.naturalWidth),
    height: positiveNumber(media?.videoHeight || media?.naturalHeight),
  };
}

export function resolveDisplayedFrameGeometry({
  sourceWidth,
  sourceHeight,
  viewportWidth,
  viewportHeight,
  objectFit = "contain",
  zoomState = null,
} = {}) {
  const width = positiveNumber(sourceWidth);
  const height = positiveNumber(sourceHeight);
  if (!width || !height) return null;

  const viewportW = positiveNumber(viewportWidth);
  const viewportH = positiveNumber(viewportHeight);
  if (!viewportW || !viewportH) {
    return {
      sourceRect: { x: 0, y: 0, width, height },
      destinationRect: { x: 0, y: 0, width, height },
    };
  }

  const fit = String(objectFit || "contain").toLowerCase();
  const fitScale =
    fit === "cover"
      ? Math.max(viewportW / width, viewportH / height)
      : Math.min(viewportW / width, viewportH / height);
  const fittedWidth = width * fitScale;
  const fittedHeight = height * fitScale;
  const scale = Math.max(1, Number(zoomState?.scale) || 1);
  const panX = Number(zoomState?.x) || 0;
  const panY = Number(zoomState?.y) || 0;
  const rawObjectPositionX = Number(zoomState?.objectPositionX ?? 0.5);
  const rawObjectPositionY = Number(zoomState?.objectPositionY ?? 0.5);
  const objectPositionX = Number.isFinite(rawObjectPositionX)
    ? Math.min(1, Math.max(0, rawObjectPositionX))
    : 0.5;
  const objectPositionY = Number.isFinite(rawObjectPositionY)
    ? Math.min(1, Math.max(0, rawObjectPositionY))
    : 0.5;
  const renderedLeft =
    panX + (viewportW - fittedWidth) * objectPositionX * scale;
  const renderedTop =
    panY + (viewportH - fittedHeight) * objectPositionY * scale;
  const renderedWidth = fittedWidth * scale;
  const renderedHeight = fittedHeight * scale;
  const visibleLeft = Math.max(0, renderedLeft);
  const visibleTop = Math.max(0, renderedTop);
  const visibleRight = Math.min(viewportW, renderedLeft + renderedWidth);
  const visibleBottom = Math.min(viewportH, renderedTop + renderedHeight);
  if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) return null;

  return {
    sourceRect: {
      x: ((visibleLeft - renderedLeft) / renderedWidth) * width,
      y: ((visibleTop - renderedTop) / renderedHeight) * height,
      width: ((visibleRight - visibleLeft) / renderedWidth) * width,
      height: ((visibleBottom - visibleTop) / renderedHeight) * height,
    },
    destinationRect: {
      x: visibleLeft,
      y: visibleTop,
      width: visibleRight - visibleLeft,
      height: visibleBottom - visibleTop,
    },
  };
}

export function resolveDisplayedFrameSourceRect(options = {}) {
  return resolveDisplayedFrameGeometry(options)?.sourceRect || null;
}
