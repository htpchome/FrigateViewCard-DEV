const DEFAULT_CONNECTION_TIMEOUT_MS = 10000;

const stopMediaStream = (stream) => {
  stream?.getTracks?.().forEach((track) => {
    try {
      track.stop?.();
    } catch (_) {}
  });
};

const resolveMicrophoneTrack = (stream) => {
  return (
    stream
      ?.getAudioTracks?.()
      ?.find((track) => track?.readyState !== "ended") || null
  );
};

const normalizeError = (error, fallbackMessage) => {
  return error instanceof Error ? error : new Error(fallbackMessage);
};

const configureIncomingAudio = (audio) => {
  if (!audio) return null;
  audio.autoplay = true;
  audio.controls = false;
  audio.muted = false;
  audio.defaultMuted = false;
  audio.volume = 1;
  audio.setAttribute?.("playsinline", "");
  audio.setAttribute?.("webkit-playsinline", "");
  audio.setAttribute?.("aria-hidden", "true");
  return audio;
};

export function createHaDirectTwoWayTalkBackchannel({
  getHass,
  createPeerConnection = (config) => new RTCPeerConnection(config),
  createIceCandidate = (candidate) => new RTCIceCandidate(candidate),
  createMediaStream = () => new MediaStream(),
  createIncomingAudio = () => document.createElement("audio"),
  mountIncomingAudio = () => null,
  connectionTimeoutMs = DEFAULT_CONNECTION_TIMEOUT_MS,
} = {}) {
  if (typeof getHass !== "function") {
    throw new Error("Missing Home Assistant connection provider");
  }

  const prepare = async ({
    entity,
    abortSignal,
    onTalkStartupTiming,
  } = {}) => {
    if (abortSignal?.aborted) {
      throw new Error("Home Assistant two-way talk was stopped during startup");
    }
    const hass = getHass();
    if (!entity || !hass?.callWS || !hass?.connection?.subscribeMessage) {
      throw new Error("Home Assistant two-way talk is unavailable");
    }
    const connection = hass.connection;
    onTalkStartupTiming?.("config-requested");
    const clientConfig = await hass.callWS({
      type: "camera/webrtc/get_client_config",
      entity_id: entity,
    });
    if (abortSignal?.aborted) {
      throw new Error("Home Assistant two-way talk was stopped during startup");
    }
    onTalkStartupTiming?.("config-ready");
    return { entity, connection, clientConfig };
  };

  const connect = async ({
    entity,
    microphoneStream,
    onEnded,
    abortSignal,
    preparedConnection = null,
    onTalkStartupTiming,
  } = {}) => {
    if (abortSignal?.aborted) {
      throw new Error("Home Assistant two-way talk was stopped during startup");
    }
    const hass = getHass();
    const microphoneTrack = resolveMicrophoneTrack(microphoneStream);
    if (
      !entity ||
      !microphoneTrack ||
      !hass?.callWS ||
      !hass?.connection?.subscribeMessage
    ) {
      throw new Error("Home Assistant two-way talk is unavailable");
    }

    const prepared = preparedConnection || await prepare({
      entity,
      abortSignal,
      onTalkStartupTiming,
    });
    if (abortSignal?.aborted) {
      throw new Error("Home Assistant two-way talk was stopped during startup");
    }
    if (
      prepared.entity !== entity ||
      prepared.connection !== getHass()?.connection
    ) {
      throw new Error("Home Assistant two-way talk context changed during startup");
    }
    const { clientConfig } = prepared;
    const pc = createPeerConnection(clientConfig?.configuration);
    onTalkStartupTiming?.("peer-created");
    const incomingAudio = configureIncomingAudio(createIncomingAudio());
    const incomingAudioStream = createMediaStream();
    const pendingCandidates = [];
    const remoteTracks = [];
    const transceivers = [];
    let sessionId = "";
    let subscriptionPromise = null;
    let unmountIncomingAudio = null;
    let microphoneTransceiver = null;
    let remoteAudioTrack = null;
    let connectionTimer = null;
    let startSettled = false;
    let peerConnected = false;
    let remoteAudioStarted = false;
    let remoteMediaStarted = false;
    let connected = false;
    let destroyed = false;
    let endNotified = false;
    let resolveStart = null;
    let rejectStart = null;
    let abortBound = false;

    const startPromise = new Promise((resolve, reject) => {
      resolveStart = resolve;
      rejectStart = reject;
    });

    const clearConnectionTimer = () => {
      if (!connectionTimer) return;
      clearTimeout(connectionTimer);
      connectionTimer = null;
    };

    const unbindAbort = () => {
      if (!abortBound) return;
      abortSignal?.removeEventListener?.("abort", handleAbort);
      abortBound = false;
    };

    const unsubscribeSignaling = () => {
      const activeSubscription = subscriptionPromise;
      subscriptionPromise = null;
      if (!activeSubscription) return;
      void activeSubscription
        .then((unsubscribe) => {
          if (typeof unsubscribe === "function") unsubscribe();
        })
        .catch(() => {});
    };

    const closeIncomingAudio = () => {
      try {
        incomingAudio?.pause?.();
        if (incomingAudio) incomingAudio.srcObject = null;
      } catch (_) {}
      stopMediaStream(incomingAudioStream);
      for (const track of remoteTracks) {
        if (incomingAudioStream?.getTracks?.().includes?.(track)) continue;
        try {
          track.stop?.();
        } catch (_) {}
      }
      remoteTracks.length = 0;
      try {
        unmountIncomingAudio?.();
      } catch (_) {}
      unmountIncomingAudio = null;
    };

    const closePeerConnection = () => {
      pc.removeEventListener?.(
        "connectionstatechange",
        handleConnectionStateChange,
      );
      pc.removeEventListener?.(
        "iceconnectionstatechange",
        handleIceConnectionStateChange,
      );
      pc.removeEventListener?.("icecandidate", handleIceCandidate);
      pc.removeEventListener?.("track", handleRemoteTrack);
      microphoneTrack.removeEventListener?.("ended", handleMicrophoneEnded);
      for (const transceiver of transceivers) {
        try {
          transceiver?.stop?.();
        } catch (_) {}
      }
      try {
        pc.close();
      } catch (_) {}
    };

    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      unbindAbort();
      clearConnectionTimer();
      unsubscribeSignaling();
      closeIncomingAudio();
      closePeerConnection();
      if (!startSettled) {
        startSettled = true;
        rejectStart(
          new Error("Home Assistant two-way talk was stopped during startup"),
        );
      }
    };

    const setIncomingAudioMuted = (muted) => {
      if (!incomingAudio) return;
      incomingAudio.muted = muted === true;
      incomingAudio.defaultMuted = muted === true;
      if (!incomingAudio.muted) {
        incomingAudio.volume = 1;
        incomingAudio.play?.().catch?.(() => {});
      }
    };

    const engine = {
      type: "ha_direct_backchannel",
      pc,
      microphoneStream,
      incomingAudio,
      incomingAudioStream,
      setIncomingAudioMuted,
      destroy,
      get sessionId() {
        return sessionId;
      },
    };

    const fail = (error) => {
      if (destroyed) return;
      const wasConnected = connected;
      const failure = normalizeError(
        error,
        "Unable to establish Home Assistant two-way talk",
      );
      destroyed = true;
      unbindAbort();
      clearConnectionTimer();
      unsubscribeSignaling();
      closeIncomingAudio();
      closePeerConnection();

      if (!startSettled) {
        startSettled = true;
        rejectStart(failure);
        return;
      }
      if (!wasConnected || endNotified) return;
      endNotified = true;
      stopMediaStream(microphoneStream);
      onEnded?.();
    };

    const finishConnected = () => {
      if (
        destroyed ||
        startSettled ||
        !peerConnected ||
        !remoteAudioStarted ||
        !remoteMediaStarted ||
        !remoteAudioTrack
      ) {
        return;
      }
      const direction = microphoneTransceiver?.currentDirection;
      if (!direction || !["sendonly", "sendrecv"].includes(direction)) {
        fail(
          new Error(
            "Home Assistant did not accept the microphone backchannel",
          ),
        );
        return;
      }
      connected = true;
      startSettled = true;
      unbindAbort();
      clearConnectionTimer();
      onTalkStartupTiming?.("media-ready");
      resolveStart(engine);
    };

    function handleAbort() {
      destroy();
    }

    const markRemoteMediaStarted = () => {
      if (destroyed || remoteMediaStarted) return;
      remoteMediaStarted = true;
      onTalkStartupTiming?.("video-started");
      finishConnected();
    };

    const markRemoteAudioStarted = () => {
      if (destroyed || remoteAudioStarted) return;
      remoteAudioStarted = true;
      onTalkStartupTiming?.("audio-started");
      finishConnected();
    };

    function handleConnectionStateChange() {
      if (pc.connectionState === "connected") {
        onTalkStartupTiming?.("peer-connected");
        peerConnected = true;
        finishConnected();
      } else if (pc.connectionState === "failed") {
        fail(new Error("Home Assistant two-way talk connection failed"));
      }
    }

    function handleIceConnectionStateChange() {
      if (["connected", "completed"].includes(pc.iceConnectionState)) {
        onTalkStartupTiming?.("ice-connected");
      }
      if (pc.iceConnectionState === "failed") {
        fail(new Error("Home Assistant two-way talk ICE connection failed"));
      }
    }

    const sendCandidate = async (candidate) => {
      if (destroyed || !sessionId || !candidate) return;
      onTalkStartupTiming?.("candidate-sent");
      try {
        await hass.callWS({
          type: "camera/webrtc/candidate",
          entity_id: entity,
          session_id: sessionId,
          candidate,
        });
        onTalkStartupTiming?.("candidate-acknowledged");
      } catch (_) {}
    };

    function handleIceCandidate(event) {
      if (destroyed || !event.candidate?.candidate) return;
      onTalkStartupTiming?.("local-candidate");
      const candidate = event.candidate.toJSON?.() || event.candidate;
      if (!sessionId) {
        pendingCandidates.push(candidate);
        return;
      }
      void sendCandidate(candidate);
    }

    function handleRemoteTrack(event) {
      const track = event?.track;
      if (!track) return;
      if (destroyed) {
        try {
          track.stop?.();
        } catch (_) {}
        return;
      }
      remoteTracks.push(track);
      if (track.kind === "audio") {
        onTalkStartupTiming?.("audio-track");
        remoteAudioTrack = track;
        track.addEventListener?.("unmute", markRemoteAudioStarted, {
          once: true,
        });
        incomingAudioStream.addTrack?.(track);
        if (incomingAudio) incomingAudio.srcObject = incomingAudioStream;
        const playback = incomingAudio?.play?.();
        playback?.catch?.((error) => {
          fail(
            normalizeError(
              error,
              "Unable to play Home Assistant two-way talk audio",
            ),
          );
        });
        if (track.muted === false) markRemoteAudioStarted();
        finishConnected();
        return;
      }
      if (track.kind !== "video") return;
      onTalkStartupTiming?.("video-track");
      track.addEventListener?.("unmute", markRemoteMediaStarted, {
        once: true,
      });
      if (track.muted === false) markRemoteMediaStarted();
    }

    async function handleOfferEvent(event) {
      if (destroyed) return;
      if (event?.type === "session") {
        onTalkStartupTiming?.("session-received");
        sessionId = String(event.session_id || "");
        while (pendingCandidates.length && !destroyed) {
          await sendCandidate(pendingCandidates.shift());
        }
        if (!destroyed) onTalkStartupTiming?.("candidate-queue-flushed");
        return;
      }
      if (event?.type === "answer") {
        onTalkStartupTiming?.("answer-received");
        try {
          await pc.setRemoteDescription({
            type: "answer",
            sdp: event.answer,
          });
          if (!destroyed) onTalkStartupTiming?.("answer-applied");
        } catch (error) {
          fail(error);
        }
        return;
      }
      if (event?.type === "candidate" && event.candidate) {
        onTalkStartupTiming?.("remote-candidate");
        try {
          const candidate =
            event.candidate.sdpMid ||
            event.candidate.sdpMLineIndex != null
              ? createIceCandidate(event.candidate)
              : createIceCandidate({
                  candidate: event.candidate.candidate,
                  sdpMid: "0",
                });
          await pc.addIceCandidate(candidate);
        } catch (_) {}
        return;
      }
      if (event?.type === "error") {
        fail(
          new Error(
            event.message || "Home Assistant rejected the two-way talk offer",
          ),
        );
      }
    }

    function handleMicrophoneEnded() {
      fail(new Error("Two-way talk microphone ended"));
    }

    try {
      if (abortSignal) {
        abortSignal.addEventListener("abort", handleAbort, { once: true });
        abortBound = true;
      }
      if (abortSignal?.aborted) {
        destroy();
        return await startPromise;
      }
      unmountIncomingAudio = mountIncomingAudio(incomingAudio) || null;
      if (clientConfig?.dataChannel) {
        pc.createDataChannel(clientConfig.dataChannel);
      }
      microphoneTransceiver = pc.addTransceiver(microphoneTrack, {
        direction: "sendonly",
        streams: [microphoneStream],
      });
      transceivers.push(
        microphoneTransceiver,
        pc.addTransceiver("video", { direction: "recvonly" }),
        pc.addTransceiver("audio", { direction: "recvonly" }),
      );
      pc.addEventListener("connectionstatechange", handleConnectionStateChange);
      pc.addEventListener(
        "iceconnectionstatechange",
        handleIceConnectionStateChange,
      );
      pc.addEventListener("icecandidate", handleIceCandidate);
      pc.addEventListener("track", handleRemoteTrack);
      microphoneTrack.addEventListener?.("ended", handleMicrophoneEnded);

      connectionTimer = setTimeout(() => {
        fail(new Error("Home Assistant two-way talk media timed out"));
      }, Math.max(1, Number(connectionTimeoutMs) || DEFAULT_CONNECTION_TIMEOUT_MS));

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      onTalkStartupTiming?.("offer-created");
      await pc.setLocalDescription(offer);
      if (!destroyed) {
        let gatheredCandidates = "";
        while (pendingCandidates.length) {
          const candidate = pendingCandidates.shift();
          if (candidate?.candidate) {
            gatheredCandidates += `a=${candidate.candidate}\r\n`;
          }
        }
        const offerSdp = `${offer.sdp || ""}${gatheredCandidates}`;
        onTalkStartupTiming?.("offer-sent");
        subscriptionPromise = Promise.resolve(
          hass.connection.subscribeMessage(handleOfferEvent, {
            type: "camera/webrtc/offer",
            entity_id: entity,
            offer: offerSdp,
          }),
        );
        subscriptionPromise.catch(fail);
      }
    } catch (error) {
      fail(error);
    }

    return await startPromise;
  };

  return { prepare, connect };
}
