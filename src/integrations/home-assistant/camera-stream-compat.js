// HA frontend 20260826.7 (also reproduced on 20260930.0) selects MJPEG
// after muted WebRTC fails even when its HLS child has working video.
// This instance-local correction does not create or manage either transport.
export function preserveHaCameraHlsFallback(provider, onSelection = () => {}) {
  const selectStreams = provider?._streams;
  if (typeof selectStreams !== "function") {
    throw new Error("Unsupported Home Assistant camera-stream selector");
  }
  provider._streams = function (...args) {
    const [supportedTypes, hlsStreams, webRtcStreams] = args;
    let streams = selectStreams.apply(this, args);
    if (
      supportedTypes?.includes("hls") &&
      supportedTypes?.includes("web_rtc") &&
      hlsStreams?.hasVideo === true &&
      webRtcStreams?.hasVideo === false &&
      streams?.length === 1 &&
      streams[0]?.type === "mjpeg"
    ) {
      streams = [{ type: "hls", visible: true }];
    }
    onSelection(streams);
    return streams;
  };
  return provider;
}
