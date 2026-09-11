const encodePathPart = (value) => encodeURIComponent(String(value || ""));
const HLS_CONTENT_TYPE = "application/vnd.apple.mpegurl";

const buildRecordingHlsPath = ({
  encodedClientId,
  camera,
  start,
  end,
}) =>
  `/api/frigate/${encodedClientId}/vod/${encodePathPart(camera)}/start/${start}/end/${end}/index.m3u8`;

export function buildFrigateReceiverMediaPath({
  mediaType = "",
  clientId = "",
  camera = "",
  eventId = "",
  recordingStart = null,
  recordingEnd = null,
  eventRecordingStart = null,
  eventRecordingEnd = null,
} = {}) {
  const normalizedType = String(mediaType || "").toLowerCase();
  const encodedClientId = encodePathPart(clientId);
  if (!encodedClientId) {
    return {
      ok: false,
      message: "The Frigate client is not available for this video.",
    };
  }

  if (normalizedType === "recording") {
    const start = Number(recordingStart);
    const end = Number(recordingEnd);
    if (!camera || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return {
        ok: false,
        message: "The recording range is not ready to send.",
      };
    }
    return {
      ok: true,
      path: buildRecordingHlsPath({
        encodedClientId,
        camera,
        start,
        end,
      }),
      contentType: HLS_CONTENT_TYPE,
    };
  }

  if (!["alert", "clip", "kept"].includes(normalizedType) || !eventId) {
    return {
      ok: false,
      message: "Only clips, alerts, favorite clips, and recordings can be sent.",
    };
  }

  const eventStart = Number(eventRecordingStart);
  const eventEnd = Number(eventRecordingEnd);
  if (
    camera &&
    Number.isFinite(eventStart) &&
    Number.isFinite(eventEnd) &&
    eventEnd > eventStart
  ) {
    return {
      ok: true,
      path: buildRecordingHlsPath({
        encodedClientId,
        camera,
        start: eventStart,
        end: eventEnd,
      }),
      contentType: HLS_CONTENT_TYPE,
    };
  }

  return {
    ok: true,
    path: `/api/frigate/${encodedClientId}/notifications/${encodePathPart(eventId)}/master.m3u8`,
    contentType: HLS_CONTENT_TYPE,
  };
}
