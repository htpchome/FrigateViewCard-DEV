const INITIAL_RETRY_MS = 120000;
const REPEATED_RETRY_MS = 300000;
const PEER_DISCOVERY_MS = 250;

// HA owns negotiation and teardown. Observe its peer without patching it, and
// let the provider's selector retire failed children without replacing it.
export function createHaCameraWebRtcRetry({
  provider,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let disposed = false;
  let peer = null;
  let failedPeer = null;
  let player = null;
  let discoveryTimer = null;
  let hlsReady = false;
  let suppressed = false;
  let failures = 0;
  let retryAfter = 0;
  let lastWebRtcStreams;
  let ignoredWebRtcStreams;
  let hlsAvailable = false;
  let usablePlayer = null;
  let recoveringPlayer = null;
  let recoveryVideo = null;

  const stopRecoveryWatch = () => {
    for (const event of ["loadeddata", "playing", "timeupdate"]) {
      recoveryVideo?.removeEventListener(event, finishRecovery);
    }
    recoveryVideo = null;
  };
  function finishRecovery() {
    if (disposed || !recoveringPlayer ||
        provider.shadowRoot?.querySelector("ha-web-rtc-player") === recoveringPlayer) return;
    const hls = provider.shadowRoot?.querySelector("ha-hls-player");
    const video = hls?.shadowRoot?.querySelector("video");
    if (!hls?.isConnected) return;
    // A terminal HLS error must not block the only remaining native transport.
    const hlsFailed = hls._error && hls._errorIsFatal === true;
    if (!hlsFailed && (hls._error || !video || video.error ||
        video.paused || video.ended || video.readyState < 2 || !video.videoWidth)) return;
    recoveringPlayer = null;
    stopRecoveryWatch();
    resumeAttempt();
    provider.requestUpdate();
  }
  const recoverEstablishedPlayer = () => {
    if (recoveringPlayer) return true;
    if (!hlsAvailable || !player || usablePlayer !== player) return false;
    // HA can close a failed session without clearing its old streams:true.
    // Recreate only that child, through HA's selector, after HLS is playing.
    recoveringPlayer = player;
    usablePlayer = null;
    provider.requestUpdate();
    return true;
  };

  const suppress = () => {
    if (disposed || suppressed || !hlsReady) return;
    suppressed = true;
    failures += 1;
    retryAfter = now() + (failures === 1 ? INITIAL_RETRY_MS : REPEATED_RETRY_MS);
    provider.requestUpdate();
  };
  const onPeerState = () => {
    if (disposed || !peer || !player?.isConnected) return;
    if (player._peerConnection !== peer) {
      observe();
      return;
    }
    if (peer.iceConnectionState === "failed" || peer.connectionState === "failed") {
      failedPeer = peer;
      if (!recoverEstablishedPlayer()) suppress();
    }
    if (peer.iceConnectionState === "closed" || peer.connectionState === "closed") {
      scheduleDiscovery();
    }
  };
  const detachPeer = () => {
    peer?.removeEventListener("iceconnectionstatechange", onPeerState);
    peer?.removeEventListener("connectionstatechange", onPeerState);
    peer = null;
  };
  const stopDiscovery = () => {
    if (discoveryTimer !== null) clearTimer(discoveryTimer);
    discoveryTimer = null;
  };
  function scheduleDiscovery() {
    if (disposed || discoveryTimer !== null) return;
    discoveryTimer = setTimer(() => {
      discoveryTimer = null;
      observe();
    }, PEER_DISCOVERY_MS);
  }
  function observe() {
    if (disposed) return;
    const nextPlayer = provider.shadowRoot?.querySelector("ha-web-rtc-player");
    const nextPeer = nextPlayer?._peerConnection || null;
    if (player !== nextPlayer || peer !== nextPeer) {
      detachPeer();
      player = nextPlayer;
      peer = nextPeer;
      failedPeer = null;
      if (usablePlayer !== player) usablePlayer = null;
      peer?.addEventListener("iceconnectionstatechange", onPeerState);
      peer?.addEventListener("connectionstatechange", onPeerState);
    }
    stopDiscovery();
    if (recoveringPlayer) {
      const video = provider.shadowRoot?.querySelector("ha-hls-player")?.shadowRoot?.querySelector("video");
      if (video !== recoveryVideo) {
        stopRecoveryWatch();
        recoveryVideo = video || null;
        for (const event of ["loadeddata", "playing", "timeupdate"]) {
          recoveryVideo?.addEventListener(event, finishRecovery);
        }
      }
      finishRecovery();
    }
    if (!player?.isConnected) return;
    // Native signaling errors replace the video with an error alert. An error
    // flag alone must not tear down media that is still present and recovering.
    if (player._error && !player.shadowRoot?.querySelector("video")) {
      if (!recoverEstablishedPlayer()) suppress();
      return;
    }
    onPeerState();
    // The native player fetches client configuration before creating its peer.
    // Once attached, state events replace polling, including while dormant.
    if (!peer || peer.iceConnectionState === "closed" || peer.connectionState === "closed") {
      scheduleDiscovery();
    }
  }
  const resumeAttempt = () => {
    suppressed = false;
    failedPeer = null;
    usablePlayer = null;
    // HA retains its last child status. Ignore it only until the new child
    // reports, rather than changing HA's state or remounting the provider.
    ignoredWebRtcStreams = lastWebRtcStreams;
  };
  return {
    observe,
    adjustWebRtcStreams(hlsStreams, webRtcStreams) {
      hlsReady = hlsStreams?.hasVideo === true;
      lastWebRtcStreams = webRtcStreams;
      if (recoveringPlayer) return undefined;
      if (suppressed && !hlsReady) resumeAttempt();
      const current = webRtcStreams === ignoredWebRtcStreams ? undefined : webRtcStreams;
      if (!suppressed && current?.hasVideo === true) {
        failures = 0;
        retryAfter = 0;
        failedPeer = null;
        usablePlayer = provider.shadowRoot?.querySelector("ha-web-rtc-player") || null;
      } else if (!suppressed && (current?.hasVideo === false || (peer && failedPeer === peer))) {
        suppress();
      }
      return current;
    },
    filterSelection(streams, { canUseHls = false } = {}) {
      hlsAvailable = canUseHls;
      return (recoveringPlayer && hlsAvailable) || (suppressed && hlsReady)
        ? [{ type: "hls", visible: true }] : streams;
    },
    retryIfEligible() {
      if (disposed || !suppressed || now() < retryAfter) return;
      resumeAttempt();
      provider.requestUpdate();
    },
    dispose() {
      disposed = true;
      stopDiscovery();
      stopRecoveryWatch();
      detachPeer();
      player = null;
      usablePlayer = null;
      recoveringPlayer = null;
    },
  };
}
