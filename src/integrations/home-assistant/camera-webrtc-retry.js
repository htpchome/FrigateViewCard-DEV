const INITIAL_RETRY_MS = 120000;
const REPEATED_RETRY_MS = 300000;
const PEER_DISCOVERY_MS = 250;

// HA owns negotiation and teardown. Observe its peer without patching it, and
// let the provider's selector retire only a failed child when HLS is usable.
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
      suppress();
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
      peer?.addEventListener("iceconnectionstatechange", onPeerState);
      peer?.addEventListener("connectionstatechange", onPeerState);
    }
    stopDiscovery();
    if (!player?.isConnected) return;
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
    // HA retains its last child status. Ignore it only until the new child
    // reports, rather than changing HA's state or remounting the provider.
    ignoredWebRtcStreams = lastWebRtcStreams;
  };
  return {
    observe,
    adjustWebRtcStreams(hlsStreams, webRtcStreams) {
      hlsReady = hlsStreams?.hasVideo === true;
      lastWebRtcStreams = webRtcStreams;
      if (suppressed && !hlsReady) resumeAttempt();
      const current = webRtcStreams === ignoredWebRtcStreams ? undefined : webRtcStreams;
      if (!suppressed && current?.hasVideo === true) {
        failures = 0;
        retryAfter = 0;
        failedPeer = null;
      } else if (!suppressed && (current?.hasVideo === false || (peer && failedPeer === peer))) {
        suppress();
      }
      return current;
    },
    filterSelection: (streams) => suppressed && hlsReady
      ? [{ type: "hls", visible: true }] : streams,
    retryIfEligible() {
      if (disposed || !suppressed || now() < retryAfter) return;
      resumeAttempt();
      provider.requestUpdate();
    },
    dispose() {
      disposed = true;
      stopDiscovery();
      detachPeer();
      player = null;
    },
  };
}
