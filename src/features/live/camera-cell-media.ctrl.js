import {
  createHaCameraStreamElement,
  createHaHlsPlayerElement,
  findActiveHaCameraStreamVideo,
  resolveHaDirectCameraStreamType,
  watchHaPlaybackFirstFrame,
} from "../../integrations/home-assistant/playback.js";
import { preloadFallbackImageSource } from "./fallbacks/fallback-refresh.js";
import { appendCacheBustParam } from "./fallbacks/fallback-url.js";
import { attachContainedVideoFit } from "../../shared/media/video-fit.js";
import { adoptMountedAttemptSlot } from "./mount-result.js";
import { createStrategyForType } from "./stream.strategies.js";
import { StreamOrchestrator } from "./stream.orchestrator.js";

const GRID_LIVE_ATTEMPT_TYPES = Object.freeze(["webrtc", "mse"]);
const GRID_WEBRTC_PREFERRED_WAIT_MS = 500;

const gridLiveAttemptStartup = (type) => {
  if (type === "webrtc") return { waitMs: 7000 };
  if (type === "hls") return { waitMs: 5000 };
  return {
    waitMs: 4000,
    minCurrentTime: 0.05,
    minDecodedFrames: 1,
    requireReadyState: 2,
    strict: true,
  };
};

export class CameraCellMediaController {
  constructor(host) {
    this._host = host;
  }

  _mountGridSnapshotCell(
    cell,
    {
      entity,
      stateObj,
      className = "",
      prioritizeSnapshot = false,
    },
  ) {
    if (!cell || !entity) return false;
    const img = document.createElement("img");
    const entityPicture = stateObj?.attributes?.entity_picture || "";
    img.alt = `${entity} snapshot`;
    img.loading = prioritizeSnapshot ? "eager" : "lazy";
    if (prioritizeSnapshot) img.fetchPriority = "high";
    img.decoding = "async";
    if (className) img.className = className;
    void (async () => {
      const primaryUrl = await this._host._streamFallbackUrl(entity);
      if (!img.isConnected) return;
      if (primaryUrl) {
        img.src = primaryUrl;
        return;
      }
      if (entityPicture) {
        img.src = /^https?:\/\//i.test(entityPicture)
          ? entityPicture
          : `${window.location.origin}${entityPicture}`;
      }
    })();
    cell.appendChild(img);
    return img;
  }

  _createLiveSnapshotStage(cell, { entity, stateObj, gridState }) {
    const placeholder = this._mountGridSnapshotCell(cell, {
      entity,
      stateObj,
      className: "preview-live-placeholder",
      prioritizeSnapshot: true,
    });
    const liveLayer = document.createElement("div");
    liveLayer.className = "preview-live-layer";
    cell.appendChild(liveLayer);

    let disposed = false;
    let removePlaceholderT = null;
    const reveal = () => {
      if (disposed || gridState?.destroyed || !liveLayer.isConnected) return;
      liveLayer.classList.add("is-ready");
      if (removePlaceholderT) clearTimeout(removePlaceholderT);
      removePlaceholderT = setTimeout(() => {
        removePlaceholderT = null;
        try {
          placeholder?.remove?.();
        } catch (_) {}
      }, 180);
    };
    const retainPlaceholder = () => {
      if (disposed) return;
      disposed = true;
      if (removePlaceholderT) clearTimeout(removePlaceholderT);
      removePlaceholderT = null;
      try {
        liveLayer.remove();
      } catch (_) {}
    };
    const cleanup = () => {
      disposed = true;
      if (removePlaceholderT) clearTimeout(removePlaceholderT);
      removePlaceholderT = null;
      try {
        liveLayer.remove();
      } catch (_) {}
      try {
        placeholder?.remove?.();
      } catch (_) {}
    };
    gridState?.cleanup?.push?.(cleanup);
    return { liveLayer, reveal, retainPlaceholder };
  }

  _isSignedCameraProxyUrl(url) {
    const source = String(url || "");
    return (
      /\/api\/camera_proxy\//i.test(source) && /[?&]authSig=/i.test(source)
    );
  }

  async _replaceSnapshotImageAfterDecode(img, nextSrc, nextBlobUrl = "") {
    const replacement = img?.cloneNode?.(false);
    if (!replacement || !nextSrc) return false;
    replacement.removeAttribute?.("src");
    const ready = await preloadFallbackImageSource(nextSrc, {
      createImage: () => replacement,
    });
    if (!ready || !img.isConnected) return false;

    const previousBlobUrl = img.dataset?.fvcBlobUrl || "";
    if (replacement.dataset) {
      if (nextBlobUrl) {
        replacement.dataset.fvcBlobUrl = nextBlobUrl;
      } else {
        delete replacement.dataset.fvcBlobUrl;
      }
    }
    try {
      img.replaceWith(replacement);
    } catch (_) {
      return false;
    }
    if (previousBlobUrl && previousBlobUrl !== nextBlobUrl) {
      try {
        URL.revokeObjectURL(previousBlobUrl);
      } catch (_) {}
    }
    return true;
  }

  async _refreshSnapshotImageElement(img, resolvedUrl, cacheBustValue) {
    if (!img || !img.isConnected || !resolvedUrl) return;

    if (this._isSignedCameraProxyUrl(resolvedUrl)) {
      try {
        const response = await fetch(resolvedUrl, {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) return;
        const blob = await response.blob();
        if (!img.isConnected) return;
        const nextBlobUrl = URL.createObjectURL(blob);
        const replaced = await this._replaceSnapshotImageAfterDecode(
          img,
          nextBlobUrl,
          nextBlobUrl,
        );
        if (!replaced) {
          try {
            URL.revokeObjectURL(nextBlobUrl);
          } catch (_) {}
        }
      } catch (_) {}
      return;
    }

    await this._replaceSnapshotImageAfterDecode(
      img,
      appendCacheBustParam(resolvedUrl, cacheBustValue),
    );
  }

  async _resolveSnapshotImageUrl(entity, stateObj = null) {
    const primaryUrl = await this._host._streamFallbackUrl(entity);
    if (primaryUrl) return primaryUrl;
    const entityPicture =
      stateObj?.attributes?.entity_picture ||
      this._host._hass?.states?.[entity]?.attributes?.entity_picture ||
      "";
    if (!entityPicture) return "";
    return /^https?:\/\//i.test(entityPicture)
      ? entityPicture
      : `${window.location.origin}${entityPicture}`;
  }

  async refreshSnapshotMedia({ cacheBustValue = Date.now() } = {}) {
    const hosts = this._host.shadowRoot?.querySelectorAll(
      ".preview-media-host[data-preview-use-live='0'], .live-grid-cell[data-grid-use-live='0'], .wide-companion-media-host[data-wide-companion-use-live='0']",
    );
    if (!hosts?.length) return;

    await Promise.all(
      Array.from(hosts).map(async (host) => {
        const img = host.querySelector?.("img");
        if (!img || !img.isConnected) return;
        const entity =
          host.dataset.previewMediaEntity ||
          host.dataset.gridEntity ||
          host.dataset.wideCompanionMediaEntity ||
          "";
        if (!entity) return;
        const stateObj = this._host._hass?.states?.[entity] || null;
        const resolvedUrl = await this._resolveSnapshotImageUrl(
          entity,
          stateObj,
        );
        if (!resolvedUrl || !img.isConnected) return;
        await this._refreshSnapshotImageElement(
          img,
          resolvedUrl,
          cacheBustValue,
        );
      }),
    );
  }

  _mountGridGo2RtcCell(cell, entity, gridState, options = {}) {
    const host = document.createElement("div");
    host.style.cssText =
      "position:relative;width:100%;height:100%;display:block;overflow:hidden";
    cell.appendChild(host);
    const abortController =
      typeof AbortController === "function" ? new AbortController() : null;
    let mountedEngine = null;
    let mountedType = "";
    let activeOrchestrator = null;
    let cleaned = false;
    const handoff = {
      take: () => {
        if (cleaned || !mountedEngine || !mountedType) return null;
        const engine = mountedEngine;
        const type = mountedType;
        const orchestrator = activeOrchestrator;
        const winnerStrategy = orchestrator?.attempts?.find?.(
          (attempt) => attempt?.type === type,
        )?.strategy;
        cleaned = true;
        mountedEngine = null;
        mountedType = "";
        activeOrchestrator = null;
        if (winnerStrategy) {
          void orchestrator?.stop?.({ exclude: winnerStrategy });
        }
        return {
          ok: true,
          type,
          engine,
          slot: host,
        };
      },
    };
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try {
        abortController?.abort?.();
      } catch (_) {}
      try {
        void activeOrchestrator?.stop?.();
      } catch (_) {}
      activeOrchestrator = null;
      try {
        mountedEngine?.destroy?.();
      } catch (_) {}
      mountedEngine = null;
      try {
        host.innerHTML = "";
        host.remove?.();
      } catch (_) {}
    };
    gridState.cleanup.push(cleanup);
    if (options.preferWebRtc === true) {
      this._mountGridGo2RtcRace({
        cell,
        entity,
        gridState,
        options,
        host,
        handoff,
        isCleaned: () => cleaned,
        setMountedResult: (engine, type) => {
          mountedEngine = engine;
          mountedType = String(type || "").trim().toLowerCase();
        },
        setActiveOrchestrator: (orchestrator) => {
          activeOrchestrator = orchestrator;
        },
      });
      return;
    }
    void (async () => {
      if (gridState.destroyed || cleaned) return;
      const liveStreamHint = String(options.liveStreamHint || "mse")
        .trim()
        .toLowerCase();
      const mountMethod =
        liveStreamHint === "webrtc"
          ? "tryMountWebRtc"
          : liveStreamHint === "hls"
            ? "tryMountHls"
            : "tryMountMse";
      const mount = this._host._go2rtcMounter?.[mountMethod];
      let result = false;
      try {
        result =
          typeof mount === "function"
            ? await mount.call(
                this._host._go2rtcMounter,
                host,
                gridLiveAttemptStartup(liveStreamHint),
                {
                  abortSignal: abortController?.signal,
                  commit: false,
                  entity,
                  muted: true,
                },
              )
            : false;
      } catch (_) {
        result = false;
      }
      if (gridState.destroyed || cleaned || !host.isConnected) {
        try {
          result?.engine?.destroy?.();
        } catch (_) {}
        return;
      }
      if (!result?.ok) {
        this._handleGridLiveFailure(cell, entity, options, host);
        return;
      }
      mountedEngine = result.engine;
      mountedType = liveStreamHint;
      options.onReady?.(mountedEngine, mountedType, handoff);
    })();
  }

  resolveHaDirectLiveStreamHint(
    entity,
    requestedStreamType = "",
    fallbackStreamType = "hls",
  ) {
    if (this._host._isCatalyst?.() === true) return "hls";
    const activeStreamType =
      String(this._host._activeStreamType || "").trim().toLowerCase() ===
      "grid"
        ? ""
        : this._host._activeStreamType;
    return resolveHaDirectCameraStreamType({
      entity,
      activeEntity: this._host._activeCam?.entity,
      activeStreamType,
      advertisedStreamType:
        this._host._hass?.states?.[entity]?.attributes?.frontend_stream_type,
      requestedStreamType,
      fallbackStreamType,
    });
  }

  _createGridLiveAttemptSlot(host) {
    const slot = document.createElement("div");
    slot.style.cssText =
      "position:absolute;inset:0;opacity:0;pointer-events:none;overflow:hidden";
    host.appendChild(slot);
    return slot;
  }

  _handleGridLiveFailure(cell, entity, options, host) {
    try {
      host?.remove?.();
    } catch (_) {}
    if (options.onFailure) {
      options.onFailure();
      return;
    }
    if (options.fallbackOnFailure) {
      this._mountGridSnapshotCell(cell, {
        entity,
        stateObj: options.stateObj || null,
      });
    }
  }

  _mountGridGo2RtcRace({
    cell,
    entity,
    gridState,
    options,
    host,
    handoff,
    isCleaned,
    setMountedResult,
    setActiveOrchestrator,
  }) {
    void (async () => {
      if (gridState.destroyed || isCleaned()) return;
      const strategies = GRID_LIVE_ATTEMPT_TYPES.map((type) => {
        const slot = this._createGridLiveAttemptSlot(host);
        const mountMethod =
          type === "webrtc"
            ? "tryMountWebRtc"
            : type === "hls"
              ? "tryMountHls"
              : "tryMountMse";
        return createStrategyForType({
          type,
          connect: async ({ abortSignal }) => {
            const mount = this._host._go2rtcMounter?.[mountMethod];
            if (typeof mount !== "function") return false;
            return await mount.call(
              this._host._go2rtcMounter,
              slot,
              gridLiveAttemptStartup(type),
              {
                abortSignal,
                commit: false,
                entity,
                muted: true,
              },
            );
          },
        });
      });
      const orchestrator = new StreamOrchestrator({
        strategies,
        preferredType: "webrtc",
        preferredWaitMs: GRID_WEBRTC_PREFERRED_WAIT_MS,
        retainPreferredOnFallback: true,
      });
      setActiveOrchestrator(orchestrator);
      const winner = await orchestrator.start();
      if (gridState.destroyed || isCleaned() || !host.isConnected) {
        try {
          winner?.engine?.destroy?.();
        } catch (_) {}
        return;
      }
      if (!winner?.ok || !winner.slot || !winner.engine) {
        this._handleGridLiveFailure(cell, entity, options, host);
        return;
      }

      adoptMountedAttemptSlot({
        targetSlot: host,
        resultSlot: winner.slot,
        preservePendingSlots:
          orchestrator.deferredPreferredAttempt?.type === "webrtc",
      });
      setMountedResult(winner.engine, winner.type);
      options.onReady?.(winner.engine, winner.type, handoff);

      const deferredWebRtc = orchestrator.deferredPreferredAttempt;
      if (deferredWebRtc?.type !== "webrtc") return;
      const webRtcResult = await deferredWebRtc.promise.catch(() => null);
      if (
        !webRtcResult?.ok ||
        gridState.destroyed ||
        isCleaned() ||
        !host.isConnected
      ) {
        return;
      }
      adoptMountedAttemptSlot({
        targetSlot: host,
        resultSlot: webRtcResult.slot,
      });
      try {
        winner.engine.destroy?.();
      } catch (_) {}
      setMountedResult(webRtcResult.engine, webRtcResult.type);
      options.onReady?.(webRtcResult.engine, webRtcResult.type, handoff);
    })();
  }

  _mountGridCameraCellMedia(
    cell,
    {
      entity,
      stateObj,
      useLive,
      liveStreamHint,
      gridState,
      fallbackOnLiveError = false,
      snapshotPlaceholderWhileLive = false,
      preferWebRtc = false,
      prioritizeSnapshot = false,
      onLiveReady = null,
    },
  ) {
    if (!cell || !entity) return false;
    if (useLive) {
      const liveStage = snapshotPlaceholderWhileLive
        ? this._createLiveSnapshotStage(cell, {
            entity,
            stateObj,
            gridState,
          })
        : null;
      const liveTarget = liveStage?.liveLayer || cell;
      if (this._host._shouldUseGo2RtcForEntity(entity)) {
        this._mountGridGo2RtcCell(liveTarget, entity, gridState, {
          fallbackOnFailure: fallbackOnLiveError && !liveStage,
          stateObj,
          liveStreamHint,
          preferWebRtc,
          onReady: (engine, type, handoff) => {
            liveStage?.reveal?.();
            onLiveReady?.(engine, { ...handoff, type });
          },
          onFailure: liveStage?.retainPlaceholder,
        });
      } else if (stateObj) {
        const haDirectStreamHint = this.resolveHaDirectLiveStreamHint(
          entity,
          liveStreamHint,
          "webrtc",
        );
        const haDirectStateObj = {
          ...stateObj,
          attributes: {
            ...stateObj.attributes,
            frontend_stream_type:
              haDirectStreamHint === "webrtc" ? "web_rtc" : "hls",
          },
        };
        const styleText =
          "width:100%;height:100%;display:block;background:var(--c-bg-deep)";
        const stream =
          haDirectStreamHint === "hls"
            ? createHaHlsPlayerElement({
                hass: this._host._hass,
                entity,
                controls: false,
                muted: true,
                defaultMuted: true,
                fitMode: "contain",
                styleText,
              })
            : createHaCameraStreamElement({
                hass: this._host._hass,
                stateObj: haDirectStateObj,
                controls: false,
                muted: true,
                defaultMuted: true,
                fitMode: "contain",
                styleText,
              });
        if (!stream) {
          liveStage?.retainPlaceholder?.();
          return Boolean(liveStage);
        }
        liveTarget.appendChild(stream);
        attachContainedVideoFit(stream);
        let released = false;
        const handoffType = haDirectStreamHint;
        const handoff = {
          type: handoffType,
          take: () => {
            if (released || !stream) return null;
            released = true;
            return {
              ok: true,
              type: handoffType,
              engine: stream,
              slot: stream,
            };
          },
        };
        if (liveStage) {
          gridState.cleanup.push(
            watchHaPlaybackFirstFrame({
              stream,
              isDestroyed: () => gridState.destroyed,
              onReady: () => {
                liveStage.reveal();
                onLiveReady?.(stream, handoff);
              },
            }),
          );
        } else {
          onLiveReady?.(stream, handoff);
        }
        gridState.cleanup.push(() => {
          if (released) return;
          try {
            const video = findActiveHaCameraStreamVideo(stream);
            if (video) {
              video.pause?.();
              video.removeAttribute?.("src");
              video.load?.();
            }
          } catch (_) {}
          try {
            stream.remove();
          } catch (_) {}
        });
      } else {
        liveStage?.retainPlaceholder?.();
        if (liveStage) return true;
        return this._mountGridSnapshotCell(cell, {
          entity,
          stateObj,
          prioritizeSnapshot,
        });
      }
      return true;
    }
    return this._mountGridSnapshotCell(cell, {
      entity,
      stateObj,
      prioritizeSnapshot,
    });
  }

  mountCameraCellMedia(cell, options = {}) {
    return this._mountGridCameraCellMedia(cell, options);
  }
}
