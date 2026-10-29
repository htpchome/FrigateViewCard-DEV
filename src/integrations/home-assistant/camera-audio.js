import {
  findActiveHaCameraStreamPlayer,
  findActiveHaCameraStreamVideo,
} from "./playback.js";

export const getHaCameraAudioPeer = (provider) =>
  provider?.haDirectProvider === true
    ? findActiveHaCameraStreamPlayer(provider)?._peerConnection : null;

// HA omits incoming audio from its playback stream when startup is muted.
// Restore only tracks already received by this owned player's existing peer.
export function synchronizeHaCameraAudio(provider, muted) {
  if (provider?.haDirectProvider !== true) return null;
  const player = findActiveHaCameraStreamPlayer(provider);
  const video = findActiveHaCameraStreamVideo(provider);
  // HA uses its public `muted` input both as an output setting and as a stream
  // selector. Once audio is requested, keep the audio-capable stream selected
  // and control only the visible player's output mute. This mirrors ACC's
  // intended-stream/output-mute split and avoids rebuilding an audio-less
  // stream when the user mutes it again.
  provider.fvcHaAudioStreamPreferred ||= !muted;
  provider.muted = provider.fvcHaAudioStreamPreferred ? false : muted;
  const outputVideo = provider.fvcSetOutputMuted?.(muted) || video;
  // Propagate synchronously so a user gesture is not lost waiting for HA render.
  if (player) player.muted = muted;
  if (outputVideo) {
    outputVideo.muted = muted;
    if (!muted && typeof outputVideo.volume === "number") {
      outputVideo.volume = 1;
    }
  }
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
  return outputVideo;
}
