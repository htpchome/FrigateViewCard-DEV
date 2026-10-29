// Own the first play promise so denied audible autoplay can still start video.
export function createInitialPlayback(video, {
  getMuted = () => true,
  isCurrent = () => true,
  onMuted = () => {},
  onDispose = () => {},
  waitForData = false,
  reapplyOnLoadedData = false,
} = {}) {
  let disposed = false;
  let pending = false;
  let completed = false;
  let retries = 0;
  let readinessPending = false;
  let loadedReapplyPending = false;
  const state = {
    started: false,
    completed: false,
    blocked: false,
    requestedUnmuted: false,
    loadedReapplied: false,
  };
  const play = async ({ loadedReapply = false } = {}) => {
    if (disposed || !isCurrent()) return;
    if (loadedReapply && state.loadedReapplied) return;
    if (!loadedReapply && (completed || retries >= 3)) return;
    // MediaStream/HLS can load while paused. Do not turn source attachment
    // into an audible-play request before the selected media is usable.
    if (waitForData && video.readyState < 2) return;
    if (pending) {
      readinessPending = true;
      loadedReapplyPending ||= loadedReapply;
      return;
    }
    if (loadedReapply) {
      state.loadedReapplied = true;
      state.blocked = false;
      state.completed = false;
      completed = false;
      retries = 0;
    }
    pending = true;
    readinessPending = false;
    retries += 1;
    video.muted = state.blocked || getMuted() !== false;
    state.requestedUnmuted ||= !video.muted;
    state.started = true;
    try {
      await video.play();
      completed = true;
      state.completed = true;
    } catch (error) {
      if (disposed || !isCurrent()) return;
      if (error?.name === "NotAllowedError" && !video.muted) {
        state.blocked = true;
        video.muted = true;
        onMuted();
        try {
          await video.play();
          completed = true;
          state.completed = true;
        } catch (_) {}
      }
    } finally {
      pending = false;
      if (loadedReapplyPending) {
        loadedReapplyPending = false;
        readinessPending = false;
        void play({ loadedReapply: true });
        return;
      }
      if (readinessPending && !completed) void play();
    }
  };
  const onReadiness = () => void play();
  const onLoadedData = () => void play({ loadedReapply: reapplyOnLoadedData });
  video.addEventListener?.("loadedmetadata", onReadiness);
  video.addEventListener?.("loadeddata", onLoadedData);
  video.addEventListener?.("canplay", onReadiness);
  return {
    state,
    play,
    dispose() {
      if (disposed) return;
      disposed = true;
      video.removeEventListener?.("loadedmetadata", onReadiness);
      video.removeEventListener?.("loadeddata", onLoadedData);
      video.removeEventListener?.("canplay", onReadiness);
      onDispose();
    },
  };
}
