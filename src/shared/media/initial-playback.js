// Own the first play promise so denied audible autoplay can still start video.
export function createInitialPlayback(video, {
  getMuted = () => true,
  isCurrent = () => true,
  onMuted = () => {},
} = {}) {
  let disposed = false;
  let pending = false;
  let completed = false;
  let retries = 0;
  let readinessPending = false;
  const state = { started: false, blocked: false, requestedUnmuted: false };
  const play = async () => {
    if (disposed || !isCurrent() || completed || retries >= 3) return;
    if (pending) { readinessPending = true; return; }
    pending = true;
    readinessPending = false;
    retries += 1;
    video.muted = state.blocked || getMuted() !== false;
    video.defaultMuted = video.muted;
    state.requestedUnmuted ||= !video.muted;
    state.started = true;
    try {
      await video.play();
      completed = true;
    } catch (error) {
      if (disposed || !isCurrent()) return;
      if (error?.name === "NotAllowedError" && !video.muted) {
        state.blocked = true;
        video.muted = true;
        video.defaultMuted = true;
        onMuted();
        try {
          await video.play();
          completed = true;
        } catch (_) {}
      }
    } finally {
      pending = false;
      if (readinessPending && !completed) void play();
    }
  };
  for (const event of ["loadedmetadata", "loadeddata", "canplay"]) {
    video.addEventListener?.(event, play);
  }
  return {
    state,
    play,
    dispose() {
      disposed = true;
      for (const event of ["loadedmetadata", "loadeddata", "canplay"]) {
        video.removeEventListener?.(event, play);
      }
    },
  };
}
