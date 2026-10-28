// Report the first usable audio capability that arrives after video readiness.
export function watchAudioAvailability(video, peer, onAvailable) {
  let disposed = false;
  let reported = false;
  const tracks = new Set();
  const cleanups = [];
  const listen = (target, type, handler) => {
    target?.addEventListener?.(type, handler);
    cleanups.push(() => target?.removeEventListener?.(type, handler));
  };
  const usable = (track) => track.kind === "audio" && track.readyState === "live" && track.muted !== true;
  const collect = () => {
    for (const track of [
      ...(video.srcObject?.getAudioTracks?.() || []),
      ...(peer?.getReceivers?.() || []).map((receiver) => receiver.track).filter(Boolean),
    ]) {
      if (track.kind !== "audio" || tracks.has(track)) continue;
      tracks.add(track);
      listen(track, "unmute", check);
    }
  };
  const hasAudio = () => [...tracks].some(usable) || (video.audioTracks?.length || 0) > 0;
  const check = () => {
    if (disposed || reported) return;
    collect();
    if (!hasAudio()) return;
    reported = true;
    onAvailable();
  };
  collect();
  // Audio already present is covered by the selected player's loaded attempt.
  reported = hasAudio();
  listen(peer, "track", check);
  listen(video.srcObject, "addtrack", check);
  listen(video.audioTracks, "addtrack", check);
  for (const event of ["loadedmetadata", "loadeddata", "canplay"]) listen(video, event, check);
  return () => {
    disposed = true;
    for (const cleanup of cleanups) cleanup();
  };
}
