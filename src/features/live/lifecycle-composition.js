import {
  LIVE_SWITCH_GRACE_MAX,
  LIVE_SWITCH_GRACE_MS,
  MAX_CAMERAS,
} from "../../constants.js";
import { buildEditorLiveHandoffKey } from "../editor-preview/context.ctrl.js";
import { attachContainedVideoFit } from "../../shared/media/video-fit.js";
import {
  createEditorLiveHandoffController,
  createLiveMountController,
} from "./mount-controller.js";
import { createLiveGraceController } from "./live-grace-controller.js";

const DEFAULT_FACTORIES = Object.freeze({
  createLiveGraceController,
  createEditorLiveHandoffController,
  createLiveMountController,
});

export const createLiveLifecycleControllers = (
  card,
  {
    factories = DEFAULT_FACTORIES,
    windowTarget = window,
  } = {},
) => {
  const resolvedFactories = { ...DEFAULT_FACTORIES, ...factories };
  const liveGraceController = resolvedFactories.createLiveGraceController({
    graceMs: LIVE_SWITCH_GRACE_MS,
    graceMax: LIVE_SWITCH_GRACE_MAX,
    haDirectRetainedMax: MAX_CAMERAS,
    catalystRetainedMax: MAX_CAMERAS,
    getShadowRoot: () => card.shadowRoot,
    getScopeKey: () => card,
    getPendingMountDestroyers: () => card._pendingMountDestroyers || [],
    setPendingMountDestroyers: (pendingDestroyers) => {
      card._pendingMountDestroyers = pendingDestroyers;
    },
    getPendingWebRtcTakeoverTimer: () => card._pendingWebRTCTakeoverTimer,
    setPendingWebRtcTakeoverTimer: (timer) => {
      card._pendingWebRTCTakeoverTimer = timer;
    },
    clearRotateOverlayAudioSync: () => card._clearRotateOverlayAudioSync(),
    clearRotateVideoFullscreenStyle: () =>
      card._clearRotateVideoFullscreenStyle(),
    getEngine: () => card._engine,
    setEngine: (engine, options) => card._assignLiveEngine(engine, options),
    getActiveStreamType: () => card._activeStreamType,
    getStreamMuted: () => card._streamMuted,
    setEngineMountedMuted: (muted) => {
      card._engineMountedMuted = muted;
    },
    getRotateOverlayActive: () => card._rotateOverlayActive,
    attachVideoFit: attachContainedVideoFit,
    setActiveStreamType: (type) => card._setActiveStreamType(type),
    setStreamLoading: (loading) => card._setStreamLoading(loading),
    setStreamFallbackVisible: (visible, refreshImage = false) =>
      card._setStreamFallbackVisible(visible, refreshImage),
    setLiveNativeControls: (enabled) => card._setLiveNativeControls(enabled),
    releaseHaDirectEngine: (engine) =>
      engine?.catalystHls === true
        ? card._catalystHlsMounter?.release?.(engine)
        : card._haDirectMounter?.release?.(engine),
    adoptHaDirectWebRtcEngine: (engine) =>
      card._haDirectMounter?.adoptRetainedWebRtcEngine?.(engine),
    isHaDirectHlsEngineReusable: (engine) =>
      card._haDirectMounter?.isRetainableHlsEngine?.(engine) === true,
    suspendHaDirectHlsEngine: (engine) =>
      card._haDirectMounter?.suspendRetainedHlsEngine?.(engine) === true,
    adoptHaDirectHlsEngine: (slot, engine) =>
      card._haDirectMounter?.adoptRetainedHlsEngine?.(slot, engine) === true,
    isCatalystHlsEngineReusable: (engine) =>
      card._catalystHlsMounter?.isRetainableEngine?.(engine) === true,
    suspendCatalystHlsEngine: (engine) =>
      card._catalystHlsMounter?.suspendRetainedEngine?.(engine) === true,
    adoptCatalystHlsEngine: (slot, engine) =>
      card._catalystHlsMounter?.adoptRetainedEngine?.(slot, engine) === true,
    releaseCatalystHlsEngine: (engine) =>
      card._catalystHlsMounter?.release?.(engine),
    scheduleResumeLive: (reason) => card._scheduleResumeLive(reason),
    resetMseDiagnostics: (connectedAt) => {
      card._mseConnectAt = connectedAt;
      card._mseLastChunkAt = 0;
      card._mseChunkCount = 0;
    },
    markMseChunk: (chunkAt) => {
      card._mseLastChunkAt = chunkAt;
      card._mseChunkCount += 1;
    },
  });
  const editorLiveHandoffController =
    resolvedFactories.createEditorLiveHandoffController({
      getState: () => {
        const entity =
          card._activeGroupMemberOverride || card._activeCam?.entity || "";
        return {
          activeStreamType: card._currentLiveStreamHint(),
          engine: card._engine,
          entity,
          hasSlot: Boolean(card._$("#engine")),
          hostConnected: card.isConnected === true,
          mountInProgress: card._mountInProgress,
          previewPageActive: card._isPreviewPageActive(),
          started: card._started,
          twoWayTalkActive: Boolean(
            card._twoWayTalkStarting || card._twoWayTalkSession,
          ),
          useGo2Rtc: card._shouldUseGo2RtcForEntity(entity),
          viewMode: card._viewMode,
        };
      },
      getContext: () => card._editorPreviewController.liveHandoffContext(),
      getIdentityKey: (entity) =>
        buildEditorLiveHandoffKey({
          connectionType:
            card._livePlaybackConnectionType?.(entity) ||
            card._cameraConnectionType(entity),
          entity,
          pathname: windowTarget.location?.pathname || "",
        }),
      getConnectionType: (entity) =>
        card._shouldUseGo2RtcForEntity(entity)
          ? "frigate_go2rtc"
          : "ha_direct",
      isEditorLifecycleActive: () =>
        card._editorPreviewController.isEditorLifecycleActive(),
      requestHandoff: (request) =>
        card._editorPreviewController.requestLiveHandoff(request),
      isEngineReusable: (engine, streamType, connectionType) =>
        connectionType === "ha_direct"
          ? engine?.haDirectProvider === true
            ? card._haDirectMounter?.isRetainableHlsEngine?.(engine) === true
            : streamType === "hls"
            ? engine?.catalystHls === true &&
              card._catalystHlsMounter?.isRetainableEngine?.(engine) === true
            : liveGraceController.isHaDirectWebRtcEngineTransferable(engine)
          : streamType === "mse"
            ? liveGraceController.isMseEngineReusable(engine)
            : liveGraceController.isWebRtcEngineReusable(engine),
      detachEngine: (engine, streamType, connectionType) => {
        if (
          connectionType === "ha_direct" &&
          (engine?.haDirectProvider === true
            ? card._haDirectMounter?.detachProviderForHandoff?.(engine)
            : streamType === "hls"
            ? engine?.catalystHls === true &&
              card._catalystHlsMounter?.detachForHandoff?.(engine)
            : card._haDirectMounter?.detachWebRtcForHandoff?.(engine)) !== true
        ) {
          return false;
        }
        card._assignLiveEngine(null, { retainPrevious: true });
        return true;
      },
      getRetainedEngine: (entity, streamType, connectionType) =>
        connectionType === "ha_direct" &&
        (streamType === "webrtc" || streamType === "hls")
          ? liveGraceController.peekRetainedHaDirectEngineForHandoff?.(
              entity,
              streamType,
            ) || null
          : null,
      detachRetainedEngine: (
        entity,
        engine,
        streamType,
        connectionType,
      ) => {
        if (
          connectionType !== "ha_direct" ||
          (streamType !== "webrtc" && streamType !== "hls")
        ) {
          return false;
        }
        const taken =
          liveGraceController.takeRetainedHaDirectEngineForHandoff?.(
            entity,
            engine,
            streamType,
          ) || null;
        if (taken !== engine) return false;
        const detached = engine?.haDirectProvider === true
          ? card._haDirectMounter?.detachProviderForHandoff?.(engine)
          : card._haDirectMounter?.detachWebRtcForHandoff?.(engine);
        if (detached === true) {
          return true;
        }
        const restored = liveGraceController.retainHaDirectEngine?.(
          entity,
          engine,
          { allowPlaybackResume: true },
        );
        if (restored !== true) card._haDirectMounter?.release?.(engine);
        return false;
      },
      restoreRetainedEngine: (
        entity,
        engine,
        streamType,
        connectionType,
      ) => {
        if (
          connectionType !== "ha_direct" ||
          (streamType !== "webrtc" && streamType !== "hls")
        ) {
          return false;
        }
        if (
          engine?.haDirectProvider === true &&
          card._haDirectMounter?.adoptTransferredProvider?.(engine) !== true
        ) {
          return false;
        }
        const restored = liveGraceController.retainHaDirectEngine?.(
          entity,
          engine,
          { allowPlaybackResume: true },
        );
        if (restored !== true) card._haDirectMounter?.release?.(engine);
        return restored === true;
      },
      setStreamLoading: (loading) => card._setStreamLoading(loading),
      setStreamFallbackVisible: (visible, refreshImage = false) =>
        card._setStreamFallbackVisible(visible, refreshImage),
      scheduleResumeLive: (reason) => card._scheduleResumeLive(reason),
      adoptEngine: (engine, streamType, connectionType) => {
        const slot = card._$("#engine");
        if (!slot) return false;
        const adopted =
          connectionType === "ha_direct"
            ? engine?.haDirectProvider === true
              ? liveGraceController.adoptGraceHaDirectEngine(slot, engine, {
                  allowPlaybackResume: true,
                })
              : streamType === "hls"
              ? engine?.catalystHls === true &&
                card._catalystHlsMounter?.adoptRetainedEngine?.(slot, engine)
              : liveGraceController.adoptGraceHaDirectEngine(slot, engine, {
                  allowPlaybackResume: true,
                })
            : streamType === "mse"
              ? liveGraceController.adoptGraceMseEngine(slot, engine)
              : liveGraceController.adoptGraceWebRtcEngine(slot, engine);
        if (adopted) card._dashboardLiveGraceActive = false;
        return adopted;
      },
      syncLivePresentation: () => card._cameraGroupLiveController?.sync?.(),
    });
  const liveMountController = resolvedFactories.createLiveMountController({
    getSlot: () => card.shadowRoot.querySelector("#engine"),
    isPreviewPageActive: () => card._isPreviewPageActive(),
    getViewMode: () => card._viewMode,
    isGridModeAvailable: () => card._isGridModeAvailable(),
    getMountInProgress: () => card._mountInProgress,
    getMountTargetEntity: () => card._mountTargetEntity,
    getMountState: () => ({
      mountSeq: card._mountSeq,
      mountInProgress: card._mountInProgress,
      mountStartedAt: card._mountStartedAt,
      mountTargetEntity: card._mountTargetEntity,
    }),
    applyMountTrackingState: (nextState) =>
      card._applyMountTrackingState(nextState),
    mountGridEngine: () =>
      card._gridMediaController.mountGridEngine(card._$("#grid-engine")),
    cleanupEngine: () => card._cleanupEngine(),
    getStreamMuted: () => card._streamMuted,
    setEngineMountedMuted: (muted) => {
      card._engineMountedMuted = muted;
    },
    liveGraceController,
    getMountSeq: () => card._mountSeq,
    getPendingMountDestroyers: () => card._pendingMountDestroyers,
    setPendingMountDestroyers: (pendingDestroyers) => {
      card._pendingMountDestroyers = pendingDestroyers;
    },
    catalystHlsMounter: card._catalystHlsMounter,
    haDirectMounter: card._haDirectMounter,
    haDirectTwoWayTalkMounter: card._haDirectTwoWayTalkMounter,
    go2rtcRaceMounter: card._go2rtcRaceMounter,
    preferredStreamType: () => card._preferredStreamType(),
    setActiveStreamType: (type) => card._setActiveStreamType(type),
    setStreamLoading: (loading) => card._setStreamLoading(loading),
    setStreamFallbackVisible: (visible, refreshImage = false) =>
      card._setStreamFallbackVisible(visible, refreshImage),
    scheduleResumeLive: (reason) => card._scheduleResumeLive(reason),
    resolveUseGo2Rtc: (entity) => card._shouldUseGo2RtcForEntity(entity),
    shouldUseCatalystHls: () => card._isCatalyst?.() === true,
    isCameraRuntimeSuspended: (entity) =>
      card._frigateCameraRuntimeController?.isSuspended?.(entity) === true,
    applyCameraSuspendedState: (entity) =>
      card._frigateCameraRuntimeController?.applySuspendedMountState?.(entity),
    takeEditorLiveHandoff: ({ entity, streamType, connectionType }) =>
      editorLiveHandoffController.take(entity, streamType, connectionType),
  });

  return {
    _liveGraceController: liveGraceController,
    _editorLiveHandoffController: editorLiveHandoffController,
    _liveMountController: liveMountController,
  };
};
