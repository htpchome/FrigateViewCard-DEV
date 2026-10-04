function resolveNavigatorMediaDevices() {
  return typeof navigator !== "undefined" ? navigator.mediaDevices : null;
}

async function requestMicrophoneStream() {
  const mediaDevices = resolveNavigatorMediaDevices();
  if (!mediaDevices?.getUserMedia) {
    throw new Error("Microphone capture is not supported in this browser");
  }
  return await mediaDevices.getUserMedia({ audio: true, video: false });
}

function stopMediaStream(stream) {
  stream?.getTracks?.().forEach((track) => {
    try {
      track.stop();
    } catch (_) {}
  });
}

const createTwoWayTalkAbortError = () => {
  const error = new Error("Two-way talk connection canceled");
  error.name = "AbortError";
  return error;
};

const throwIfAborted = (abortSignal) => {
  if (abortSignal?.aborted) throw createTwoWayTalkAbortError();
};

async function prepareHaDirectTalkResources({
  prepareConnection,
  abortSignal,
  onTalkStartupTiming,
}) {
  let localStream = null;
  let abandoned = false;
  let rejectAbort = null;
  const aborted = new Promise((_, reject) => {
    rejectAbort = reject;
  });
  const handleAbort = () => rejectAbort(createTwoWayTalkAbortError());
  abortSignal?.addEventListener?.("abort", handleAbort, { once: true });
  try {
    throwIfAborted(abortSignal);
    onTalkStartupTiming?.("microphone-requested");
    const microphone = requestMicrophoneStream().then((stream) => {
      // Permission can resolve after cancellation or a configuration failure.
      if (abandoned || abortSignal?.aborted) {
        stopMediaStream(stream);
        throw createTwoWayTalkAbortError();
      }
      localStream = stream;
      onTalkStartupTiming?.("microphone-ready");
      return stream;
    });
    const preparation = (async () => await prepareConnection())();
    const [stream, preparedConnection] = await Promise.race([
      Promise.all([microphone, preparation]),
      aborted,
    ]);
    throwIfAborted(abortSignal);
    return { localStream: stream, preparedConnection };
  } catch (error) {
    abandoned = true;
    stopMediaStream(localStream);
    throw error;
  } finally {
    abortSignal?.removeEventListener?.("abort", handleAbort);
  }
}

async function startMountedTwoWayTalkSession({
  type,
  mountMicrophoneStream,
  onEnded,
  restoreLiveOnStop = true,
  abortSignal = null,
  prepareConnection = null,
  onTalkStartupTiming = null,
}) {
  if (typeof mountMicrophoneStream !== "function") {
    throw new Error(`Missing ${type} two-way talk mount handler`);
  }

  throwIfAborted(abortSignal);
  let localStream = null;
  let engine = null;
  let stopped = false;
  let ended = false;
  let microphoneMuted = false;

  const notifyEnded = () => {
    if (ended) return;
    ended = true;
    onEnded?.();
  };

  try {
    const resources = prepareConnection
      ? await prepareHaDirectTalkResources({
          prepareConnection,
          abortSignal,
          onTalkStartupTiming,
        })
      : { localStream: await requestMicrophoneStream() };
    localStream = resources.localStream;
    throwIfAborted(abortSignal);
    engine = await mountMicrophoneStream({
      localStream,
      onEnded: notifyEnded,
      abortSignal,
      ...(prepareConnection
        ? { preparedConnection: resources.preparedConnection }
        : {}),
    });
    throwIfAborted(abortSignal);
    if (!engine) {
      throw new Error(`Unable to establish ${type} two-way talk`);
    }
  } catch (error) {
    try {
      await engine?.destroy?.();
    } catch (_) {}
    stopMediaStream(localStream);
    throw error;
  }

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try {
      await engine?.destroy?.();
    } finally {
      stopMediaStream(localStream);
      notifyEnded();
    }
  };

  const setMicrophoneMuted = (muted) => {
    microphoneMuted = muted === true;
    for (const track of localStream.getAudioTracks?.() || []) {
      track.enabled = !microphoneMuted;
    }
    return microphoneMuted;
  };

  return {
    type,
    restoreLiveOnStop,
    stop,
    setMicrophoneMuted,
    engine,
    localStream,
    get microphoneMuted() {
      return microphoneMuted;
    },
  };
}

export async function startGo2RtcTwoWayTalkSession({
  mountMicrophoneStream,
  onEnded,
  abortSignal,
}) {
  return await startMountedTwoWayTalkSession({
    type: "frigate_go2rtc",
    mountMicrophoneStream,
    onEnded,
    restoreLiveOnStop: false,
    abortSignal,
  });
}

export async function startHaDirectTwoWayTalkSession({
  mountMicrophoneStream,
  onEnded,
  abortSignal,
  prepareConnection,
  onTalkStartupTiming,
}) {
  return await startMountedTwoWayTalkSession({
    type: "ha_direct",
    mountMicrophoneStream,
    onEnded,
    restoreLiveOnStop: false,
    abortSignal,
    prepareConnection,
    onTalkStartupTiming,
  });
}
