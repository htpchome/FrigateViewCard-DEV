const OFFSCREEN_VIDEO_STYLE =
  "width:1px;height:1px;display:block;opacity:0;pointer-events:none;position:absolute;left:-9999px;top:-9999px;background:var(--c-bg-deep)";
const LIVE_DECK_VIDEO_STYLE =
  "position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;object-fit:contain;background:var(--c-bg-deep)";

export const normalizeGraceEntityKey = (entity) => String(entity || "").trim();

export const createGraceEngineEntry = ({ engine, onExpire, graceMs }) => {
  const entry = {
    engine,
    cancelled: false,
    timer: null,
  };

  entry.timer = setTimeout(() => {
    onExpire?.(entry);
  }, graceMs);

  return entry;
};

export const createGracePendingEntry = ({ onExpire, graceMs }) => {
  const entry = {
    engine: null,
    cancelled: false,
    timer: null,
    promise: null,
  };

  entry.timer = setTimeout(() => {
    onExpire?.(entry);
  }, graceMs);

  return entry;
};

export const prepareEngineVideoForGraceHost = (video) => {
  if (!video) return;
  video.muted = true;
  video.controls = false;
  video.style.cssText = OFFSCREEN_VIDEO_STYLE;
  void video.play?.().catch?.(() => {});
};

export const prepareEngineVideoForLiveDeck = (video) => {
  if (!video) return;
  video.autoplay = true;
  video.muted = true;
  video.controls = false;
  video.preload = "auto";
  video.style.cssText = LIVE_DECK_VIDEO_STYLE;
  void video.play?.().catch?.(() => {});
};

export const prepareEngineVideoForDormantHost = (video) => {
  if (!video) return;
  video.autoplay = false;
  video.muted = true;
  video.controls = false;
  video.preload = "metadata";
  video.style.cssText = OFFSCREEN_VIDEO_STYLE;
  try {
    if (video.paused !== true) video.pause?.();
  } catch (_) {}
};
