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

export function createGo2RtcTwoWayTalkBackchannel({
  resolveWebSocketUrl,
  createPeerConnection = (config) => new RTCPeerConnection(config),
  createWebSocket = (url) => new WebSocket(url),
  connectionTimeoutMs = DEFAULT_CONNECTION_TIMEOUT_MS,
} = {}) {
  if (typeof resolveWebSocketUrl !== "function") {
    throw new Error("Missing go2rtc two-way talk WebSocket resolver");
  }

  const connect = async ({ entity, microphoneStream, onEnded } = {}) => {
    const microphoneTrack = resolveMicrophoneTrack(microphoneStream);
    if (!microphoneTrack) {
      throw new Error("Two-way talk microphone stream has no active audio track");
    }

    const wsUrl = await resolveWebSocketUrl(entity);
    if (!wsUrl) {
      throw new Error("Unable to resolve the go2rtc two-way talk endpoint");
    }

    const pc = createPeerConnection({
      bundlePolicy: "max-bundle",
      sdpSemantics: "unified-plan",
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    let ws = null;
    let transceiver = null;
    let connectionTimer = null;
    let startSettled = false;
    let connected = false;
    let destroyed = false;
    let endNotified = false;
    let resolveStart = null;
    let rejectStart = null;

    const startPromise = new Promise((resolve, reject) => {
      resolveStart = resolve;
      rejectStart = reject;
    });

    const clearConnectionTimer = () => {
      if (!connectionTimer) return;
      clearTimeout(connectionTimer);
      connectionTimer = null;
    };

    const closeWebSocket = () => {
      const activeSocket = ws;
      ws = null;
      if (!activeSocket) return;
      activeSocket.removeEventListener?.("open", handleWebSocketOpen);
      activeSocket.removeEventListener?.("message", handleWebSocketMessage);
      activeSocket.removeEventListener?.("close", handleWebSocketClose);
      activeSocket.removeEventListener?.("error", handleWebSocketError);
      try {
        activeSocket.close();
      } catch (_) {}
    };

    const closePeerConnection = () => {
      pc.removeEventListener?.(
        "connectionstatechange",
        handleConnectionStateChange,
      );
      pc.removeEventListener?.("icecandidate", handleIceCandidate);
      microphoneTrack.removeEventListener?.("ended", handleMicrophoneEnded);
      try {
        transceiver?.stop?.();
      } catch (_) {}
      try {
        pc.close();
      } catch (_) {}
    };

    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      clearConnectionTimer();
      closeWebSocket();
      closePeerConnection();
      if (!startSettled) {
        startSettled = true;
        rejectStart(new Error("go2rtc two-way talk was stopped during startup"));
      }
    };

    const engine = {
      type: "frigate_go2rtc_backchannel",
      pc,
      microphoneStream,
      destroy,
    };

    const fail = (error) => {
      if (destroyed) return;
      const wasConnected = connected;
      const failure = normalizeError(
        error,
        "Unable to establish go2rtc two-way talk",
      );
      destroyed = true;
      clearConnectionTimer();
      closeWebSocket();
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
      if (destroyed || startSettled) return;
      const direction = transceiver?.currentDirection;
      if (!direction || !["sendonly", "sendrecv"].includes(direction)) {
        fail(new Error("go2rtc did not accept the microphone backchannel"));
        return;
      }
      connected = true;
      startSettled = true;
      clearConnectionTimer();
      closeWebSocket();
      resolveStart(engine);
    };

    function handleConnectionStateChange() {
      if (pc.connectionState === "connected") {
        finishConnected();
      } else if (pc.connectionState === "failed") {
        fail(new Error("go2rtc two-way talk connection failed"));
      }
    }

    function handleIceCandidate(event) {
      if (destroyed || !ws || ws.readyState !== 1) return;
      const candidate = event.candidate
        ? event.candidate.toJSON?.().candidate || event.candidate.candidate || ""
        : "";
      ws.send(
        JSON.stringify({ type: "webrtc/candidate", value: candidate }),
      );
    }

    async function handleWebSocketOpen(event) {
      if (destroyed || event?.currentTarget !== ws) return;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (destroyed || !ws || ws.readyState !== 1) return;
        ws.send(JSON.stringify({ type: "webrtc/offer", value: offer.sdp }));
      } catch (error) {
        fail(error);
      }
    }

    function handleWebSocketMessage(event) {
      if (destroyed || event?.currentTarget !== ws) return;
      let message = null;
      try {
        message = JSON.parse(event.data);
      } catch (_) {
        return;
      }

      if (message?.type === "webrtc/answer") {
        pc.setRemoteDescription({
          type: "answer",
          sdp: message.value,
        }).catch(fail);
        return;
      }
      if (message?.type === "webrtc/candidate") {
        pc.addIceCandidate({ candidate: message.value, sdpMid: "0" }).catch(
          () => {},
        );
        return;
      }
      if (
        message?.type === "error" &&
        String(message.value || "").toLowerCase().startsWith("webrtc")
      ) {
        fail(new Error(String(message.value)));
      }
    }

    function handleWebSocketClose(event) {
      if (event?.currentTarget !== ws) return;
      fail(new Error("go2rtc two-way talk signaling closed"));
    }

    function handleWebSocketError(event) {
      if (event?.currentTarget !== ws) return;
      fail(new Error("go2rtc two-way talk signaling failed"));
    }

    function handleMicrophoneEnded() {
      fail(new Error("Two-way talk microphone ended"));
    }

    try {
      transceiver = pc.addTransceiver(microphoneTrack, {
        direction: "sendonly",
        streams: [microphoneStream],
      });
      pc.addEventListener("connectionstatechange", handleConnectionStateChange);
      pc.addEventListener("icecandidate", handleIceCandidate);
      microphoneTrack.addEventListener?.("ended", handleMicrophoneEnded);

      ws = createWebSocket(wsUrl);
      ws.addEventListener("open", handleWebSocketOpen);
      ws.addEventListener("message", handleWebSocketMessage);
      ws.addEventListener("close", handleWebSocketClose);
      ws.addEventListener("error", handleWebSocketError);

      connectionTimer = setTimeout(() => {
        fail(new Error("go2rtc two-way talk connection timed out"));
      }, Math.max(1, Number(connectionTimeoutMs) || DEFAULT_CONNECTION_TIMEOUT_MS));
    } catch (error) {
      fail(error);
    }

    return await startPromise;
  };

  return { connect };
}
