import {
  createHaHlsPlayerElement,
  ensureHaCameraPlaybackElements,
  findActiveHaCameraStreamVideo,
} from "../../integrations/home-assistant/playback.js";
import {
  createHaDirectPlaybackDiagnostic,
  watchHaHlsStartupDiagnostic,
} from "../../integrations/home-assistant/playback-diagnostics.js";
import { createHaDirectWebRtcPlayback } from "../../integrations/home-assistant/webrtc-playback.js";

const HA_DIRECT_HLS_START_WAIT_MS = 8000;
const HA_DIRECT_UPGRADE_WAIT_MS = 8000;
const HA_DIRECT_VISIBLE_STYLE =
  "position:absolute;inset:0;z-index:1;width:100%;height:100%;display:block;background:var(--c-bg-deep)";
const HA_DIRECT_PENDING_UPGRADE_STYLE =
  "position:absolute;inset:0;z-index:0;width:100%;height:100%;display:block;pointer-events:none;background:var(--c-bg-deep)";

const unavailableState = () => ({
  loading: false,
  fallbackVisible: false,
  refreshFallbackImage: false,
});

const failedState = () => ({
  loading: false,
  fallbackVisible: true,
  refreshFallbackImage: true,
});

const readyState = (nativeControls = false) => ({
  shouldApply: true,
  loading: false,
  fallbackVisible: false,
  refreshFallbackImage: false,
  enableNativeControls: nativeControls,
});

const removeNode = (node) => {
  try {
    node?.remove?.();
  } catch (_) {}
};

export function createHaDirectMounter({
  getHass,
  getStreamMuted,
  getRotateOverlayActive,
  isCurrentEngine,
  waitForStreamStart,
  assignCommittedEngine,
  onCommittedMediaReady,
  onCommittedStream,
  applyResolvedStreamUiState,
  startLoadingFallbackRefresh,
  setLiveNativeControls,
  scheduleResumeLive,
  scopeKey,
  preparePlaybackElements = ensureHaCameraPlaybackElements,
  createPlaybackDiagnostic = createHaDirectPlaybackDiagnostic,
  createUpgradePlayback = createHaDirectWebRtcPlayback,
}) {
  const ownedSessions = new WeakSet();

  const prepare = () => {
    try {
      return preparePlaybackElements?.() ?? false;
    } catch (_) {
      return false;
    }
  };

  const release = (engine) => {
    if (!engine || engine.type !== "ha_direct") return;
    if (ownedSessions.has(engine)) {
      engine.destroy?.();
      return;
    }
    // The separate two-way-talk mounter still owns its own HA Direct engine.
    engine.destroy?.();
  };

  const tryMount = async (slot, startup = null, options = {}) => {
    const entity = String(options.entity || "").trim();
    const commit = options.commit !== false;
    const diagnostic =
      options.playbackDiagnostic ||
      createPlaybackDiagnostic?.({
        entity,
        requestedStreamType: startup?.streamType || "",
      }) || { mark: () => {}, finish: () => {} };

    diagnostic.mark("playback-elements-prepare-start");
    const playbackPreparation = prepare();
    if (playbackPreparation?.then) await playbackPreparation;
    diagnostic.mark("playback-elements-prepare-finished");

    const hass = getHass?.();
    if (!entity) {
      diagnostic.finish("missing-entity");
      return false;
    }
    if (!hass?.states?.[entity]) {
      if (commit) applyResolvedStreamUiState?.(unavailableState());
      diagnostic.finish("entity-unavailable");
      return false;
    }

    diagnostic.mark("hls-element-create-start");
    const hlsPlayer = createHaHlsPlayerElement({
      hass,
      entity,
      controls: false,
      muted: options.muted ?? getStreamMuted?.() ?? true,
      defaultMuted: options.defaultMuted,
      fitMode: "contain",
      styleText: options.styleText || HA_DIRECT_VISIBLE_STYLE,
    });
    if (!hlsPlayer) {
      diagnostic.finish("hls-element-unavailable");
      return false;
    }
    diagnostic.mark("hls-element-created");

    let destroyed = false;
    let hlsReady = false;
    let activeVideo = null;
    let upgradePlayback = null;
    let upgradeAttempted = false;
    let stopFallbackRefresh = () => {};
    let stopHlsDiagnostic = () => {};
    let hlsRecoveryAbortController = null;
    const hlsAbortController = new AbortController();
    const upgradeAbortController = new AbortController();

    const session = {
      type: "ha_direct",
      streamType: "hls",
      entity,
      get video() {
        return (
          activeVideo ||
          upgradePlayback?.engine?.video ||
          findActiveHaCameraStreamVideo(hlsPlayer)
        );
      },
      get muted() {
        return Boolean(session.video?.muted ?? hlsPlayer.muted);
      },
      set muted(value) {
        hlsPlayer.muted = Boolean(value);
        if (session.video) session.video.muted = Boolean(value);
        if (upgradePlayback?.engine?.video) {
          upgradePlayback.engine.video.muted = Boolean(value);
        }
      },
      get defaultMuted() {
        return Boolean(session.video?.defaultMuted ?? hlsPlayer.defaultMuted);
      },
      set defaultMuted(value) {
        hlsPlayer.defaultMuted = Boolean(value);
        if (session.video) session.video.defaultMuted = Boolean(value);
        if (upgradePlayback?.engine?.video) {
          upgradePlayback.engine.video.defaultMuted = Boolean(value);
        }
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        hlsAbortController.abort();
        upgradeAbortController.abort();
        stopFallbackRefresh();
        stopHlsDiagnostic();
        hlsRecoveryAbortController?.abort();
        hlsRecoveryAbortController = null;
        hlsPlayer.removeEventListener?.("streams", onHlsStreams);
        void upgradePlayback?.engine?.destroy?.();
        removeNode(upgradePlayback?.engine?.video);
        removeNode(hlsPlayer);
        upgradePlayback = null;
        activeVideo = null;
      },
    };
    ownedSessions.add(session);

    const isActive = () =>
      !destroyed && (!commit || isCurrentEngine?.(session) === true);

    const stopHlsRecovery = () => {
      hlsRecoveryAbortController?.abort();
      hlsRecoveryAbortController = null;
    };

    const recoverHls = () => {
      if (!isActive() || session.streamType !== "hls") return;
      stopHlsRecovery();
      const recoveryAbortController = new AbortController();
      hlsRecoveryAbortController = recoveryAbortController;
      void waitForStreamStart(hlsPlayer, HA_DIRECT_HLS_START_WAIT_MS, {
        minCurrentTime: 0.05,
        minDecodedFrames: 2,
        requireReadyState: 2,
        strict: true,
        requirePresentedFrame: true,
        abortSignal: recoveryAbortController.signal,
        resolveVideo: () => findActiveHaCameraStreamVideo(hlsPlayer),
      }).then((ready) => {
        if (
          ready === true &&
          hlsRecoveryAbortController === recoveryAbortController
        ) {
          applyHlsReady();
        }
      });
    };

    const applyHlsFailure = () => {
      if (!isActive() || session.streamType !== "hls") return;
      hlsReady = false;
      onCommittedStream?.("snapshot");
      applyResolvedStreamUiState?.(failedState());
      recoverHls();
    };

    const applyReady = (streamType) => {
      if (!isActive()) return false;
      session.streamType = streamType;
      stopFallbackRefresh();
      onCommittedStream?.(streamType);
      applyResolvedStreamUiState?.(
        readyState(getRotateOverlayActive?.() === true),
      );
      if (getRotateOverlayActive?.()) setLiveNativeControls?.(true);
      return true;
    };

    const startUpgrade = () => {
      if (!commit || !isActive() || upgradeAttempted) return;
      upgradeAttempted = true;
      upgradePlayback = createUpgradePlayback?.({
        hass,
        entity,
        muted: options.muted ?? getStreamMuted?.() ?? true,
        controls: false,
        scopeKey,
        onConnectionLost: (reason) => {
          if (
            isActive() &&
            session.streamType === "webrtc" &&
            upgradePlayback?.engine
          ) {
            scheduleResumeLive?.(reason);
          }
        },
        diagnostic,
      });
      if (!upgradePlayback?.engine?.video) {
        upgradePlayback = null;
        diagnostic.finish("hls-ready-upgrade-unavailable");
        return;
      }

      const upgradeEngine = upgradePlayback.engine;
      upgradeEngine.video.style.cssText = HA_DIRECT_PENDING_UPGRADE_STYLE;
      slot.appendChild(upgradeEngine.video);
      diagnostic.mark("upgrade-video-mounted");

      void (async () => {
        diagnostic.mark("upgrade-signaling-start");
        const signalingStarted = await upgradePlayback.start();
        diagnostic.mark("upgrade-signaling-finished", { signalingStarted });
        if (!signalingStarted || !isActive()) {
          void upgradeEngine.destroy?.();
          removeNode(upgradeEngine.video);
          if (upgradePlayback?.engine === upgradeEngine) upgradePlayback = null;
          if (isActive()) diagnostic.finish("hls-ready-upgrade-failed");
          return;
        }

        diagnostic.mark("upgrade-readiness-wait-start");
        const ready = await Promise.race([
          waitForStreamStart(upgradeEngine, HA_DIRECT_UPGRADE_WAIT_MS, {
            strict: true,
            minCurrentTime: 0.05,
            minDecodedFrames: 1,
            requireReadyState: 2,
            requirePresentedFrame: true,
            abortSignal: upgradeAbortController.signal,
            resolveVideo: () => upgradeEngine.video,
          }),
          upgradeEngine.failure,
        ]);
        diagnostic.mark("upgrade-readiness-wait-finished", {
          ready: ready === true,
        });
        if (!isActive() || ready !== true) {
          void upgradeEngine.destroy?.();
          removeNode(upgradeEngine.video);
          if (upgradePlayback?.engine === upgradeEngine) upgradePlayback = null;
          if (isActive()) diagnostic.finish("hls-ready-upgrade-failed");
          return;
        }

        upgradeEngine.markStarted?.();
        activeVideo = upgradeEngine.video;
        upgradeEngine.video.style.cssText =
          options.styleText || HA_DIRECT_VISIBLE_STYLE;
        stopHlsDiagnostic();
        stopHlsRecovery();
        hlsPlayer.removeEventListener?.("streams", onHlsStreams);
        removeNode(hlsPlayer);
        onCommittedMediaReady?.(session, activeVideo);
        applyReady("webrtc");
        diagnostic.finish("upgrade-ready");
      })();
    };

    const applyHlsReady = () => {
      if (!isActive() || session.streamType !== "hls") return false;
      const video = findActiveHaCameraStreamVideo(hlsPlayer);
      if (!video) return false;
      hlsReady = true;
      activeVideo = video;
      stopHlsRecovery();
      onCommittedMediaReady?.(session, video);
      applyReady("hls");
      diagnostic.mark("hls-ready");
      startUpgrade();
      return true;
    };

    function onHlsStreams(event) {
      if (event?.detail?.hasVideo === false) applyHlsFailure();
      else if (!hlsReady) recoverHls();
    }

    hlsPlayer.addEventListener?.("streams", onHlsStreams);
    slot.innerHTML = "";
    slot.appendChild(hlsPlayer);
    diagnostic.mark("hls-element-mounted");

    if (!commit) {
      diagnostic.finish("hls-mounted-uncommitted");
      return { ok: true, type: "hls", engine: hlsPlayer, slot };
    }

    assignCommittedEngine?.(session);
    stopFallbackRefresh = startLoadingFallbackRefresh?.() || (() => {});
    stopHlsDiagnostic = watchHaHlsStartupDiagnostic({
      player: hlsPlayer,
      diagnostic,
      resolveVideo: findActiveHaCameraStreamVideo,
    });
    if (getRotateOverlayActive?.()) setLiveNativeControls?.(true);

    const startupReady = (async () => {
      diagnostic.mark("hls-readiness-wait-start");
      const ready = await waitForStreamStart(
        hlsPlayer,
        HA_DIRECT_HLS_START_WAIT_MS,
        {
          minCurrentTime: 0,
          minDecodedFrames: 0,
          requireReadyState: 2,
          strict: false,
          requirePresentedFrame: false,
          abortSignal: hlsAbortController.signal,
          resolveVideo: () => findActiveHaCameraStreamVideo(hlsPlayer),
        },
      );
      diagnostic.mark("hls-readiness-wait-finished", { ready });
      if (!isActive()) return false;
      if (!ready || !applyHlsReady()) {
        diagnostic.mark("hls-startup-failed");
        applyHlsFailure();
        return false;
      }
      return hlsReady;
    })();

    return { ok: true, type: "hls", engine: session, slot, startupReady };
  };

  return { prepare, release, tryMount };
}
