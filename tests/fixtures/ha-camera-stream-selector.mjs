// Extracted from Home Assistant frontend 20260826.7, Apache-2.0.
// https://github.com/home-assistant/frontend/blob/20260826.7/src/components/ha-camera-stream.ts
// The memoization wrapper and TypeScript annotations are omitted; branch
// order and return values match the upstream non-demo selector exactly.
export function upstreamHaCameraStreamSelector(
  supportedTypes,
  hlsStreams,
  webRtcStreams,
  muted,
) {
  if (!supportedTypes) return [];
  if (supportedTypes.length === 0) return [{ type: "mjpeg", visible: true }];
  if (supportedTypes.length === 1) {
    if (
      (supportedTypes[0] === "hls" && hlsStreams?.hasVideo === false) ||
      (supportedTypes[0] === "web_rtc" && webRtcStreams?.hasVideo === false)
    ) {
      return [{ type: "mjpeg", visible: true }];
    }
    return [{ type: supportedTypes[0], visible: true }];
  }
  if (hlsStreams && webRtcStreams) {
    if (
      hlsStreams.hasVideo && hlsStreams.hasAudio &&
      !webRtcStreams.hasAudio && !muted
    ) {
      return [{ type: "hls", visible: true }];
    }
    if (webRtcStreams.hasVideo) return [{ type: "web_rtc", visible: true }];
    return [{ type: "mjpeg", visible: true }];
  }
  if (hlsStreams?.hasVideo !== webRtcStreams?.hasVideo) {
    if (hlsStreams?.hasVideo) {
      return [{ type: "hls", visible: true }, { type: "web_rtc", visible: false }];
    }
    if (hlsStreams?.hasVideo === false) return [{ type: "web_rtc", visible: true }];
    if (webRtcStreams?.hasVideo) {
      return [{ type: "web_rtc", visible: true }, { type: "hls", visible: false }];
    }
    if (webRtcStreams?.hasVideo === false) return [{ type: "hls", visible: true }];
  }
  return [{ type: "hls", visible: true }, { type: "web_rtc", visible: false }];
}
