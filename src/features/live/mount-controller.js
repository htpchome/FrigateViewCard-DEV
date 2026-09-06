import {
  applyMountWatchdogTimeout,
  beginMountTracking,
  clearMountTrackingIfCurrent,
  resolveGraceMsePendingMountOutcome,
  resolveGraceMseReuseAction,
  resolveLiveMountEntryAction,
  resolveLiveMountTransportPlan,
  resolveLiveMountUiState,
  shouldRunMountWatchdog,
} from "./mount-lifecycle.js";
import {
  isMountTokenCurrent,
  resolveGraceMseMountResult,
} from "./mount-result.js";
import {
  createGracePendingMountDestroyer,
  shouldClearPendingDestroyersForPromise,
} from "./pending-destroyers.js";
import { resolveSnapshotFallbackState } from "./stream.state.js";

const EDITOR_LIVE_HANDOFF_TYPE = "live-engine";
const FRIGATE_HANDOFF_STREAM_TYPES = new Set(["mse", "webrtc"]);
const HA_DIRECT_HANDOFF_STREAM_TYPES = new Set(["hls"]);

const isEditorLiveHandoffSupported = (connectionType, streamType) =>
  connectionType === "frigate_go2rtc"
    ? FRIGATE_HANDOFF_STREAM_TYPES.has(streamType)
    : connectionType === "ha_direct" &&
      HA_DIRECT_HANDOFF_STREAM_TYPES.has(streamType);

export function createEditorLiveHandoffController({
  getState,
  getContext,
  getIdentityKey,
  isEditorLifecycleActive,
  requestHandoff,
  isEngineReusable,
  detachEngine,
  setStreamLoading,
  setStreamFallbackVisible,
  scheduleResumeLive,
  adoptEngine,
  syncLivePresentation,
}) {
  let suspended = false;
  let returnTarget = null;
  let controller = null;

  const state = () => getState?.() || {};
  const identityKey = (entity) => getIdentityKey?.(entity) || "";

  const claim = (engine, streamType, connectionType) => {
    const current = state();
    if (
      current.engine !== engine ||
      isEngineReusable?.(engine, streamType, connectionType) !== true ||
      detachEngine?.(engine, streamType, connectionType) === false
    ) {
      return null;
    }
    engine.deactivateRecovery?.();
    suspended = true;
    setStreamLoading?.(false);
    setStreamFallbackVisible?.(true, false);
    return engine;
  };

  const reject = () => {
    suspended = false;
    if (state().hostConnected) {
      scheduleResumeLive?.("editor-handoff-rejected");
    }
  };

  const createOffer = (request = {}) => {
    const current = state();
    const entity = String(current.entity || "");
    const requestContext = String(request.context || "");
    const streamType = String(request.streamType || "").toLowerCase();
    const connectionType = String(request.connectionType || "").toLowerCase();
    const currentConnectionType = current.useGo2Rtc
      ? "frigate_go2rtc"
      : "ha_direct";
    const engine = current.engine;
    if (
      request.type !== EDITOR_LIVE_HANDOFF_TYPE ||
      !isEditorLiveHandoffSupported(connectionType, streamType) ||
      connectionType !== currentConnectionType ||
      !entity ||
      request.entity !== entity ||
      request.key !== identityKey(entity) ||
      suspended ||
      isEditorLifecycleActive?.() !== true ||
      current.started !== true ||
      current.mountInProgress ||
      current.previewPageActive ||
      current.viewMode !== "single" ||
      current.twoWayTalkActive ||
      current.activeStreamType !== streamType ||
      engine?.type !== connectionType ||
      engine?.streamType !== streamType ||
      isEngineReusable?.(engine, streamType, connectionType) !== true
    ) {
      return null;
    }

    const nextReturnTarget =
      requestContext === "config" ? returnTarget || controller : null;
    return {
      provider: controller,
      returnTarget: nextReturnTarget,
      connectionType,
      streamType,
      claim: () => claim(engine, streamType, connectionType),
      complete: () => {
        returnTarget = null;
      },
      reject,
    };
  };

  const take = (
    entity = "",
    streamType = "",
    connectionType = "frigate_go2rtc",
  ) => {
    const requestedStreamType = String(streamType || "").toLowerCase();
    const requestedConnectionType = String(
      connectionType || "",
    ).toLowerCase();
    if (
      !isEditorLiveHandoffSupported(
        requestedConnectionType,
        requestedStreamType,
      )
    ) {
      return null;
    }
    const offer = requestHandoff?.({
      connectionType: requestedConnectionType,
      context: getContext?.() || "",
      entity,
      key: identityKey(entity),
      streamType: requestedStreamType,
      type: EDITOR_LIVE_HANDOFF_TYPE,
    });
    const engine = offer?.claim?.() || null;
    if (!engine) return null;
    return {
      engine,
      connectionType: requestedConnectionType,
      streamType: requestedStreamType,
      commit: () => {
        suspended = false;
        returnTarget = offer.returnTarget || null;
        offer.complete?.();
      },
      reject: () => offer.reject?.(),
    };
  };

  const canAcceptReturn = ({
    entity,
    key,
    engine,
    streamType,
    connectionType,
  } = {}) => {
    const current = state();
    const currentConnectionType = current.useGo2Rtc
      ? "frigate_go2rtc"
      : "ha_direct";
    return (
      current.hostConnected === true &&
      suspended === true &&
      !current.engine &&
      !current.mountInProgress &&
      current.entity === entity &&
      key === identityKey(entity) &&
      current.hasSlot === true &&
      connectionType === currentConnectionType &&
      isEditorLiveHandoffSupported(connectionType, streamType) &&
      engine?.type === connectionType &&
      engine?.streamType === streamType &&
      isEngineReusable?.(engine, streamType, connectionType) === true
    );
  };

  const acceptReturn = ({
    entity,
    key,
    engine,
    streamType,
    connectionType,
  } = {}) => {
    if (
      !canAcceptReturn({ entity, key, engine, streamType, connectionType })
    ) {
      return false;
    }
    if (adoptEngine?.(engine, streamType, connectionType) !== true) {
      reject();
      return false;
    }
    suspended = false;
    syncLivePresentation?.();
    return true;
  };

  const returnIfPossible = () => {
    const target = returnTarget;
    returnTarget = null;
    const current = state();
    const entity = String(current.entity || "");
    const key = identityKey(entity);
    const engine = current.engine;
    const streamType = String(current.activeStreamType || "").toLowerCase();
    const connectionType = current.useGo2Rtc
      ? "frigate_go2rtc"
      : "ha_direct";
    if (
      target?.canAcceptReturn?.({
        entity,
        key,
        engine,
        streamType,
        connectionType,
      }) !== true
    ) {
      return false;
    }
    engine.deactivateRecovery?.();
    if (detachEngine?.(engine, streamType, connectionType) === false) {
      return false;
    }
    return target.acceptReturn({
      entity,
      key,
      engine,
      streamType,
      connectionType,
    });
  };

  const dispose = () => {
    suspended = false;
    returnTarget = null;
  };

  controller = {
    acceptReturn,
    canAcceptReturn,
    createOffer,
    dispose,
    isSuspended: () => suspended,
    returnIfPossible,
    take,
  };
  return controller;
}

export function createLiveMountController({
  getSlot,
  isPreviewPageActive,
  getViewMode,
  isGridModeAvailable,
  getMountInProgress,
  getMountTargetEntity,
  getMountState,
  applyMountTrackingState,
  mountGridEngine,
  cleanupEngine,
  getStreamMuted,
  setEngineMountedMuted,
  mseGraceController,
  getPendingMountDestroyers,
  setPendingMountDestroyers,
  haDirectMounter,
  haDirectTwoWayTalkMounter,
  go2rtcRaceMounter,
  preferredStreamType,
  setActiveStreamType,
  setStreamLoading,
  setStreamFallbackVisible,
  scheduleResumeLive,
  resolveUseGo2Rtc,
  takeEditorLiveHandoff,
}) {
  const applyLiveMountUiState = (quiet = false) => {
    const mountUi = resolveLiveMountUiState({ quiet });
    if (mountUi.activeStreamType != null) {
      setActiveStreamType?.(mountUi.activeStreamType);
    }
    setStreamFallbackVisible?.(
      mountUi.fallbackVisible,
      mountUi.refreshFallbackImage,
    );
    setStreamLoading?.(mountUi.loading);
  };

  const applySnapshotFallbackState = (refreshImage = false) => {
    const fallbackState = resolveSnapshotFallbackState({ refreshImage });
    setActiveStreamType?.(fallbackState.activeStreamType);
    setStreamLoading?.(fallbackState.loading);
    setStreamFallbackVisible?.(
      fallbackState.fallbackVisible,
      fallbackState.refreshFallbackImage,
    );
  };

  const clearMountTracking = (mountToken) => {
    const mountState = getMountState?.();
    applyMountTrackingState?.(
      clearMountTrackingIfCurrent({
        mountSeq: mountState?.mountSeq,
        mountToken,
        mountInProgress: mountState?.mountInProgress,
        mountStartedAt: mountState?.mountStartedAt,
        mountTargetEntity: mountState?.mountTargetEntity,
      }),
    );
  };

  const onMountWatchdogTimeout = (mountToken) => {
    if (
      !shouldRunMountWatchdog({
        mountInProgress: getMountInProgress?.(),
        mountSeq: getMountState?.()?.mountSeq,
        mountToken,
      })
    ) {
      return;
    }
    applyMountTrackingState?.(
      applyMountWatchdogTimeout({ mountSeq: getMountState?.()?.mountSeq }),
    );
    cleanupEngine?.();
    setStreamLoading?.(false);
    setStreamFallbackVisible?.(true);
    setActiveStreamType?.("snapshot");
    scheduleResumeLive?.("mount-watchdog-timeout");
  };

  const beginLiveMountSession = (entity) => {
    const mountState = getMountState?.();
    const { mountToken, nextState } = beginMountTracking({
      mountSeq: mountState?.mountSeq,
      entity,
      nowMs: Date.now(),
    });
    applyMountTrackingState?.(nextState);
    const mountWatchdogT = setTimeout(
      () => onMountWatchdogTimeout(mountToken),
      9000,
    );
    return {
      mountToken,
      clearMountState: () => {
        clearTimeout(mountWatchdogT);
        clearMountTracking(mountToken);
      },
    };
  };

  const mount = async ({
    forcedType = null,
    quiet = false,
    entity = "",
    twoWayTalkOptions = null,
  }) => {
    const slot = getSlot?.();
    const mountEntry = resolveLiveMountEntryAction({
      hasSlot: !!slot,
      previewPageActive: isPreviewPageActive?.(),
      viewMode: getViewMode?.(),
      gridModeAvailable: isGridModeAvailable?.(),
      entity,
      mountInProgress: getMountInProgress?.(),
      mountTargetEntity: getMountTargetEntity?.(),
    });

    if (mountEntry.type === "missing-slot") return false;
    if (mountEntry.type === "preview") {
      applyLiveMountUiState?.(true);
      return false;
    }
    if (mountEntry.type === "grid") {
      mountGridEngine?.();
      return false;
    }
    if (mountEntry.type === "missing-entity") {
      return false;
    }
    if (mountEntry.type === "duplicate") {
      if (!quiet) {
        setActiveStreamType?.("--");
        setStreamLoading?.(true);
      }
      return false;
    }

    const targetEntity = mountEntry.entity;
    const useGo2Rtc = resolveUseGo2Rtc?.(targetEntity) === true;
    const hasTwoWayTalkOptions = Boolean(
      twoWayTalkOptions?.microphoneStream,
    );

    if (!useGo2Rtc && !hasTwoWayTalkOptions) {
      const graceHaDirectEntry =
        mseGraceController.takeGraceHaDirectEntry?.(
          targetEntity,
          forcedType || "",
        ) || null;
      if (
        graceHaDirectEntry?.engine &&
        mseGraceController.adoptGraceHaDirectEngine?.(
          slot,
          graceHaDirectEntry.engine,
        )
      ) {
        return true;
      }

      if (!forcedType || forcedType === "hls") {
        const editorHandoff =
          takeEditorLiveHandoff?.({
            connectionType: "ha_direct",
            entity: targetEntity,
            streamType: "hls",
          }) || null;
        if (editorHandoff?.engine) {
          if (
            mseGraceController.adoptGraceHaDirectEngine?.(
              slot,
              editorHandoff.engine,
            )
          ) {
            editorHandoff.commit?.();
            return true;
          }
          editorHandoff.reject?.();
        }
      }
    }

    if (
      useGo2Rtc &&
      !hasTwoWayTalkOptions &&
      (!forcedType || forcedType === "webrtc")
    ) {
      const graceWebRtcEntry =
        mseGraceController.takeGraceWebRtcEntry?.(targetEntity) || null;
      if (
        graceWebRtcEntry?.engine &&
        mseGraceController.adoptGraceWebRtcEngine?.(
          slot,
          graceWebRtcEntry.engine,
        )
      ) {
        return true;
      }

      const editorHandoff =
        takeEditorLiveHandoff?.({
          connectionType: "frigate_go2rtc",
          entity: targetEntity,
          streamType: "webrtc",
        }) || null;
      if (editorHandoff?.engine) {
        if (
          mseGraceController.adoptGraceWebRtcEngine?.(
            slot,
            editorHandoff.engine,
          )
        ) {
          editorHandoff.commit?.();
          return true;
        }
        editorHandoff.reject?.();
      }
    }

    if (
      useGo2Rtc &&
      !hasTwoWayTalkOptions &&
      (!forcedType || forcedType === "mse")
    ) {
      const graceMseAction = resolveGraceMseReuseAction({
        useGo2Rtc,
        forcedType,
        graceMseEntry: mseGraceController.takeGraceMseEntry(targetEntity),
      });
      if (graceMseAction.type === "adopt-engine") {
        if (
          mseGraceController.adoptGraceMseEngine(
            slot,
            graceMseAction.graceMseEntry.engine,
          )
        ) {
          return;
        }
      } else if (graceMseAction.type === "await-promise") {
        const graceMseEntry = graceMseAction.graceMseEntry;
        if (graceMseEntry?.promise) {
          setEngineMountedMuted?.(getStreamMuted?.());
          const { mountToken, clearMountState } =
            beginLiveMountSession(targetEntity);
          const graceResultPromise = (async () => {
            return resolveGraceMseMountResult({
              engine: await graceMseEntry.promise,
            });
          })();
          setPendingMountDestroyers?.([
            createGracePendingMountDestroyer({
              entity: targetEntity,
              promise: graceResultPromise,
            }),
          ]);
          slot.innerHTML = "";
          applyLiveMountUiState?.(quiet);
          try {
            const graceResult = await graceResultPromise;
            const pendingOutcome = resolveGraceMsePendingMountOutcome({
              graceResult,
              mountSeq: getMountState?.()?.mountSeq,
              mountToken,
            });
            if (pendingOutcome.type === "stale-token") return;
            if (pendingOutcome.type === "adopt-engine") {
              setPendingMountDestroyers?.([]);
              if (
                mseGraceController.adoptGraceMseEngine(
                  slot,
                  pendingOutcome.engine,
                )
              ) {
                clearMountState();
                return true;
              }
            }
          } finally {
            clearMountState();
            if (
              shouldClearPendingDestroyersForPromise({
                pendingDestroyers: getPendingMountDestroyers?.(),
                promise: graceResultPromise,
              })
            ) {
              setPendingMountDestroyers?.([]);
            }
          }
        }
      }

      const editorHandoff =
        takeEditorLiveHandoff?.({
          connectionType: "frigate_go2rtc",
          entity: targetEntity,
          streamType: "mse",
        }) || null;
      if (editorHandoff?.engine) {
        if (
          mseGraceController.adoptGraceMseEngine?.(
            slot,
            editorHandoff.engine,
          )
        ) {
          editorHandoff.commit?.();
          return true;
        }
        editorHandoff.reject?.();
      }
    }

    setEngineMountedMuted?.(getStreamMuted?.());
    const { mountToken, clearMountState } = beginLiveMountSession(targetEntity);
    try {
      cleanupEngine?.();
      slot.innerHTML = "";
      applyLiveMountUiState?.(quiet);

      const transportPlan = resolveLiveMountTransportPlan({
        useGo2Rtc,
        forcedType,
        preferredStreamType: preferredStreamType?.(),
      });

      if (transportPlan.mode === "ha-direct") {
        const directMounter = hasTwoWayTalkOptions
          ? haDirectTwoWayTalkMounter
          : haDirectMounter;
        if (!directMounter?.tryMount) return false;
        const haDirectResult = await directMounter.tryMount(
          slot,
          { streamType: transportPlan.streamType },
          {
            entity: targetEntity,
            commit: true,
            ...(hasTwoWayTalkOptions ? twoWayTalkOptions : {}),
          },
        );
        if (!haDirectResult?.ok) {
          return false;
        }
        setEngineMountedMuted?.(getStreamMuted?.());
        return true;
      }

      if (
        await go2rtcRaceMounter.mountWithRace({
          slot,
          entity: targetEntity,
          forcedType,
          mountToken,
          ...(hasTwoWayTalkOptions
            ? { webRtcOptions: twoWayTalkOptions }
            : {}),
        })
      ) {
        return true;
      }

      if (
        !isMountTokenCurrent({
          mountToken,
          mountSeq: getMountState?.()?.mountSeq,
        })
      ) {
        return false;
      }
      applySnapshotFallbackState?.();
      return false;
    } finally {
      clearMountState();
    }
  };

  return {
    applySnapshotFallbackState,
    applyLiveMountUiState,
    beginLiveMountSession,
    mount,
  };
}
