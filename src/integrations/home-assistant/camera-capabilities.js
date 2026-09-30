const normalizeStreamType = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_");

export const hasHaCameraWebRtcPlaybackCapability = (capabilities) => {
  const streamTypes = Array.isArray(capabilities?.frontend_stream_types)
    ? capabilities.frontend_stream_types
    : [capabilities?.frontend_stream_type];
  return streamTypes.some((value) => {
    const streamType = normalizeStreamType(value);
    return streamType === "web_rtc" || streamType === "webrtc";
  });
};
