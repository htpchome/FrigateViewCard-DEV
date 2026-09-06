import {
  buildVideoOptionsForView,
  createVideoElement,
} from "../../shared/media/video-factory.js";

const HA_WEBRTC_PROVIDER_START_WAIT_MS = 3000;

const stopMediaStream = (stream) => {
  for (const track of stream?.getTracks?.() || []) {
    try {
      track.stop?.();
    } catch (_) {}
  }
};

export function createHaDirectWebRtcPlayback({
  hass,
  entity,
  muted = true,
  controls = false,
  scopeKey,
  onConnectionLost,
} = {}) {
  const entityId = String(entity || "").trim();
  if (
    !entityId ||
    !hass?.callWS ||
    !hass?.connection?.subscribeMessage ||
    typeof RTCPeerConnection === "undefined"
  ) {
    return null;
  }

  const video = createVideoElement(
    buildVideoOptionsForView(
      "live",
      {
        muted,
        controls,
        objectFit: "contain",
        objectPosition: "center center",
      },
      { scopeKey },
    ),
  );
  const remoteStream =
    typeof MediaStream !== "undefined" ? new MediaStream() : null;
  const pendingCandidates = [];
  let peerConnection = null;
  let unsubscribePromise = null;
  let sessionId = "";
  let destroyed = false;
  let shutdownPromise = null;
  let started = false;
  let failureSettled = false;
  let resolveFailure = null;
  let providerStartedSettled = false;
  let resolveProviderStarted = null;
  const failure = new Promise((resolve) => {
    resolveFailure = resolve;
  });
  const providerStarted = new Promise((resolve) => {
    resolveProviderStarted = resolve;
  });

  const settleProviderStarted = () => {
    if (providerStartedSettled) return;
    providerStartedSettled = true;
    resolveProviderStarted?.();
    resolveProviderStarted = null;
  };

  const settleFailure = () => {
    if (failureSettled || started || destroyed) return;
    failureSettled = true;
    resolveFailure?.(false);
    resolveFailure = null;
  };

  const notifyConnectionLost = (reason) => {
    if (destroyed) return;
    if (!started) {
      settleFailure();
      return;
    }
    onConnectionLost?.(reason);
  };

  const destroy = () => {
    if (destroyed) return shutdownPromise || Promise.resolve();
    destroyed = true;
    if (!failureSettled && !started) {
      failureSettled = true;
      resolveFailure?.(false);
      resolveFailure = null;
    }
    const pendingUnsubscribe = unsubscribePromise;
    unsubscribePromise = null;
    shutdownPromise = pendingUnsubscribe
      ? pendingUnsubscribe
        .then(async (unsubscribe) => {
          if (!providerStartedSettled) {
            let timer = null;
            await Promise.race([
              providerStarted,
              new Promise((resolve) => {
                timer = setTimeout(resolve, HA_WEBRTC_PROVIDER_START_WAIT_MS);
              }),
            ]);
            if (timer != null) clearTimeout(timer);
          }
          await unsubscribe?.();
        })
        .catch(() => {})
      : Promise.resolve();
    stopMediaStream(remoteStream);
    try {
      video.pause?.();
      video.srcObject = null;
    } catch (_) {}
    if (peerConnection) {
      try {
        for (const transceiver of peerConnection.getTransceivers?.() || []) {
          transceiver.stop?.();
        }
        peerConnection.ontrack = null;
        peerConnection.onicecandidate = null;
        peerConnection.onconnectionstatechange = null;
        peerConnection.oniceconnectionstatechange = null;
        peerConnection.close();
      } catch (_) {}
      peerConnection = null;
    }
    pendingCandidates.length = 0;
    sessionId = "";
    return shutdownPromise;
  };

  const engine = {
    type: "ha_direct",
    streamType: "webrtc",
    video,
    remoteStream,
    failure,
    get pc() {
      return peerConnection;
    },
    markStarted: () => {
      if (destroyed) return false;
      started = true;
      return true;
    },
    destroy,
  };

  const start = async () => {
    try {
      const clientConfig = await hass.callWS({
        type: "camera/webrtc/get_client_config",
        entity_id: entityId,
      });
      if (destroyed) return false;

      peerConnection = new RTCPeerConnection(clientConfig?.configuration);
      if (clientConfig?.dataChannel) {
        peerConnection.createDataChannel(clientConfig.dataChannel);
      }

      peerConnection.ontrack = (event) => {
        if (destroyed) {
          event.track?.stop?.();
          return;
        }
        if (remoteStream) {
          remoteStream.addTrack(event.track);
          video.srcObject = remoteStream;
        } else if (event.streams?.[0]) {
          video.srcObject = event.streams[0];
        }
        video.play?.().catch?.(() => {});
      };
      peerConnection.onicecandidate = (event) => {
        if (destroyed || !event.candidate) return;
        const candidate = event.candidate.toJSON();
        if (!sessionId) {
          pendingCandidates.push(candidate);
          return;
        }
        hass
          .callWS({
            type: "camera/webrtc/candidate",
            entity_id: entityId,
            session_id: sessionId,
            candidate,
          })
          .catch(() => {});
      };
      peerConnection.onconnectionstatechange = () => {
        const state = peerConnection?.connectionState;
        if (state === "failed" || (started && state === "disconnected")) {
          notifyConnectionLost("webrtc-connection-lost");
        }
      };
      peerConnection.oniceconnectionstatechange = () => {
        const state = peerConnection?.iceConnectionState;
        if (state === "failed" || (started && state === "disconnected")) {
          notifyConnectionLost("webrtc-connection-lost");
        }
      };

      peerConnection.addTransceiver("video", { direction: "recvonly" });
      peerConnection.addTransceiver("audio", { direction: "recvonly" });
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      if (destroyed) return false;
      await peerConnection.setLocalDescription(offer);
      if (destroyed) return false;

      const handleOfferEvent = async (event) => {
        if (
          event?.type === "answer" ||
          event?.type === "candidate" ||
          event?.type === "error"
        ) {
          settleProviderStarted();
        }
        if (destroyed) return;
        if (event?.type === "session") {
          sessionId = event.session_id || "";
          while (pendingCandidates.length) {
            const candidate = pendingCandidates.shift();
            await hass
              .callWS({
                type: "camera/webrtc/candidate",
                entity_id: entityId,
                session_id: sessionId,
                candidate,
              })
              .catch(() => {});
          }
          return;
        }
        if (event?.type === "answer") {
          try {
            await peerConnection?.setRemoteDescription({
              type: "answer",
              sdp: event.answer,
            });
          } catch (_) {
            settleFailure();
          }
          return;
        }
        if (event?.type === "candidate") {
          try {
            const candidate =
              event.candidate?.sdpMid ||
              event.candidate?.sdpMLineIndex != null
                ? new RTCIceCandidate(event.candidate)
                : new RTCIceCandidate({
                    candidate: event.candidate?.candidate,
                    sdpMid: "0",
                  });
            await peerConnection?.addIceCandidate(candidate);
          } catch (_) {}
          return;
        }
        if (event?.type === "error") {
          notifyConnectionLost("webrtc-connection-lost");
        }
      };

      unsubscribePromise = Promise.resolve(
        hass.connection.subscribeMessage(
          handleOfferEvent,
          {
            type: "camera/webrtc/offer",
            entity_id: entityId,
            offer: offer.sdp,
          },
          { resubscribe: false },
        ),
      );
      unsubscribePromise.catch(() => {
        settleProviderStarted();
        settleFailure();
      });
      return true;
    } catch (_) {
      settleProviderStarted();
      settleFailure();
      return false;
    }
  };

  return { engine, start };
}
