// Own the first play promise so denied audible autoplay can still start video.
export function createInitialPlayback(video, {
  getMuted = () => true,
  isCurrent = () => true,
  onMuted = () => {},
  onDispose = () => {},
  waitForData = false,
  reapplyOnLoadedData = false,
  deferUntilCommit = false,
  retryOnReadiness = true,
  settleAroundMute = false,
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
    // A selected live candidate can load while it is still in a hidden race
    // slot. Its visible owner performs the first play after adoption.
    if (deferUntilCommit) return;
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
    try {
      if (settleAroundMute) await Promise.resolve();
      if (disposed || !isCurrent()) return;
      video.muted = state.blocked || getMuted() !== false;
      state.requestedUnmuted ||= !video.muted;
      state.started = true;
      if (settleAroundMute) await Promise.resolve();
      if (disposed || !isCurrent()) return;
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
          if (settleAroundMute) await Promise.resolve();
          if (disposed || !isCurrent()) return;
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
  if (!deferUntilCommit) {
    if (retryOnReadiness) {
      video.addEventListener?.("loadedmetadata", onReadiness);
      video.addEventListener?.("canplay", onReadiness);
    }
    video.addEventListener?.("loadeddata", onLoadedData);
  }
  return {
    state,
    play,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (!deferUntilCommit) {
        if (retryOnReadiness) {
          video.removeEventListener?.("loadedmetadata", onReadiness);
          video.removeEventListener?.("canplay", onReadiness);
        }
        video.removeEventListener?.("loadeddata", onLoadedData);
      }
      onDispose();
    },
  };
}
