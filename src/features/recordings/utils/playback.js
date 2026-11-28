export function shouldPreferRecordingHls() {
  return true;
}

export function resolveRecordingPlaybackAlignment({
  recordings = [],
  start = 0,
  end = 0,
  maxLeadSeconds = 10 * 60,
} = {}) {
  const requestedStart = Number(start);
  const requestedEnd = Number(end);
  const maxLead = Math.max(0, Number(maxLeadSeconds) || 0);
  if (
    !Number.isFinite(requestedStart) ||
    !Number.isFinite(requestedEnd) ||
    requestedEnd <= requestedStart
  ) {
    return null;
  }

  const containing = recordings
    .map((recording) => ({
      start: Number(recording?.start_time),
      end: Number(recording?.end_time),
    }))
    .filter(
      (recording) =>
        Number.isFinite(recording.start) &&
        Number.isFinite(recording.end) &&
        recording.start <= requestedStart &&
        recording.end > requestedStart,
    )
    .sort((left, right) => right.start - left.start)[0];
  if (!containing) return null;

  const startPosition = requestedStart - containing.start;
  if (!(startPosition > 0) || startPosition > maxLead) return null;

  return {
    transportStart: containing.start,
    startPosition,
    playbackDuration: requestedEnd - requestedStart,
  };
}

export function buildRecordingPlaybackPlan({
  clientId = "",
  camera = "",
  start = 0,
  end = 0,
  preferHls = false,
  maxChunkSeconds = 3600,
}) {
  const safeStart = Number(start) || 0;
  const safeEnd = Number(end) || 0;
  const chunkEnd = Math.min(safeEnd, safeStart + maxChunkSeconds);
  const recPath = `/api/frigate/${encodeURIComponent(clientId)}/recording/${encodeURIComponent(camera)}/start/${safeStart}/end/${chunkEnd}`;
  const vodBase = `/api/frigate/${encodeURIComponent(clientId)}/vod/${encodeURIComponent(camera)}/start/${safeStart}/end/${chunkEnd}`;
  const hlsCandidates = [`${vodBase}/index.m3u8`, `${vodBase}/master.m3u8`];

  return {
    chunkEnd,
    clipDurationSec: chunkEnd - safeStart,
    displayCamera: String(camera || "").replace(/_/g, " "),
    sourceCandidates: preferHls
      ? [...hlsCandidates, recPath]
      : [recPath, ...hlsCandidates],
  };
}
