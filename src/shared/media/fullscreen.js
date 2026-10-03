export function findFullscreenVideo(element) {
  if (!element) return null;
  if (element.tagName?.toLowerCase() === "video") return element;

  const direct = element.querySelector?.("video");
  if (direct) return direct;

  const hosts = element.querySelectorAll?.(
    "ha-camera-stream,ha-hls-player,webrtc-camera",
  );
  if (hosts?.length) {
    for (const host of hosts) {
      const video =
        host.shadowRoot?.querySelector?.("video") ||
        host.querySelector?.("video");
      if (video) return video;
    }
  }

  return element.shadowRoot?.querySelector?.("video") || null;
}

export function findVideoDeep(root, maxDepth = 7) {
  if (!root || maxDepth < 0) return null;
  if (root.tagName?.toLowerCase?.() === "video") return root;

  const direct = root.querySelector?.("video");
  if (direct) return direct;

  if (root.shadowRoot) {
    const shadowVideo = findVideoDeep(root.shadowRoot, maxDepth - 1);
    if (shadowVideo) return shadowVideo;
  }

  const children = root.children ? Array.from(root.children) : [];
  for (const child of children) {
    const video = findVideoDeep(child, maxDepth - 1);
    if (video) return video;
  }

  return null;
}

const isIosFullscreenPlatform = (navigatorObj) =>
  /iPad|iPhone|iPod/.test(String(navigatorObj?.userAgent || "")) ||
  (navigatorObj?.platform === "MacIntel" &&
    Number(navigatorObj?.maxTouchPoints) > 1);

const createNativeVideoMuteGuard = (
  video,
  {
    onMutedStateChange = () => {},
    setTimer = globalThis.setTimeout?.bind(globalThis),
    clearTimer = globalThis.clearTimeout?.bind(globalThis),
    entryGuardMs = 1000,
  } = {},
) => {
  const initialMuted = video?.muted === true;
  const initialDefaultMuted = video?.defaultMuted === true;
  const initialVolume = Number.isFinite(Number(video?.volume))
    ? Number(video.volume)
    : 1;
  let applying = false;
  let active = true;
  let enteredFullscreen = false;
  let entrySettled = false;
  let entryTimer = null;

  const apply = () => {
    if (!active || !video) return;
    applying = true;
    try {
      video.defaultMuted = initialMuted;
      video.muted = initialMuted;
      if (initialMuted && typeof video.volume === "number") video.volume = 0;
      if (!initialMuted && typeof video.volume === "number") {
        video.volume = initialVolume;
      }
    } catch (_) {}
    applying = false;
  };
  const removeListeners = () => {
    video?.removeEventListener?.("volumechange", onVolumeChange);
    video?.removeEventListener?.("webkitbeginfullscreen", onBeginFullscreen);
    video?.removeEventListener?.("webkitendfullscreen", onEndFullscreen);
    video?.removeEventListener?.(
      "webkitpresentationmodechanged",
      onPresentationModeChange,
    );
  };
  const cleanup = () => {
    if (!active) return;
    active = false;
    if (entryTimer != null) clearTimer?.(entryTimer);
    entryTimer = null;
    removeListeners();
  };
  const cancel = () => {
    cleanup();
    try {
      video.defaultMuted = initialDefaultMuted;
      video.muted = initialMuted;
      if (typeof video.volume === "number") video.volume = initialVolume;
    } catch (_) {}
  };
  const finish = () => {
    const finalMuted = entrySettled ? video?.muted === true : initialMuted;
    const fullscreenVolume = Number(video?.volume);
    cleanup();
    try {
      video.defaultMuted = finalMuted;
      video.muted = finalMuted;
      if (typeof video.volume === "number") {
        video.volume =
          !finalMuted && Number.isFinite(fullscreenVolume) && fullscreenVolume > 0
            ? fullscreenVolume
            : initialVolume;
      }
    } catch (_) {}
    onMutedStateChange(finalMuted);
  };
  const onVolumeChange = () => {
    if (applying) return;
    if (!entrySettled) {
      if (
        video?.muted !== initialMuted ||
        (initialMuted && Number(video?.volume) !== 0)
      ) {
        apply();
      }
      return;
    }
    if (
      initialMuted &&
      video?.muted === false &&
      Number(video?.volume) === 0 &&
      typeof video.volume === "number"
    ) {
      applying = true;
      try {
        video.volume = initialVolume;
      } catch (_) {}
      applying = false;
    }
  };
  const completeEntryGuard = () => {
    if (!active || entrySettled) return;
    apply();
    entrySettled = true;
    entryTimer = null;
  };
  const settleEntry = () => {
    if (!active || enteredFullscreen) return;
    enteredFullscreen = true;
    apply();
    if (typeof setTimer === "function") {
      entryTimer = setTimer(completeEntryGuard, entryGuardMs);
    } else {
      completeEntryGuard();
    }
  };
  const onBeginFullscreen = () => settleEntry();
  const onEndFullscreen = () => finish();
  const onPresentationModeChange = () => {
    if (video?.webkitPresentationMode === "fullscreen") {
      settleEntry();
      return;
    }
    if (enteredFullscreen) finish();
  };

  video?.addEventListener?.("volumechange", onVolumeChange);
  video?.addEventListener?.("webkitbeginfullscreen", onBeginFullscreen);
  video?.addEventListener?.("webkitendfullscreen", onEndFullscreen);
  video?.addEventListener?.(
    "webkitpresentationmodechanged",
    onPresentationModeChange,
  );
  apply();
  return { cancel, settleEntry };
};

export function requestMediaFullscreen({
  element = null,
  video = null,
  preferElementFullscreen = false,
  preferNativeVideoFullscreen = false,
  preserveNativeVideoMutedState = false,
  onNativeVideoMutedStateChange = () => {},
  nativeVideoEntryGuardMs = 1000,
  setTimer = globalThis.setTimeout?.bind(globalThis),
  clearTimer = globalThis.clearTimeout?.bind(globalThis),
  navigatorObj = globalThis.navigator,
  onBeginNativeVideoFullscreen = () => {},
  onBeginDocumentFullscreen = () => {},
  onRequestFailure = null,
} = {}) {
  if (!element) return false;

  const elementRequest =
    element.requestFullscreen || element.webkitRequestFullscreen;
  const useElementFullscreen =
    preferElementFullscreen === true && typeof elementRequest === "function";
  const useNativeVideoFullscreen =
    preferNativeVideoFullscreen === true ||
    (isIosFullscreenPlatform(navigatorObj) && !useElementFullscreen);

  if (useNativeVideoFullscreen && video) {
    const enterVideoFullscreen =
      video.webkitEnterFullscreen || video.webkitEnterFullScreen;
    const setVideoPresentationMode = video.webkitSetPresentationMode;
    if (
      typeof enterVideoFullscreen === "function" ||
      typeof setVideoPresentationMode === "function"
    ) {
      const muteGuard = preserveNativeVideoMutedState
        ? createNativeVideoMuteGuard(video, {
            onMutedStateChange: onNativeVideoMutedStateChange,
            setTimer,
            clearTimer,
            entryGuardMs: nativeVideoEntryGuardMs,
          })
        : null;
      onBeginNativeVideoFullscreen(video);
      try {
        if (typeof enterVideoFullscreen === "function") {
          enterVideoFullscreen.call(video);
        } else {
          setVideoPresentationMode.call(video, "fullscreen");
        }
        muteGuard?.settleEntry();
        return true;
      } catch (_) {
        muteGuard?.cancel();
        onRequestFailure?.();
      }
    }
  }

  let requestTarget = element;
  let request = elementRequest;
  if (!request && video) {
    requestTarget = video;
    request = video.requestFullscreen || video.webkitRequestFullscreen;
  }
  if (typeof request !== "function") return false;

  onBeginDocumentFullscreen(video);
  try {
    const result = request.call(requestTarget);
    if (typeof onRequestFailure === "function") {
      result?.catch?.(() => onRequestFailure());
    }
    return true;
  } catch (_) {
    onRequestFailure?.();
    return false;
  }
}

export function exitDocumentFullscreen(documentObj = globalThis.document) {
  const exit =
    documentObj?.exitFullscreen ||
    documentObj?.webkitExitFullscreen ||
    documentObj?.webkitCancelFullScreen;
  if (typeof exit !== "function") return false;
  try {
    const result = exit.call(documentObj);
    result?.catch?.(() => {});
    return true;
  } catch (_) {
    return false;
  }
}
