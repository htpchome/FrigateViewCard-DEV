import {
  findActiveHaCameraStreamPlayer,
  findActiveHaCameraStreamVideo,
} from "./playback.js";

// HA omits incoming audio from its playback stream when startup is muted.
// Restore only tracks already received by this owned player's existing peer.
export function synchronizeHaCameraAudio(provider, muted) {
  if (provider?.haDirectProvider !== true) return null;
  const player = findActiveHaCameraStreamPlayer(provider);
  const video = findActiveHaCameraStreamVideo(provider);
  provider.muted = muted;
  provider.defaultMuted = muted;
  // Propagate synchronously so a user gesture is not lost waiting for HA render.
  if (player) player.muted = muted;
  if (!muted && player?.tagName?.toLowerCase() === "ha-web-rtc-player") {
    const stream = video?.srcObject;
    const peer = player._peerConnection;
    if (
      stream && stream === player._remoteStream &&
      typeof stream.getAudioTracks === "function" &&
      typeof stream.addTrack === "function" &&
      typeof peer?.getReceivers === "function" &&
      peer.connectionState !== "closed"
    ) {
      for (const receiver of peer.getReceivers()) {
        const track = receiver.track;
        if (
          track?.kind === "audio" && track.readyState === "live" &&
          !stream.getAudioTracks().includes(track)
        ) {
          stream.addTrack(track);
        }
      }
    }
  }
  return video;
}
