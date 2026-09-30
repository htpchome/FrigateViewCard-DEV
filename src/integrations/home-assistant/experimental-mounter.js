import {
  createHaCameraStreamElement,
  ensureHaCameraPlaybackElements,
  findActiveHaCameraStreamPlayer,
  findActiveHaCameraStreamVideo,
  watchHaPlaybackFirstFrame,
} from "./playback.js";

const HA_EXPERIMENTAL_VISIBLE_STYLE =
  "width:100%;height:100%;display:block;background:var(--c-bg-deep)";

const streamTypeForPlayer = (player) => {
  const tagName = player?.tagName?.toLowerCase?.() || "";
  if (tagName === "ha-web-rtc-player") return "webrtc";
  if (tagName === "ha-hls-player") return "hls";
  return tagName === "video" ? "hls" : "";
};

export function createHaExperimentalMounter({
  getHass,
  getStreamMuted,
  isCurrentEngine,
  assignCommittedEngine,
  onCommittedMediaReady,
  onCommittedStream,
  onCommittedFailure,
  preparePlaybackElements = ensureHaCameraPlaybackElements,
  createStreamElement = createHaCameraStreamElement,
  watchFirstFrame = watchHaPlaybackFirstFrame,
  setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimer = (timer) => globalThis.clearTimeout(timer),
  startupTimeoutMs = 5000,
} = {}) {
  const bindings = new WeakMap();

  const prepare = () => {
    try {
      return preparePlaybackElements?.() ?? false;
    } catch (_) {
      return false;
    }
  };

  const release = (engine) => {
    const binding = bindings.get(engine);
    if (!binding) {
      if (engine?.type === "ha_experimental") engine?.destroy?.();
      return;
    }
    binding.destroy();
  };

  const updateHass = (engine) => {
    const binding = bindings.get(engine);
    if (!binding || binding.destroyed) return false;
    const hass = getHass?.();
    const stateObj = hass?.states?.[binding.entity];
    if (!hass || !stateObj) return false;
    engine.hass = hass;
    engine.stateObj = stateObj;
    binding.reconcile();
    return true;
  };

  const tryMount = async (slot, _startup = null, options = {}) => {
    const entity = String(options.entity || "").trim();
    if (!slot || !entity) return false;

    const preparation = prepare();
    if (preparation?.then) await preparation;

    const hass = getHass?.();
    const stateObj = hass?.states?.[entity];
    if (!hass || !stateObj) {
      if (options.commit !== false) onCommittedFailure?.();
      return false;
    }

    const initialMuted = options.muted ?? getStreamMuted?.() ?? true;
    const stream = createStreamElement({
      hass,
      stateObj,
      controls: false,
      muted: initialMuted,
      defaultMuted: initialMuted,
      fitMode: "contain",
      styleText: options.styleText || HA_EXPERIMENTAL_VISIBLE_STYLE,
    });
    if (!stream) {
      if (options.commit !== false) onCommittedFailure?.();
      return false;
    }

    stream.type = "ha_experimental";
    stream.streamType = "";
    const nativeDestroy =
      typeof stream.destroy === "function" ? stream.destroy.bind(stream) : null;
    let resolveStartup = () => {};
    const startupReady = new Promise((resolve) => {
      resolveStartup = resolve;
    });
    const binding = {
      destroyed: false,
      entity,
      outputMuted: Boolean(initialMuted),
      selectionMuted: Boolean(initialMuted),
      mediaReady: false,
      startupSettled: false,
      startupTimer: null,
      mutationObserver: null,
      cleanupFirstFrame: () => {},
      reconcile: () => {},
      destroy: () => {},
    };

    const settleStartup = (ready) => {
      if (binding.startupSettled) return;
      binding.startupSettled = true;
      if (binding.startupTimer != null) clearTimer(binding.startupTimer);
      binding.startupTimer = null;
      resolveStartup(ready === true);
    };
    const applyOutputMute = () => {
      const player = findActiveHaCameraStreamPlayer(stream);
      const video = findActiveHaCameraStreamVideo(stream);
      for (const media of [player, video]) {
        if (!media) continue;
        if (typeof media.muted === "boolean") {
          media.muted = binding.outputMuted;
        }
        if (typeof media.defaultMuted === "boolean") {
          media.defaultMuted = binding.outputMuted;
        }
      }
      if (!binding.outputMuted) video?.play?.().catch?.(() => {});
      return { player, video };
    };
    const observePlayerTree = () => {
      if (binding.mutationObserver || !stream.shadowRoot) return;
      const Observer = globalThis.MutationObserver;
      if (typeof Observer !== "function") return;
      binding.mutationObserver = new Observer(() => binding.reconcile());
      binding.mutationObserver.observe(stream.shadowRoot, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ["class", "hidden"],
      });
    };
    binding.reconcile = () => {
      if (binding.destroyed) return;
      void (async () => {
        try {
          await stream.updateComplete;
        } catch (_) {}
        if (binding.destroyed) return;
        observePlayerTree();
        const { player, video } = applyOutputMute();
        const nextStreamType = streamTypeForPlayer(player);
        if (nextStreamType) stream.streamType = nextStreamType;
        if (video && isCurrentEngine?.(stream)) {
          onCommittedMediaReady?.(stream, video);
        }
        if (
          binding.mediaReady &&
          nextStreamType &&
          isCurrentEngine?.(stream)
        ) {
          onCommittedStream?.(nextStreamType);
        }
      })();
    };
    const onPlayerEvent = () => binding.reconcile();
    const playerEvents = [
      "load",
      "streams",
      "loadeddata",
      "canplay",
      "playing",
      "volumechange",
    ];
    for (const eventName of playerEvents) {
      stream.addEventListener?.(eventName, onPlayerEvent, true);
    }
    binding.destroy = () => {
      if (binding.destroyed) return;
      binding.destroyed = true;
      settleStartup(false);
      binding.cleanupFirstFrame();
      binding.mutationObserver?.disconnect?.();
      binding.mutationObserver = null;
      for (const eventName of playerEvents) {
        stream.removeEventListener?.(eventName, onPlayerEvent, true);
      }
      bindings.delete(stream);
      try {
        nativeDestroy?.();
      } catch (_) {}
      try {
        stream.remove?.();
      } catch (_) {}
    };
    stream.setOutputMuted = (muted) => {
      if (binding.destroyed) return;
      binding.outputMuted = Boolean(muted);
      if (!binding.outputMuted && binding.selectionMuted) {
        binding.selectionMuted = false;
        stream.muted = false;
      }
      binding.reconcile();
    };
    stream.destroy = binding.destroy;
    bindings.set(stream, binding);

    slot.innerHTML = "";
    slot.appendChild(stream);
    if (options.commit === false) {
      binding.reconcile();
      return { ok: true, type: "ha_experimental", engine: stream, slot };
    }

    assignCommittedEngine?.(stream);
    binding.startupTimer = setTimer(() => {
      if (binding.destroyed || binding.mediaReady) return;
      if (isCurrentEngine?.(stream)) onCommittedFailure?.();
      settleStartup(false);
    }, startupTimeoutMs);
    binding.cleanupFirstFrame = watchFirstFrame({
      stream,
      isDestroyed: () => binding.destroyed,
      onReady: () => {
        if (binding.destroyed || !isCurrentEngine?.(stream)) return;
        binding.mediaReady = true;
        const { player, video } = applyOutputMute();
        const streamType = streamTypeForPlayer(player) || "hls";
        stream.streamType = streamType;
        if (video) onCommittedMediaReady?.(stream, video);
        onCommittedStream?.(streamType);
        settleStartup(true);
      },
    });
    binding.reconcile();

    return {
      ok: true,
      type: "ha_experimental",
      engine: stream,
      slot,
      startupReady,
    };
  };

  return {
    prepare,
    release,
    tryMount,
    updateHass,
  };
}
