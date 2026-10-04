// Instance-local HA capability/selection corrections. HA still owns both players.
export function preserveHaCameraHlsFallback(provider, onSelection = () => {}, {
  requestHls,
  isDestroyed = () => false,
  webRtcRetry,
} = {}) {
  const selectStreams = provider?._streams;
  if (typeof selectStreams !== "function") {
    throw new Error("Unsupported Home Assistant camera-stream selector");
  }
  const verifiedTypes = ["hls", "web_rtc"];
  let hlsRequested = false;
  let hlsPending = false;
  let hlsVerified = false;
  const verifyHls = async () => {
    hlsRequested = true;
    hlsPending = true;
    try {
      const result = await requestHls();
      hlsVerified = typeof result?.url === "string" && result.url.trim().length > 0;
    } catch (_) {
      // A camera without an HA stream source keeps its native WebRTC-only path.
    }
    hlsPending = false;
    if (!isDestroyed()) provider.requestUpdate();
  };
  provider._streams = function (...args) {
    const [supportedTypes, hlsStreams, webRtcStreams] = args;
    const webRtcOnly = supportedTypes?.length === 1 && supportedTypes[0] === "web_rtc";
    // Native WebRTC integrations can also supply camera/stream, despite omitting
    // HLS from capabilities. Verify now; failed ICE need not emit a failure event.
    if (webRtcOnly && requestHls && !hlsRequested && !isDestroyed()) void verifyHls();
    const effectiveWebRtcStreams = webRtcRetry
      ? webRtcRetry.adjustWebRtcStreams(hlsStreams, webRtcStreams) : webRtcStreams;
    const effectiveTypes = webRtcOnly && hlsVerified && !effectiveWebRtcStreams?.hasVideo
      ? verifiedTypes : supportedTypes;
    let streams = selectStreams.call(this, effectiveTypes, hlsStreams, effectiveWebRtcStreams, ...args.slice(3));
    if (
      effectiveTypes?.includes("hls") &&
      effectiveTypes?.includes("web_rtc") &&
      hlsStreams?.hasVideo === true &&
      effectiveWebRtcStreams?.hasVideo === false &&
      streams?.length === 1 &&
      streams[0]?.type === "mjpeg"
    ) {
      streams = [{ type: "hls", visible: true }];
    }
    if (webRtcRetry) streams = webRtcRetry.filterSelection(streams);
    onSelection(streams, { hlsPending });
    return streams;
  };
  return provider;
}
