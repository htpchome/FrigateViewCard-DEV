import {
  resolveMseStartup,
  resolveWebRtcStartup,
} from "./startup-policy.js";
import {
  buildVideoOptionsForView,
  createVideoElement,
  mountNodeIntoSlot,
} from "../../shared/media/video-factory.js";
import { HOME_ASSISTANT_STUN_SERVER } from "../../constants.js";

const WEBRTC_NEGOTIATION_TIMEOUT_MS = 4000;

function stopMediaStream(stream) {
  stream?.getTracks?.().forEach((track) => {
    try {
      track.stop();
    } catch (_) {}
  });
}

function resolveMicrophoneTrack(stream) {
  return stream?.getAudioTracks?.()?.[0] || null;
}

function resolveGo2RtcCodecs(isSupported) {
  const codecs = [
    "avc1.640029",
    "avc1.64002A",
    "avc1.640033",
    "hvc1.1.6.L153.B0",
    "mp4a.40.2",
    "mp4a.40.5",
    "flac",
    "opus",
  ];
  return codecs
    .filter((codec) => isSupported(`video/mp4; codecs="${codec}"`))
    .join(",");
}

function normalizeGo2RtcCodecs(value) {
  if (!value) return "";
  const source = String(value).trim();
  const match = source.match(/codecs\s*=\s*"([^"]+)"/i);
  if (match && match[1]) return match[1].trim();
  if (/^video\//i.test(source)) return "";
  return source;
}

function resolveMediaSourceCapability(browserWindow = globalThis.window) {
  const MediaSourceCtor =
    browserWindow?.ManagedMediaSource || browserWindow?.MediaSource || null;
  if (!MediaSourceCtor) return null;

  const isTypeSupportedImpl = MediaSourceCtor.isTypeSupported;
  if (typeof isTypeSupportedImpl !== "function") return null;

  return {
    MediaSourceCtor,
    managed: MediaSourceCtor === browserWindow?.ManagedMediaSource,
    isTypeSupported: (mime) => {
      try {
        return isTypeSupportedImpl.call(MediaSourceCtor, mime) === true;
      } catch (_) {
        return false;
      }
    },
  };
}

function startVideoPlayback(video, { load = false } = {}) {
  if (!video) return;
  try {
    if (load) video.load?.();
    const playResult = video.play?.();
    playResult?.catch?.(() => {});
  } catch (_) {}
}

function startFirefoxLiveCatchup(video, isFirefox) {
  if (!video || !isFirefox()) return () => {};
  let firstFrameAt = 0;
  let hardSeekUsed = false;
  const timer = setInterval(() => {
    try {
      const buffered = video.buffered;
      if (!buffered || !buffered.length) return;
      const end = buffered.end(buffered.length - 1);
      const current = Number(video.currentTime) || 0;
      if (current > 0.05 && !firstFrameAt) firstFrameAt = Date.now();
      const lag = end - current;
      if (!Number.isFinite(lag) || lag <= 0) return;

      const sinceFirstFrame = firstFrameAt ? Date.now() - firstFrameAt : 0;
      if (sinceFirstFrame > 0 && sinceFirstFrame < 4000) {
        if (lag > 3.0 && !hardSeekUsed) {
          video.currentTime = Math.max(0, end - 0.08);
          video.playbackRate = 1.0;
          hardSeekUsed = true;
        } else if (lag > 1.5) {
          video.playbackRate = 1.08;
        } else if (lag > 0.7) {
          video.playbackRate = 1.04;
        } else {
          video.playbackRate = 1.0;
        }
        return;
      }

      if (lag > 2.8 && !hardSeekUsed && sinceFirstFrame >= 4000) {
        video.currentTime = Math.max(0, end - 0.2);
        video.playbackRate = 1.0;
        hardSeekUsed = true;
      } else if (lag > 2.0) {
        video.playbackRate = 1.05;
      } else if (lag > 1.0) {
        video.playbackRate = 1.02;
      } else {
        video.playbackRate = 1.0;
      }
    } catch (_) {}
  }, 500);
  return () => clearInterval(timer);
}

function resolveCommittedResult({
  commit,
  type,
  engine,
  slot,
  onCommittedStream,
}) {
  if (!commit) return { ok: true, type, engine, slot };
  onCommittedStream(type);
  return true;
}

export function createGo2RtcMounter({
  resolver,
  getStreamMuted,
  prepareSelectedPlayback,
  notifySelectedPlaybackReady,
  releasePreparedPlayback,
  waitForStreamStart,
  attachVideoFit,
  assignCommittedEngine,
  onCommittedStream,
  scheduleResumeLive,
  isFirefox,
  scopeKey,
  resetMseDiagnostics,
  markMseChunk,
  nowMs = () => Date.now(),
}) {
  const tryMountMse = async (slot, startup = null, options = {}) => {
    const {
      waitMs,
      minCurrentTime,
      minDecodedFrames,
      requireReadyState,
      strict,
    } = resolveMseStartup(startup || {});
    const { entity, abortSignal, commit } =
      resolver.resolveMountRequest(options);
    const muted = options?.muted ?? getStreamMuted();
    if (!entity) return false;
    if (abortSignal?.aborted) return false;
    const WebSocketCtor = window?.WebSocket;
    const mediaSourceCapability = resolveMediaSourceCapability(window);
    if (!WebSocketCtor || !mediaSourceCapability) return false;
    const { MediaSourceCtor, isTypeSupported, managed } =
      mediaSourceCapability;

    const video = createVideoElement(
      buildVideoOptionsForView(
        "live",
        {
          // Match ACC's selected-media lifecycle: the element is born muted
          // without native autoplay, then the mounted controller owns the
          // unmute/play order. WebKit makes its autoplay decision from this
          // initial state, before a source exists.
          muted: true,
          autoplay: false,
          controls: false,
        },
        { scopeKey },
      ),
    );

    let destroyed = false;
    mountNodeIntoSlot(slot, video);
    attachVideoFit(video);
    const selectedPlayback = prepareSelectedPlayback?.(video, {
      entity,
      isCurrent: () => !destroyed && !abortSignal?.aborted,
    }) === true;
    if (!selectedPlayback) {
      video.muted = Boolean(muted);
      startVideoPlayback(video);
    }

    // ACC renders and targets the selected media element while its signed URL
    // is still resolving. Preserve that lifecycle: the configured unmute/play
    // action must reach the actual candidate before this first async boundary.
    const wsUrl = await resolver.websocketUrlForEntity(entity);
    if (!wsUrl || abortSignal?.aborted) {
      destroyed = true;
      releasePreparedPlayback?.(video);
      video.remove?.();
      return false;
    }

    const mediaSource = new MediaSourceCtor();
    let mediaSourceObjectUrl = "";
    if (managed) {
      video.disableRemotePlayback = true;
      video.srcObject = mediaSource;
    } else {
      mediaSourceObjectUrl = URL.createObjectURL(mediaSource);
      video.src = mediaSourceObjectUrl;
      video.srcObject = null;
      mediaSource.addEventListener(
        "sourceopen",
        () => {
          if (!mediaSourceObjectUrl) return;
          URL.revokeObjectURL(mediaSourceObjectUrl);
          mediaSourceObjectUrl = "";
        },
        { once: true },
      );
    }
    if (!selectedPlayback) startVideoPlayback(video);

    const ws = new WebSocketCtor(wsUrl);
    ws.binaryType = "arraybuffer";
    const startupAbort = new AbortController();
    let abortBound = false;
    let streamStarted = false;
    let recoveryEnabled = commit;
    let recoveryScheduled = false;
    let recoveryHandler = scheduleResumeLive;
    let activityHandler = markMseChunk;
    resetMseDiagnostics(nowMs());

    let sourceBuffer = null;
    let mseRequested = false;
    let queue = [];

    const appendNext = () => {
      if (!sourceBuffer || sourceBuffer.updating || !queue.length) return;
      try {
        sourceBuffer.appendBuffer(queue.shift());
      } catch (_) {
        queue = [];
      }
    };

    const stopCatchup = startFirefoxLiveCatchup(video, isFirefox);
    const requestMse = () => {
      if (destroyed) return;
      if (mseRequested) return;
      if (ws.readyState !== WebSocketCtor.OPEN) return;
      const codecs = resolveGo2RtcCodecs(isTypeSupported);
      mseRequested = true;
      ws.send(JSON.stringify({ type: "mse", value: codecs }));
    };

    const destroy = () => {
      destroyed = true;
      releasePreparedPlayback?.(video);
      try {
        if (!startupAbort.signal.aborted) startupAbort.abort();
      } catch (_) {}
      try {
        ws.close();
      } catch (_) {}
      try {
        stopCatchup();
      } catch (_) {}
      try {
        if (managed) {
          video.srcObject = null;
        } else {
          video.removeAttribute?.("src");
          if (mediaSourceObjectUrl) {
            URL.revokeObjectURL(mediaSourceObjectUrl);
            mediaSourceObjectUrl = "";
          }
        }
      } catch (_) {}
      if (abortSignal && abortBound) {
        abortSignal.removeEventListener("abort", onAbort);
        abortBound = false;
      }
    };

    const onAbort = () => {
      destroy();
    };
    if (abortSignal) {
      abortSignal.addEventListener("abort", onAbort, { once: true });
      abortBound = true;
    }

    const engine = {
      type: "frigate_go2rtc",
      streamType: "mse",
      video,
      ws,
      destroy,
      activateRecovery: () => {
        recoveryEnabled = true;
        recoveryScheduled = false;
      },
      deactivateRecovery: () => {
        recoveryEnabled = false;
      },
      setRecoveryHandler: (handler) => {
        recoveryHandler = typeof handler === "function" ? handler : null;
      },
      setActivityHandler: (handler) => {
        activityHandler = typeof handler === "function" ? handler : null;
      },
    };
    if (commit) assignCommittedEngine(engine);

    mediaSource.addEventListener(
      "sourceopen",
      () => {
        requestMse();
      },
      { once: true },
    );

    ws.addEventListener("open", () => {
      if (destroyed) {
        try {
          ws.close();
        } catch (_) {}
        return;
      }
      if (mediaSource.readyState === "open") requestMse();
    });

    ws.addEventListener("error", () => {
      if (!startupAbort.signal.aborted) startupAbort.abort();
    });

    ws.addEventListener("close", () => {
      if (!startupAbort.signal.aborted) startupAbort.abort();
      if (
        !destroyed &&
        streamStarted &&
        recoveryEnabled &&
        !recoveryScheduled
      ) {
        recoveryScheduled = true;
        recoveryHandler?.("mse-ws-closed");
      }
    });

    ws.addEventListener("message", (event) => {
      if (destroyed) return;
      if (typeof event.data === "string") {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch (_) {
          return;
        }

        if (
          msg?.type === "mse" &&
          msg.value &&
          mediaSource.readyState === "open"
        ) {
          if (sourceBuffer) return;
          try {
            const codecs = normalizeGo2RtcCodecs(msg.value);
            if (!codecs) return;
            const mime = `video/mp4; codecs="${codecs}"`;
            if (!isTypeSupported(mime)) return;
            sourceBuffer = mediaSource.addSourceBuffer(mime);
            sourceBuffer.mode = "segments";
            sourceBuffer.addEventListener("updateend", appendNext);
            // The selected startup owner already has its pre-source play
            // request. Match ACC by waiting for loadeddata before acting
            // again; source attachment is not a third playback action.
            if (!selectedPlayback) startVideoPlayback(video);
            appendNext();
          } catch (_) {}
        }
        return;
      }

      if (!(event.data instanceof ArrayBuffer)) return;
      activityHandler?.(nowMs());
      queue.push(event.data);
      appendNext();
    });

    const started = await waitForStreamStart(slot, waitMs, {
      minCurrentTime,
      minDecodedFrames,
      requireReadyState,
      strict,
      abortSignal: startupAbort.signal,
    });
    if (!started) {
      destroy();
      return false;
    }
    streamStarted = true;

    return resolveCommittedResult({
      commit,
      type: "mse",
      engine,
      slot,
      onCommittedStream,
    });
  };

  const tryMountWebRtc = async (slot, startup = null, options = {}) => {
    const {
      waitMs,
      minCurrentTime,
      minDecodedFrames,
      requireReadyState,
      strict,
    } = resolveWebRtcStartup({
      startup: startup || {},
    });
    const { entity, abortSignal, commit } =
      resolver.resolveMountRequest(options);

    if (abortSignal?.aborted) return false;
    if (!("RTCPeerConnection" in window) || !("WebSocket" in window)) {
      return false;
    }
    if (!entity) return false;

    const microphoneStream = options?.microphoneStream || null;
    const microphoneTrack = resolveMicrophoneTrack(microphoneStream);
    if (microphoneStream && !microphoneTrack) return false;
    const onMicrophoneSessionEnded =
      options?.onEnded || options?.onMicrophoneSessionEnded;
    const preloadOffscreen =
      options?.preloadOffscreen === true && !microphoneTrack;

    const muted = options?.muted ?? getStreamMuted();
    const video = createVideoElement(
      buildVideoOptionsForView(
        "live",
        {
          // Keep WebKit's initial element state identical to ACC: muted and
          // explicitly controlled, never native-autoplay owned.
          muted: true,
          autoplay: false,
          controls: false,
        },
        { scopeKey },
      ),
    );

    let destroyed = false;
    const decodeVideo = preloadOffscreen
      ? document.createElement("video")
      : video;
    mountNodeIntoSlot(slot, video);
    attachVideoFit(video);
    const selectedPlayback = prepareSelectedPlayback?.(video, {
      entity,
      isCurrent: () => !destroyed && !abortSignal?.aborted,
    }) === true;
    if (!selectedPlayback) {
      video.muted = Boolean(muted);
      startVideoPlayback(video);
    }

    // Keep selected-media ownership on the element created during the initial
    // mount turn, before signed websocket resolution yields control.
    const wsUrl = await resolver.websocketUrlForEntity(entity);
    if (!wsUrl || abortSignal?.aborted) {
      destroyed = true;
      releasePreparedPlayback?.(video);
      video.remove?.();
      return false;
    }

    if (!selectedPlayback) startVideoPlayback(video);
    const pc = new RTCPeerConnection({
      bundlePolicy: "max-bundle",
      sdpSemantics: "unified-plan",
      iceServers: [{ urls: HOME_ASSISTANT_STUN_SERVER }],
    });
    const ws = new WebSocket(wsUrl);
    let abortBound = false;
    let streamStarted = false;
    let recoveryScheduled = false;
    let recoveryEnabled = commit;
    let microphoneEndNotified = false;
    let signalingComplete = false;
    const negotiationTimeoutMs = Math.max(
      1,
      Number(options?.negotiationTimeoutMs) || WEBRTC_NEGOTIATION_TIMEOUT_MS,
    );
    let negotiationTimer = null;
    let resolveNegotiationGuard = null;
    const negotiationGuardPromise = new Promise((resolve) => {
      resolveNegotiationGuard = resolve;
    });

    const clearNegotiationTimer = () => {
      if (!negotiationTimer) return;
      clearTimeout(negotiationTimer);
      negotiationTimer = null;
    };

    const settleNegotiationGuard = (result) => {
      if (!resolveNegotiationGuard) return;
      resolveNegotiationGuard(result);
      resolveNegotiationGuard = null;
    };

    const notifyMicrophoneSessionEnded = () => {
      if (destroyed || !microphoneStream || microphoneEndNotified) {
        return;
      }
      microphoneEndNotified = true;
      stopMediaStream(microphoneStream);
      onMicrophoneSessionEnded?.();
    };

    const closeSignalingSocket = () => {
      if (Number(ws.readyState) >= 2) return;
      try {
        ws.close();
      } catch (_) {}
    };

    const completeSignaling = () => {
      if (destroyed || signalingComplete) return;
      signalingComplete = true;
      closeSignalingSocket();
    };

    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      releasePreparedPlayback?.(video);
      clearNegotiationTimer();
      settleNegotiationGuard(false);
      try {
        video.pause?.();
      } catch (_) {}
      try {
        const activeStream = video.srcObject || decodeVideo.srcObject;
        for (const track of activeStream?.getTracks?.() || []) {
          track.stop?.();
        }
        video.srcObject = null;
        if (decodeVideo !== video) {
          decodeVideo.removeAttribute?.("src");
          decodeVideo.srcObject = null;
        }
      } catch (_) {}
      try {
        for (const transceiver of pc.getTransceivers?.() || []) {
          transceiver.stop?.();
        }
        pc.close();
      } catch (_) {}
      closeSignalingSocket();
      stopMediaStream(microphoneStream);
      if (abortSignal && abortBound) {
        abortSignal.removeEventListener("abort", onAbort);
        abortBound = false;
      }
    };

    const onAbort = () => {
      destroy();
    };
    if (abortSignal) {
      abortSignal.addEventListener("abort", onAbort, { once: true });
      abortBound = true;
    }

    let recoveryHandler = scheduleResumeLive;
    const engine = {
      type: "frigate_go2rtc",
      streamType: "webrtc",
      video,
      pc,
      ws,
      localStream: microphoneStream,
      microphoneStream,
      get signalingComplete() {
        return signalingComplete;
      },
      destroy,
      activateRecovery: () => {
        recoveryEnabled = true;
        recoveryScheduled = false;
      },
      deactivateRecovery: () => {
        recoveryEnabled = false;
      },
      setRecoveryHandler: (handler) => {
        recoveryHandler = typeof handler === "function" ? handler : null;
      },
    };
    if (commit) assignCommittedEngine(engine);

    if (microphoneTrack) {
      pc.addTransceiver(microphoneTrack, {
        direction: "sendonly",
        streams: [microphoneStream],
      });
    }
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    const scheduleRecovery = (reason) => {
      if (
        destroyed ||
        !streamStarted ||
        !recoveryEnabled ||
        recoveryScheduled
      ) {
        return;
      }
      recoveryScheduled = true;
      notifyMicrophoneSessionEnded();
      recoveryHandler?.(reason);
    };

    microphoneTrack?.addEventListener?.("ended", () => {
      scheduleRecovery("webrtc-talk-microphone-ended");
    });

    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "connected") {
        clearNegotiationTimer();
        completeSignaling();
        attachConnectedReceiveStream();
      }
      if (["disconnected", "failed"].includes(pc.connectionState)) {
        scheduleRecovery("webrtc-connection-lost");
      }
    });
    pc.addEventListener("iceconnectionstatechange", () => {
      if (["connected", "completed"].includes(pc.iceConnectionState)) {
        clearNegotiationTimer();
      }
      if (["disconnected", "failed"].includes(pc.iceConnectionState)) {
        scheduleRecovery("webrtc-connection-lost");
      }
    });
    ws.addEventListener("close", () => {
      if (signalingComplete) return;
      scheduleRecovery("webrtc-ws-closed");
    });

    let resolveFirstRenderedFrame = null;
    const firstRenderedFramePromise = new Promise((resolve) => {
      resolveFirstRenderedFrame = resolve;
    });

    const receiveTracks = new Set();
    let receiveStream = null;
    const watchFirstFrame = (targetVideo = video) => {
      targetVideo.requestVideoFrameCallback?.(() => {
        if (!resolveFirstRenderedFrame) return;
        resolveFirstRenderedFrame(true);
        resolveFirstRenderedFrame = null;
      });
    };
    const transferDecodedStream = () => {
      if (
        !preloadOffscreen ||
        destroyed ||
        abortSignal?.aborted ||
        !receiveStream
      ) return;
      video.srcObject = receiveStream;
      if (selectedPlayback) {
        notifySelectedPlaybackReady?.(video);
      } else {
        startVideoPlayback(video);
      }
      if (resolveFirstRenderedFrame) {
        resolveFirstRenderedFrame(true);
        resolveFirstRenderedFrame = null;
      }
      decodeVideo.srcObject = null;
    };
    const attachConnectedReceiveStream = () => {
      if (microphoneTrack || destroyed ||
          abortSignal?.aborted || pc.connectionState !== "connected") return;
      for (const receiver of pc.getReceivers?.() || []) {
        if (receiver.track) receiveTracks.add(receiver.track);
      }
      const tracks = [...receiveTracks].filter((track) => track.readyState !== "ended");
      if (!tracks.length) return;
      if (!receiveStream) {
        receiveStream = new MediaStream(tracks);
        if (preloadOffscreen) {
          // ACC experimental decodes the WebRTC lane offscreen while it races
          // the binary lane. Once loaded, it transfers that already-live
          // MediaStream to the persistent selected video before re-applying
          // selected unmute/play.
          decodeVideo.addEventListener(
            "loadeddata",
            transferDecodedStream,
            { once: true },
          );
          decodeVideo.srcObject = receiveStream;
        } else {
          // Assign once after connection. A later audio track joins the same
          // stream without resetting an in-flight audible playback request.
          video.srcObject = receiveStream;
          watchFirstFrame();
        }
      } else {
        for (const track of tracks) {
          if (!receiveStream.getTracks().includes(track)) receiveStream.addTrack(track);
        }
      }
    };

    pc.addEventListener("track", (event) => {
      if (destroyed) {
        try {
          event.track?.stop?.();
        } catch (_) {}
        return;
      }
      if (!microphoneTrack) {
        if (event.track) receiveTracks.add(event.track);
        for (const stream of event.streams || []) {
          for (const track of stream.getTracks()) receiveTracks.add(track);
        }
        attachConnectedReceiveStream();
        return;
      }
      if (event.streams && event.streams[0]) {
        video.srcObject = event.streams[0];
      } else {
        const mediaStream = video.srcObject || new MediaStream();
        mediaStream.addTrack(event.track);
        video.srcObject = mediaStream;
      }
      if (!selectedPlayback) video.play().catch(() => {});
      watchFirstFrame();
    });

    pc.addEventListener("icecandidate", (event) => {
      if (destroyed) return;
      if (ws.readyState !== WebSocket.OPEN) return;
      const candidate = event.candidate
        ? event.candidate.toJSON().candidate
        : "";
      ws.send(JSON.stringify({ type: "webrtc/candidate", value: candidate }));
    });

    ws.addEventListener("message", (event) => {
      if (destroyed) return;
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      if (msg?.type === "webrtc/answer") {
        pc.setRemoteDescription({
          type: "answer",
          sdp: msg.value,
        }).catch(() => {});
      } else if (msg?.type === "webrtc/candidate") {
        pc.addIceCandidate({ candidate: msg.value, sdpMid: "0" }).catch(
          () => {},
        );
      }
    });

    ws.addEventListener("open", async () => {
      if (destroyed || abortSignal?.aborted) {
        try {
          ws.close();
        } catch (_) {}
        return;
      }
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (
          destroyed ||
          abortSignal?.aborted ||
          ws.readyState !== WebSocket.OPEN
        ) {
          try {
            ws.close();
          } catch (_) {}
          return;
        }
        ws.send(JSON.stringify({ type: "webrtc/offer", value: offer.sdp }));
        if (!negotiationTimer) {
          negotiationTimer = setTimeout(() => {
            if (destroyed || streamStarted) return;
            destroy();
          }, negotiationTimeoutMs);
        }
      } catch (_) {}
    });

    const started = await Promise.race([
      waitForStreamStart(slot, waitMs, {
        minCurrentTime,
        minDecodedFrames,
        requireReadyState,
        strict,
        abortSignal,
      }),
      firstRenderedFramePromise,
      negotiationGuardPromise,
    ]);
    resolveFirstRenderedFrame = null;
    if (!started) {
      destroy();
      return false;
    }
    streamStarted = true;
    clearNegotiationTimer();

    return resolveCommittedResult({
      commit,
      type: "webrtc",
      engine,
      slot,
      onCommittedStream,
    });
  };

  return {
    tryMountMse,
    tryMountWebRtc,
  };
}
