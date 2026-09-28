export function mergeRecordingSegments(recordings = []) {
  if (!recordings.length) return [];

  const grouped = new Map();
  for (const recording of recordings) {
    const key = String(recording?._fvc_camera_entity || "");
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(recording);
  }
  return [...grouped.values()]
    .flatMap((segments) => mergeRecordingGroup(segments))
    .sort((a, b) => a.start_time - b.start_time);
}

export const RECORDING_SEGMENT_EXTENSION_SECONDS = 5 * 60;

export const RECORDING_AVAILABILITY_JOIN_TOLERANCE_SECONDS = 1;

const CURRENT_RECORDING_TOLERANCE_SECONDS = 90;

const normalizeProvidedAvailableRanges = (availableRanges = []) => {
  const starts = availableRanges
    .map((range) => Number(range?.start_time ?? range?.start))
    .filter(Number.isFinite);
  const ends = availableRanges
    .map((range) => Number(range?.end_time ?? range?.end))
    .filter(Number.isFinite);
  if (!starts.length || !ends.length) return [];
  return resolveRecordingAvailableRanges({
    recordings: availableRanges,
    start: Math.min(...starts),
    end: Math.max(...ends),
  });
};

export function resolveRecordingAvailableRanges({
  recordings = [],
  start = 0,
  end = 0,
  joinToleranceSec = RECORDING_AVAILABILITY_JOIN_TOLERANCE_SECONDS,
} = {}) {
  const rangeStart = Math.max(0, Number(start) || 0);
  const rangeEnd = Math.max(rangeStart, Number(end) || rangeStart);
  const tolerance = Math.max(0, Number(joinToleranceSec) || 0);
  const ranges = recordings
    .map((recording) => {
      const recordingStart = Number(
        recording?.start_time ?? recording?.start,
      );
      const recordingEnd = Number(recording?.end_time ?? recording?.end);
      if (
        !Number.isFinite(recordingStart) ||
        !Number.isFinite(recordingEnd) ||
        recordingEnd <= recordingStart
      ) {
        return null;
      }
      const clippedStart = Math.max(rangeStart, recordingStart);
      const clippedEnd = Math.min(rangeEnd, recordingEnd);
      return clippedEnd > clippedStart
        ? { start: clippedStart, end: clippedEnd }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + tolerance) {
      previous.end = Math.max(previous.end, range.end);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

export function resolveRecordingUnavailableRanges({
  availableRanges = [],
  start = 0,
  end = 0,
} = {}) {
  const rangeStart = Math.max(0, Number(start) || 0);
  const rangeEnd = Math.max(rangeStart, Number(end) || rangeStart);
  if (rangeEnd <= rangeStart) return [];
  const available = resolveRecordingAvailableRanges({
    recordings: availableRanges,
    start: rangeStart,
    end: rangeEnd,
  });
  const unavailable = [];
  let cursor = rangeStart;
  for (const range of available) {
    if (range.start > cursor) {
      unavailable.push({ start: cursor, end: range.start });
    }
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < rangeEnd) {
    unavailable.push({ start: cursor, end: rangeEnd });
  }
  return unavailable;
}

export function resolveClosestRecordingAvailableTime({
  time = 0,
  availableRanges = [],
  preference = "nearest",
} = {}) {
  const target = Number(time) || 0;
  if (!availableRanges.length) return target;
  const available = normalizeProvidedAvailableRanges(availableRanges);
  if (!available.length) return target;
  for (const range of available) {
    if (target >= range.start && target <= range.end) return target;
  }
  if (target < available[0].start) return available[0].start;
  if (target > available.at(-1).end) return available.at(-1).end;

  for (let index = 1; index < available.length; index += 1) {
    const previous = available[index - 1];
    const next = available[index];
    if (target < previous.end || target > next.start) continue;
    if (preference === "previous") return previous.end;
    if (preference === "next") return next.start;
    return target - previous.end <= next.start - target
      ? previous.end
      : next.start;
  }
  return target;
}

export function recordingAvailableDuration(availableRanges = []) {
  return normalizeProvidedAvailableRanges(availableRanges).reduce(
    (total, range) =>
      total + Math.max(0, Number(range?.end) - Number(range?.start)),
    0,
  );
}

export function resolveRecordingMediaTime({
  time = 0,
  availableRanges = [],
} = {}) {
  if (!availableRanges.length) return Number(time) || 0;
  const available = normalizeProvidedAvailableRanges(availableRanges);
  const target = resolveClosestRecordingAvailableTime({
    time,
    availableRanges: available,
  });
  let offset = 0;
  for (const range of available) {
    const start = Number(range?.start) || 0;
    const end = Math.max(start, Number(range?.end) || start);
    if (target <= end) return offset + Math.max(0, target - start);
    offset += end - start;
  }
  return offset;
}

export function resolveRecordingTimelineTime({
  mediaTime = 0,
  availableRanges = [],
} = {}) {
  if (!availableRanges.length) return Number(mediaTime) || 0;
  const available = normalizeProvidedAvailableRanges(availableRanges);
  let remaining = Math.max(0, Number(mediaTime) || 0);
  for (const range of available) {
    const start = Number(range?.start) || 0;
    const end = Math.max(start, Number(range?.end) || start);
    const duration = end - start;
    if (remaining < duration) return start + remaining;
    remaining -= duration;
  }
  return Number(available.at(-1)?.end) || 0;
}

export function resolveRecordingSegmentTimelineRange({
  recordings = [],
  start = 0,
  end = 0,
  extensionSec = RECORDING_SEGMENT_EXTENSION_SECONDS,
  nowSec = Date.now() / 1000,
} = {}) {
  const recordingStart = Math.max(0, Math.floor(Number(start) || 0));
  const recordingEnd = Math.max(
    recordingStart,
    Math.floor(Number(end) || recordingStart),
  );
  const extension = Math.max(0, Math.floor(Number(extensionSec) || 0));
  const now = Math.max(recordingEnd, Math.floor(Number(nowSec) || 0));
  const isCurrentRecording =
    recordingEnd >= now - CURRENT_RECORDING_TOLERANCE_SECONDS;
  const requestedStart = Math.max(0, recordingStart - extension);
  const requestedEnd = isCurrentRecording
    ? recordingEnd
    : Math.min(now, recordingEnd + extension);
  const available = mergeRecordingSegments(recordings).filter((recording) => {
    const availableStart = Number(recording?.start_time);
    const availableEnd = Number(recording?.end_time);
    return (
      Number.isFinite(availableStart) &&
      Number.isFinite(availableEnd) &&
      availableEnd >= availableStart
    );
  });

  const preceding = available.filter(
    (recording) =>
      Number(recording.start_time) <= recordingStart &&
      Number(recording.end_time) >= recordingStart,
  );
  const following = available.filter(
    (recording) =>
      Number(recording.start_time) <= recordingEnd &&
      Number(recording.end_time) >= recordingEnd,
  );

  const availableStart = preceding.length
    ? Math.min(...preceding.map((recording) => Number(recording.start_time)))
    : recordingStart;
  const availableEnd = following.length
    ? Math.max(...following.map((recording) => Number(recording.end_time)))
    : recordingEnd;

  const timelineStart = Math.max(
    requestedStart,
    Math.min(recordingStart, availableStart),
  );
  const timelineEnd = isCurrentRecording
      ? recordingEnd
      : Math.min(requestedEnd, Math.max(recordingEnd, availableEnd));
  const availableRanges = resolveRecordingAvailableRanges({
    recordings,
    start: timelineStart,
    end: timelineEnd,
  });

  return {
    start: timelineStart,
    end: timelineEnd,
    availableRanges: availableRanges.length
      ? availableRanges
      : [{ start: recordingStart, end: recordingEnd }],
  };
}

function mergeRecordingGroup(recordings = []) {
  const segments = [...recordings].sort((a, b) => a.start_time - b.start_time);
  const merged = [];
  let current = { ...segments[0] };

  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    const currentEnd = current.end_time || current.start_time;

    if (segment.start_time - currentEnd <= 60) {
      current.end_time = Math.max(
        currentEnd,
        segment.end_time || segment.start_time,
      );
      current.events = (current.events || 0) + (segment.events || 0);
      continue;
    }

    merged.push(current);
    current = { ...segment };
  }

  merged.push(current);
  return merged;
}

export function splitRecordingsHourly(
  recordings = [],
  nowSec = Date.now() / 1000,
) {
  const merged = mergeRecordingSegments(recordings).sort(
    (a, b) => a.start_time - b.start_time,
  );
  if (!merged.length) return [];

  const grouped = new Map();
  for (const recording of merged) {
    const key = String(recording?._fvc_camera_entity || "");
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(recording);
  }
  return [...grouped.values()]
    .flatMap((group) => splitRecordingGroupHourly(group, nowSec))
    .sort((a, b) => a.start_time - b.start_time);
}

function splitRecordingGroupHourly(merged, nowSec) {
  const metadata = merged[0] || {};

  const now = Math.floor(nowSec || Date.now() / 1000);
  const currentHourStart = Math.floor(now / 3600) * 3600;
  const firstHourStart = currentHourStart - 23 * 3600;
  const buckets = [];

  for (let i = 0; i < 24; i++) {
    const bucketStart = firstHourStart + i * 3600;
    const bucketEnd = bucketStart + 3600;
    const rowEnd = Math.min(bucketEnd, now);

    let overlapsRecording = false;
    let events = 0;
    for (const recording of merged) {
      const recordingStart = Math.floor(recording.start_time);
      const recordingEnd = Math.floor(recording.end_time || now);
      if (recordingStart < bucketEnd && recordingEnd > bucketStart) {
        overlapsRecording = true;
        events += recording.events || 0;
      }
    }

    if (overlapsRecording && rowEnd > bucketStart) {
      buckets.push({
        start_time: bucketStart,
        end_time: rowEnd,
        events,
        ...(metadata._fvc_camera_entity
          ? {
              _fvc_camera_entity: metadata._fvc_camera_entity,
              _fvc_group_member: metadata._fvc_group_member || "",
            }
          : {}),
      });
    }
  }

  return buckets;
}
