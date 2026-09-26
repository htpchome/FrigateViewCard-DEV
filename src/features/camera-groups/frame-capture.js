import {
  resolveDisplayedFrameDimensions,
  resolveDisplayedFrameGeometry,
} from "../../shared/media/frame-geometry.js";

export async function captureCameraGroupDisplayedFrame(
  controller,
  {
    documentObj = globalThis.document,
    styleResolver = (element) => globalThis.getComputedStyle?.(element),
    mimeType = "image/jpeg",
    quality = 0.92,
  } = {},
) {
  if (!controller?.isActive?.()) return null;
  const host = controller._host;
  const wrap = host._$("#eng-wrap");
  const wrapRect = wrap?.getBoundingClientRect?.();
  const wrapWidth = Number(wrapRect?.width) || 0;
  const wrapHeight = Number(wrapRect?.height) || 0;
  if (!wrapWidth || !wrapHeight) {
    throw new Error("The grouped live view is not ready.");
  }

  const paneSpecs = [
    {
      member: "A",
      engine: host._$("#engine"),
      zoom: host._liveVideoZoomController,
    },
    {
      member: "B",
      engine: host._$("#camera-group-secondary-engine"),
      zoom: controller._secondaryZoom,
    },
  ]
    .filter(
      ({ member }) =>
        !controller._focusedMember || member === controller._focusedMember,
    )
    .map(({ member, engine, zoom }) => {
      const pane = host._$(
        `.camera-group-live-pane[data-camera-group-member="${member}"]`,
      );
      const paneRect = pane?.getBoundingClientRect?.();
      const video = host._findVideoDeep?.(engine) || engine?.video || null;
      const source = resolveDisplayedFrameDimensions(video);
      const viewportWidth = Number(paneRect?.width) || 0;
      const viewportHeight = Number(paneRect?.height) || 0;
      const computedStyle = video ? styleResolver?.(video) : null;
      const zoomState = zoom?.video === video ? zoom.state : null;
      const geometry = resolveDisplayedFrameGeometry({
        sourceWidth: source.width,
        sourceHeight: source.height,
        viewportWidth,
        viewportHeight,
        objectFit:
          computedStyle?.objectFit || video?.style?.objectFit || "contain",
        zoomState,
      });
      if (!video || !paneRect || !geometry) {
        throw new Error("The displayed grouped camera frame is not ready.");
      }
      return { video, paneRect, geometry };
    });

  const sourceScale = paneSpecs.reduce((largest, spec) => {
    const { sourceRect, destinationRect } = spec.geometry;
    const scale = Math.max(
      sourceRect.width / Math.max(1, destinationRect.width),
      sourceRect.height / Math.max(1, destinationRect.height),
    );
    return Math.max(largest, scale);
  }, 1);
  const dimensionLimit = Math.min(4096 / wrapWidth, 4096 / wrapHeight);
  const outputScale = Math.max(
    0.01,
    Math.min(4, sourceScale, dimensionLimit),
  );
  const canvas = documentObj?.createElement?.("canvas");
  const context = canvas?.getContext?.("2d");
  if (!canvas || !context) {
    throw new Error("Snapshot capture is not supported in this browser.");
  }
  canvas.width = Math.max(1, Math.round(wrapWidth * outputScale));
  canvas.height = Math.max(1, Math.round(wrapHeight * outputScale));
  context.fillStyle = styleResolver?.(wrap)?.backgroundColor || "#111111";
  context.fillRect?.(0, 0, canvas.width, canvas.height);

  for (const { video, paneRect, geometry } of paneSpecs) {
    const { sourceRect, destinationRect } = geometry;
    const destinationX = paneRect.left - wrapRect.left + destinationRect.x;
    const destinationY = paneRect.top - wrapRect.top + destinationRect.y;
    context.drawImage(
      video,
      sourceRect.x,
      sourceRect.y,
      sourceRect.width,
      sourceRect.height,
      destinationX * outputScale,
      destinationY * outputScale,
      destinationRect.width * outputScale,
      destinationRect.height * outputScale,
    );
  }

  return await new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== "function") {
      reject(new Error("Snapshot encoding is not supported in this browser."));
      return;
    }
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The grouped frame could not be encoded."));
      },
      mimeType,
      quality,
    );
  });
}
