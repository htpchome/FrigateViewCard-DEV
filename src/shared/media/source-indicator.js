export const resolveLiveSourceIndicatorState = (streamType) => {
  const source = String(streamType || "")
    .trim()
    .toLowerCase();
  const visible = ["webrtc", "mse", "hls"].includes(source);
  if (!visible) {
    return { visible: false, label: "", showIcon: false, text: "" };
  }
  const label = source === "webrtc" ? "WebRTC" : source.toUpperCase();
  return {
    visible: true,
    label,
    showIcon: source === "webrtc",
    text: source === "webrtc" ? "" : label,
  };
};
