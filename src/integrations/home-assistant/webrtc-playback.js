import {
  buildVideoOptionsForView,
  createVideoElement,
} from "../../shared/media/video-factory.js";

const HA_WEBRTC_PROVIDER_START_WAIT_MS = 3000;
const HA_WEBRTC_MEDIA_STALL_MS = 10000;
const HA_WEBRTC_MEDIA_WATCH_INTERVAL_MS = 2000;

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
  now = () => Date.now(),
  setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimer = (timer) => globalThis.clearTimeout(timer),
  mediaStallMs = HA_WEBRTC_MEDIA_STALL_MS,
  documentTarget = globalThis.document,
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
  let recoveryActive = true;
  let recoveryHandler =
    typeof onConnectionLost === "function" ? onConnectionLost : null;
  let failureSettled = false;
  let resolveFailure = null;
  let providerStartedSettled = false;
  let resolveProviderStarted = null;
  let remoteVideoTrack = null;
  let cleanupRemoteVideoTrack = () => {};
  let mediaWatchTimer = null;
  let frameCallbackId = null;
  let lastMediaActivityAt = 0;
  let lastMediaTime = null;
  let lastDecodedFrames = null;
  let mediaFailureNotified = false;
  const normalizedMediaStallMs = Math.max(
    1,
    Number(mediaStallMs) || HA_WEBRTC_MEDIA_STALL_MS,
  );
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
    if (recoveryActive) recoveryHandler?.(reason);
  };

  const clearMediaWatchTimer = () => {
    if (mediaWatchTimer != null) clearTimer(mediaWatchTimer);
    mediaWatchTimer = null;
  };

  const readDecodedFrames = () => {
    const decodedFrames = Number(
      video.webkitDecodedFrameCount ||
        video.getVideoPlaybackQuality?.()?.totalVideoFrames,
    );
    return Number.isFinite(decodedFrames) ? decodedFrames : null;
  };

  const recordMediaActivity = () => {
    lastMediaActivityAt = now();
    mediaFailureNotified = false;
  };

  const sampleMediaProgress = ({ establish = false } = {}) => {
    const mediaTime = Number(video.currentTime);
    const decodedFrames = readDecodedFrames();
    const timeAdvanced =
      Number.isFinite(mediaTime) &&
      lastMediaTime != null &&
      mediaTime > lastMediaTime;
    const framesAdvanced =
      decodedFrames != null &&
      lastDecodedFrames != null &&
      decodedFrames > lastDecodedFrames;
    if (Number.isFinite(mediaTime)) lastMediaTime = mediaTime;
    if (decodedFrames != null) lastDecodedFrames = decodedFrames;
    if (establish || timeAdvanced || framesAdvanced) recordMediaActivity();
    return timeAdvanced || framesAdvanced;
  };

  const currentVideoTrack = () =>
    remoteVideoTrack || video.srcObject?.getVideoTracks?.()?.[0] || null;

  const hasLiveVideoTrack = () => {
    const track = currentVideoTrack();
    return Boolean(
      track && track.readyState !== "ended" && track.muted !== true,
    );
  };

  const hasRecentMediaActivity = (maxAgeMs = normalizedMediaStallMs) => {
    if (!started || destroyed || !hasLiveVideoTrack()) return false;
    sampleMediaProgress();
    const activityAge = now() - lastMediaActivityAt;
    return (
      lastMediaActivityAt > 0 &&
      activityAge >= 0 &&
      activityAge <= Math.max(1, Number(maxAgeMs) || normalizedMediaStallMs)
    );
  };

  const notifyMediaStalled = () => {
    if (mediaFailureNotified || destroyed) return;
    mediaFailureNotified = true;
    clearMediaWatchTimer();
    notifyConnectionLost("webrtc-media-stalled");
  };

  const watchMediaActivity = () => {
    clearMediaWatchTimer();
    if (destroyed || !started || !recoveryActive || mediaFailureNotified) {
      return;
    }
    mediaWatchTimer = setTimer(() => {
      mediaWatchTimer = null;
      if (destroyed || !started || !recoveryActive) return;
      if (documentTarget?.visibilityState === "hidden") {
        watchMediaActivity();
        return;
      }
      sampleMediaProgress();
      if (
        !hasLiveVideoTrack() ||
        now() - lastMediaActivityAt >= normalizedMediaStallMs
      ) {
        notifyMediaStalled();
        return;
      }
      watchMediaActivity();
    }, Math.min(
      HA_WEBRTC_MEDIA_WATCH_INTERVAL_MS,
      normalizedMediaStallMs,
    ));
  };

  const armFrameActivity = () => {
    if (
      destroyed ||
      frameCallbackId != null ||
      typeof video.requestVideoFrameCallback !== "function"
    ) {
      return;
    }
    frameCallbackId = video.requestVideoFrameCallback(() => {
      frameCallbackId = null;
      if (destroyed) return;
      sampleMediaProgress({ establish: true });
      armFrameActivity();
    });
  };

  const onTimeUpdate = () => {
    if (destroyed) return;
    sampleMediaProgress();
  };

  const bindRemoteVideoTrack = (track) => {
    cleanupRemoteVideoTrack();
    remoteVideoTrack = track || null;
    if (!remoteVideoTrack) return;
    const onUnavailable = () => notifyMediaStalled();
    const onUnmute = () => sampleMediaProgress({ establish: started });
    remoteVideoTrack.addEventListener?.("ended", onUnavailable);
    remoteVideoTrack.addEventListener?.("mute", onUnavailable);
    remoteVideoTrack.addEventListener?.("unmute", onUnmute);
    cleanupRemoteVideoTrack = () => {
      remoteVideoTrack?.removeEventListener?.("ended", onUnavailable);
      remoteVideoTrack?.removeEventListener?.("mute", onUnavailable);
      remoteVideoTrack?.removeEventListener?.("unmute", onUnmute);
      remoteVideoTrack = null;
      cleanupRemoteVideoTrack = () => {};
    };
  };

  video.addEventListener?.("timeupdate", onTimeUpdate);

  const destroy = () => {
    if (destroyed) return shutdownPromise || Promise.resolve();
    destroyed = true;
    recoveryActive = false;
    recoveryHandler = null;
    clearMediaWatchTimer();
    if (frameCallbackId != null) {
      video.cancelVideoFrameCallback?.(frameCallbackId);
      frameCallbackId = null;
    }
    video.removeEventListener?.("timeupdate", onTimeUpdate);
    cleanupRemoteVideoTrack();
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
      sampleMediaProgress({ establish: true });
      armFrameActivity();
      watchMediaActivity();
      return true;
    },
    activateRecovery: () => {
      if (destroyed) return;
      recoveryActive = true;
      watchMediaActivity();
    },
    deactivateRecovery: () => {
      recoveryActive = false;
      clearMediaWatchTimer();
    },
    hasLiveVideoTrack,
    hasRecentMediaActivity,
    setRecoveryHandler: (handler) => {
      recoveryHandler = typeof handler === "function" ? handler : null;
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
        if (event.track?.kind === "video") {
          bindRemoteVideoTrack(event.track);
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

      peerConnection.addTransceiver("audio", { direction: "recvonly" });
      peerConnection.addTransceiver("video", { direction: "recvonly" });
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      if (destroyed) return false;
      await peerConnection.setLocalDescription(offer);
      if (destroyed) return false;

      let gatheredCandidates = "";
      while (pendingCandidates.length) {
        const candidate = pendingCandidates.shift();
        if (candidate?.candidate) {
          gatheredCandidates += `a=${candidate.candidate}\r\n`;
        }
      }
      const offerSdp = `${offer.sdp || ""}${gatheredCandidates}`;

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
            offer: offerSdp,
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
