import { DEFAULT_CAMERA_CONNECTION_TYPE } from "../../constants.js";
import {
  DEVICE_PROFILE,
  mkCamState,
  normalizeCameraConnectionType,
} from "../../helpers.js";
import { createGo2RtcResolver } from "../../integrations/frigate/go2rtc-resolver.js";
import { flattenCameraMembers } from "../camera-groups/model.js";
import { createHaDirectTwoWayTalkBackchannel } from "../../integrations/home-assistant/two-way-talk-backchannel.js";
import { createHaDirectTwoWayTalkMounter } from "../../integrations/home-assistant/two-way-talk-mounter.js";
import { waitForMediaStart } from "../../shared/media/first-frame.js";
import { attachContainedVideoFit } from "../../shared/media/video-fit.js";
import { createGo2RtcTwoWayTalkBackchannel } from "../two-way-talk/go2rtc-backchannel.js";
import { createCatalystHlsMounter } from "./catalyst-hls-mounter.js";
import { createGo2RtcMounter } from "./go2rtc-mounter.js";
import { createGo2RtcRaceMounter } from "./go2rtc-race-mounter.js";
import { createHaDirectMounter } from "./ha-direct-mounter.js";
import {
  adoptMountedAttemptResult,
  isMountTokenCurrent,
} from "./mount-result.js";

const DEFAULT_FACTORIES = Object.freeze({
  createGo2RtcResolver,
  createGo2RtcTwoWayTalkBackchannel,
  createCatalystHlsMounter,
  createGo2RtcMounter,
  createHaDirectMounter,
  createHaDirectTwoWayTalkMounter,
  createHaDirectTwoWayTalkBackchannel,
  createGo2RtcRaceMounter,
});

export const createLiveTransportControllers = (
  card,
  {
    deviceProfile = DEVICE_PROFILE,
    factories = DEFAULT_FACTORIES,
  } = {},
) => {
  const resolvedFactories = { ...DEFAULT_FACTORIES, ...factories };
  const waitForStreamStart = (
    streamEl,
    timeoutMs = 3500,
    options = {},
  ) =>
    waitForMediaStart(streamEl, timeoutMs, {
      ...options,
      resolveVideo:
        typeof options.resolveVideo === "function"
          ? options.resolveVideo
          : (root) => card._findVideoDeep(root),
    });
  const go2rtcResolver = resolvedFactories.createGo2RtcResolver({
    getHass: () => card._hass,
    getConfig: () => card._config,
    getActiveEntity: () => card._activeCam?.entity || "",
    getCamCache: () => card._camCache,
    defaultConnectionType: DEFAULT_CAMERA_CONNECTION_TYPE,
    normalizeCameraConnectionType,
    createCameraState: mkCamState,
    discoverEntity: async (entity) => {
      await card._discoverOne(entity);
    },
    supportsNativeHlsPlayback: () => card._supportsNativeHlsPlayback(),
  });
  const go2rtcTwoWayTalkBackchannel =
    resolvedFactories.createGo2RtcTwoWayTalkBackchannel({
      resolveWebSocketUrl: (entity) =>
        go2rtcResolver.websocketUrlForEntity(entity),
    });
  const go2rtcMounter = resolvedFactories.createGo2RtcMounter({
    resolver: go2rtcResolver,
    getStreamMuted: () => card._streamMuted,
    waitForStreamStart,
    attachVideoFit: attachContainedVideoFit,
    assignCommittedEngine: (engine) => card._assignLiveEngine(engine),
    onCommittedStream: (type) => {
      card._setActiveStreamType(type);
      card._setStreamLoading(false);
      card._setStreamFallbackVisible(false);
      card._haDirectMounter?.schedulePreloadDeckAfterPaint?.();
    },
    scheduleResumeLive: (reason) => card._scheduleResumeLive(reason),
    isFirefox: () => card._isFirefox(),
    scopeKey: card,
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
  const haDirectMounter = resolvedFactories.createHaDirectMounter({
    getHass: () => card._hass,
    getPreferredStreamType: () => card._preferredStreamType(),
    getStreamMuted: () => card._streamMuted,
    getRotateOverlayActive: () => card._rotateOverlayActive,
    isCurrentEngine: (streamEl) => card._engine === streamEl,
    waitForStreamStart,
    assignCommittedEngine: (engine, options) =>
      card._assignLiveEngine(engine, options),
    onCommittedMediaReady: (engine, video) => {
      const liveEngineHost = card._$("#engine");
      card._attachMainLiveVideoZoom(engine, video, {
        host: liveEngineHost,
        interactionTarget: liveEngineHost,
      });
    },
    onCommittedStream: (type) => {
      card._setActiveStreamType(type);
      card._setStreamLoading(false);
      card._setStreamFallbackVisible(false);
    },
    applyResolvedStreamUiState: (streamState) =>
      card._applyResolvedStreamUiState(streamState),
    startLoadingFallbackRefresh: (options) =>
      card._startStreamFallbackLoadingRefresh(options),
    stopLoadingFallbackRefresh: () =>
      card._stopStreamFallbackLoadingRefresh(),
    setLiveNativeControls: (enabled) => card._setLiveNativeControls(enabled),
    scheduleResumeLive: (reason) => card._scheduleResumeLive(reason),
    shouldUseNativeHls: () =>
      deviceProfile.isIOS === true ||
      card._isSafari(),
    getPreloadEntities: () =>
      flattenCameraMembers(card._config?.cameras)
        .map((camera) => String(camera?.entity || "").trim())
        .filter(
          (entity) =>
            entity &&
            card._hass?.states?.[entity] &&
            !card._shouldUseGo2RtcForEntity(entity) &&
            card._frigateCameraRuntimeController?.isSuspended?.(entity) !== true,
        ),
    getActiveEntity: () =>
      card._engine?.type === "ha_direct"
        ? card._activeGroupMemberOverride || card._activeCam?.entity || ""
        : "",
    getSelectedEntity: () =>
      card._activeGroupMemberOverride || card._activeCam?.entity || "",
    isMountAttemptCurrent: (mountToken, entity) =>
      card._mountSeq === mountToken &&
      (card._activeGroupMemberOverride || card._activeCam?.entity || "") ===
        entity,
    getPreloadHost: () =>
      card._liveGraceController?.getHaDirectDeckHost?.() ||
      card._liveGraceController?.getHaDirectWebRtcDeckHost?.() ||
      null,
    shouldPreload: () =>
      deviceProfile.isCatalyst !== true &&
      card.isConnected === true &&
      card._started === true,
    hasRetainedEngine: (entity) =>
      card._liveGraceController?.hasRetainedHaDirectEngine?.(entity) === true,
    retainPreloadedEngine: (entity, engine) =>
      card._liveGraceController?.retainHaDirectEngine?.(entity, engine) === true,
    adoptEditorPreloadedEngine: (entity) => {
      const transfer = card._editorLiveHandoffController?.take?.(
        entity,
        "webrtc",
        "ha_direct",
      );
      if (!transfer?.engine) return false;
      const retained = card._liveGraceController?.retainHaDirectEngine?.(
        entity,
        transfer.engine,
        { allowPlaybackResume: true },
      );
      if (retained === true) {
        transfer.commit?.();
        return true;
      }
      transfer.reject?.();
      return false;
    },
    syncRetainedEntities: (entities) =>
      card._liveGraceController?.syncRetainedHaDirectEntities?.(entities),
    scopeKey: card,
  });
  const catalystHlsMounter = resolvedFactories.createCatalystHlsMounter({
    getHass: () => card._hass,
    getStreamMuted: () => card._streamMuted,
    getRotateOverlayActive: () => card._rotateOverlayActive,
    isCurrentEngine: (streamEl) => card._engine === streamEl,
    waitForStreamStart,
    assignCommittedEngine: (engine, options) =>
      card._assignLiveEngine(engine, options),
    onCommittedMediaReady: (engine, video) => {
      const liveEngineHost = card._$("#engine");
      card._attachMainLiveVideoZoom(engine, video, {
        host: liveEngineHost,
        interactionTarget: liveEngineHost,
      });
    },
    onCommittedStream: (type) => {
      card._setActiveStreamType(type);
      card._setStreamLoading(false);
      card._setStreamFallbackVisible(false);
    },
    onPendingStream: () => card._setActiveStreamType("--"),
    applyResolvedStreamUiState: (streamState) =>
      card._applyResolvedStreamUiState(streamState),
    startLoadingFallbackRefresh: (options) =>
      card._startStreamFallbackLoadingRefresh(options),
    stopLoadingFallbackRefresh: () =>
      card._stopStreamFallbackLoadingRefresh(),
    setLiveNativeControls: (enabled) => card._setLiveNativeControls(enabled),
    scheduleResumeLive: (reason) => card._scheduleResumeLive(reason),
    getPreloadEntities: () =>
      flattenCameraMembers(card._config?.cameras)
        .map((camera) => String(camera?.entity || "").trim())
        .filter(
          (entity) =>
            entity &&
            card._hass?.states?.[entity] &&
            !card._shouldUseGo2RtcForEntity(entity) &&
            card._frigateCameraRuntimeController?.isSuspended?.(entity) !== true,
        ),
    getActiveEntity: () =>
      card._activeGroupMemberOverride || card._activeCam?.entity || "",
    getPreloadHost: () =>
      card._liveGraceController?.getCatalystHlsDeckHost?.() || null,
    shouldPreload: () =>
      deviceProfile.isCatalyst === true &&
      card.isConnected === true &&
      card._started === true,
    hasRetainedEngine: (entity) =>
      card._liveGraceController?.hasRetainedCatalystHlsEngine?.(entity) === true,
    retainPreloadedEngine: (entity, engine) =>
      card._liveGraceController?.retainCatalystHlsEngine?.(entity, engine) ===
      true,
  });
  const haDirectTwoWayTalkMounter =
    resolvedFactories.createHaDirectTwoWayTalkMounter({
      getHass: () => card._hass,
      getStreamMuted: () => card._streamMuted,
      waitForStreamStart,
      attachVideoFit: attachContainedVideoFit,
      assignCommittedEngine: (engine) => card._assignLiveEngine(engine),
      onCommittedStream: (type) => {
        card._setActiveStreamType(type);
        card._setStreamLoading(false);
        card._setStreamFallbackVisible(false);
      },
      scheduleResumeLive: (reason) => card._scheduleResumeLive(reason),
      scopeKey: card,
  });
  const haDirectTwoWayTalkBackchannel =
    resolvedFactories.createHaDirectTwoWayTalkBackchannel({
      getHass: () => card._hass,
      mountIncomingAudio: (audio) => {
        if (!audio || !card.shadowRoot) return null;
        audio.dataset.fvcTwoWayTalkAudio = "";
        card.shadowRoot.appendChild(audio);
        return () => audio.remove?.();
      },
    });
  const go2rtcRaceMounter = resolvedFactories.createGo2RtcRaceMounter({
    mounter: go2rtcMounter,
    isMobile: deviceProfile.isMobile,
    resolveConnectionType: (entity) => card._cameraConnectionType(entity),
    getPendingMountDestroyers: () => card._pendingMountDestroyers || [],
    setPendingMountDestroyers: (pendingDestroyers) => {
      card._pendingMountDestroyers = pendingDestroyers;
    },
    isMountTokenCurrent: (mountToken) =>
      isMountTokenCurrent({ mountToken, mountSeq: card._mountSeq }),
    adoptMountedAttempt: (slot, winner, options = {}) =>
      adoptMountedAttemptResult({
        targetSlot: slot,
        result: winner,
        preservePendingSlots: options.preservePendingSlots === true,
        streamMuted: card._streamMuted,
        rotateOverlayActive: card._rotateOverlayActive,
        assignEngine: (engine) => card._assignLiveEngine(engine),
        setEngineMountedMuted: (muted) => {
          card._engineMountedMuted = muted;
        },
        setActiveStreamType: (type) => card._setActiveStreamType(type),
        setStreamLoading: (loading) => card._setStreamLoading(loading),
        setStreamFallbackVisible: (visible) =>
          card._setStreamFallbackVisible(visible),
        setLiveNativeControls: (enabled) =>
          card._setLiveNativeControls(enabled),
      }),
    waitForStreamStart,
    isCurrentWinnerEngine: (engine) => card._engine === engine,
    getPendingWebRtcTakeoverTimer: () => card._pendingWebRTCTakeoverTimer,
    setPendingWebRtcTakeoverTimer: (timer) => {
      card._pendingWebRTCTakeoverTimer = timer;
    },
  });

  return {
    _go2rtcResolver: go2rtcResolver,
    _go2rtcTwoWayTalkBackchannel: go2rtcTwoWayTalkBackchannel,
    _go2rtcMounter: go2rtcMounter,
    _catalystHlsMounter: catalystHlsMounter,
    _haDirectMounter: haDirectMounter,
    _haDirectTwoWayTalkMounter: haDirectTwoWayTalkMounter,
    _haDirectTwoWayTalkBackchannel: haDirectTwoWayTalkBackchannel,
    _go2rtcRaceMounter: go2rtcRaceMounter,
  };
};
