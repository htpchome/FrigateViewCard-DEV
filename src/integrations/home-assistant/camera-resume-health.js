import { findActiveHaCameraStreamPlayer } from "./playback.js";

const VERIFY_RESUME_MS = 1500;
const SAMPLE_MS = 150;

// Read native state only. The session, not this observer, owns replacement.
export function checkHaCameraResume({ provider, onResult, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const player = findActiveHaCameraStreamPlayer(provider);
  const video = player?.shadowRoot?.querySelector("video");
  const rtc = player?.localName === "ha-web-rtc-player";
  const peer = rtc ? player._peerConnection : null;
  const released = () => !player?.isConnected || !video || video.error || video.ended ||
    (player._error && player._errorIsFatal === true) ||
    findActiveHaCameraStreamPlayer(provider) !== player ||
    (rtc && (!peer || player._peerConnection !== peer ||
      ["failed", "closed"].includes(peer.connectionState) ||
      ["failed", "closed"].includes(peer.iceConnectionState))) ||
    // currentSrc can still report the old URL immediately after HA clears src.
    (!rtc && !video.srcObject && !video.getAttribute("src")) ||
    (video.srcObject?.getVideoTracks?.() || []).some((track) => track.readyState === "ended");
  if (released()) {
    onResult(false);
    return () => {};
  }

  const frames = () => {
    const quality = video.getVideoPlaybackQuality?.();
    return quality ? quality.totalVideoFrames - (quality.droppedVideoFrames || 0) : undefined;
  };
  const initialFrames = frames();
  const initialTime = video.currentTime;
  let stopped = false;
  let deadline = null;
  let sample = null;
  let sampling = false;
  let received = !rtc;
  let initialBytes = null;
  const cleanup = () => {
    stopped = true;
    clearTimer(deadline);
    clearTimer(sample);
    video.removeEventListener("timeupdate", progress);
    video.removeEventListener("playing", progress);
  };
  const finish = (reusable) => {
    if (stopped) return;
    cleanup();
    onResult(reusable);
  };
  function progress() {
    if (stopped) return;
    if (released()) { finish(false); return; }
    // A final queued frame after suspension is not sustained playback.
    const advancing = video.currentTime > initialTime + 0.1 &&
      (!Number.isFinite(initialFrames) || frames() > initialFrames);
    if (received && advancing && !video.paused && !player._error) finish(true);
  }
  const readIncoming = async () => {
    if (stopped || sampling) return;
    sampling = true;
    try {
      if (rtc && typeof peer.getStats === "function") {
        const stats = await peer.getStats();
        if (stopped) return;
        const bytes = new Map();
        stats.forEach((report) => {
          if (report.type === "inbound-rtp" && (report.kind || report.mediaType) === "video" &&
              Number.isFinite(report.bytesReceived)) bytes.set(report.id, report.bytesReceived);
        });
        // Two foreground samples of the same receiver exclude cached stats.
        if (initialBytes?.size) received ||= [...bytes].some(([id, value]) =>
          initialBytes.has(id) && value > initialBytes.get(id));
        else initialBytes = bytes;
      }
      progress();
    } catch (_) {
      // Missing/rejected stats cannot prove a stale WebRTC connection healthy.
    } finally {
      sampling = false;
      if (!stopped) sample = setTimer(readIncoming, SAMPLE_MS);
    }
  };
  video.addEventListener("timeupdate", progress);
  video.addEventListener("playing", progress);
  deadline = setTimer(() => finish(false), VERIFY_RESUME_MS);
  void readIncoming();
  if (video.paused) {
    // Resume only; never pause or change the user's mute choice to test health.
    void (async () => {
      try { await video.play(); }
      catch (error) {
        // Reconnecting cannot grant autoplay permission.
        if (error?.name === "NotAllowedError") finish(true);
      }
    })();
  }
  return cleanup;
}
