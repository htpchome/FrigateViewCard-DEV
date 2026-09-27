import { buildHaCameraStreamState } from "../../integrations/home-assistant/playback.js";
import {
  applyGridCellSeverityClass,
  buildGridSignaturePart,
  createGridCellElement,
  createGridLabelElement,
  createGridRootElement,
  renderGridEmptyPlaceholder,
} from "./page.tmpl.js";
import { resolveGridCameras } from "./config.js";

export class GridMediaController {
  constructor(host, options = {}) {
    this._host = host;
    this._cameraCellMediaController = options.cameraCellMediaController;
    this._buildLabelText =
      typeof options.buildLabelText === "function"
        ? options.buildLabelText
        : () => "";
    this._liveIconSvg = String(options.liveIconSvg || "");
  }

  pageCameraIndices() {
    const total = resolveGridCameras(
      this._host._config?.cameras,
      this._host._config?.grid_order,
    ).length;
    if (!total) return [];
    const maxStart = Math.max(0, (Math.ceil(total / 4) - 1) * 4);
    const rawStart = Math.max(0, Number(this._host._gridRotationStart) || 0);
    const start = Math.min(maxStart, Math.floor(rawStart / 4) * 4);
    this._host._gridRotationStart = start;
    return [0, 1, 2, 3].map((offset) => {
      const idx = start + offset;
      return idx < total ? idx : -1;
    });
  }

  _shouldUseLive(entity) {
    if (this._host._isEditorPreviewContext?.() === true) return false;
    return (
      this._host._gridLiveViewEnabled() ||
      this._host._isGridCameraAlertLive(entity)
    );
  }

  shouldUseLive(entity) {
    return this._shouldUseLive(entity);
  }

  _resolveGridCellLiveStreamHint(entity) {
    if (this._host._shouldUseGo2RtcForEntity(entity)) return "webrtc";
    return this._cameraCellMediaController.resolveHaDirectLiveStreamHint(
      entity,
    );
  }

  _mountGridCameraCellMedia(cell, options = {}) {
    return this._cameraCellMediaController.mountCameraCellMedia(cell, options);
  }

  _setGridPresentation(slot, active) {
    if (!slot) return;
    slot.hidden = !active;
    slot.setAttribute?.("aria-hidden", active ? "false" : "true");
    const liveSlot = this._host.shadowRoot?.querySelector?.("#engine");
    liveSlot?.setAttribute?.("aria-hidden", active ? "true" : "false");
  }

  _gridSessionSignature(cameras = []) {
    const cameraSignature = cameras
      .map((camera) => {
        const entity = String(camera?.entity || "");
        const source = entity
          ? this._host._shouldUseGo2RtcForEntity(entity)
            ? "frigate_go2rtc"
            : "ha_direct"
          : "";
        return [entity, source, this._buildLabelText(camera)].join(":");
      })
      .join("|");
    return `${this._host._gridLiveViewEnabled() ? "live" : "snapshot"}|${cameraSignature}`;
  }

  _setGridPageActive(entry, active) {
    const grid = entry?.grid;
    if (!grid) return;
    grid.style.position = "absolute";
    grid.style.inset = "0";
    grid.style.opacity = active ? "1" : "0";
    grid.style.pointerEvents = active ? "auto" : "none";
    grid.style.zIndex = active ? "1" : "0";
    grid.setAttribute?.("aria-hidden", active ? "false" : "true");
  }

  _destroyGridPage(entry) {
    if (!entry || entry.destroyed) return;
    entry.destroyed = true;
    entry.gridState.destroyed = true;
    entry.grid
      ?.querySelectorAll?.("img[data-fvc-blob-url]")
      ?.forEach?.((img) => {
        const blobUrl = img.dataset.fvcBlobUrl || "";
        if (!blobUrl) return;
        try {
          URL.revokeObjectURL(blobUrl);
        } catch (_) {}
      });
    for (const cleanup of entry.gridState.cleanup) {
      try {
        cleanup();
      } catch (_) {}
    }
    entry.liveHandoffs?.clear?.();
    try {
      entry.grid?.remove?.();
    } catch (_) {}
  }

  _ensureGridSession(slot, cameras) {
    const signature = this._gridSessionSignature(cameras);
    const current = this._host._gridEngine;
    if (
      current?.slot === slot &&
      current?.signature === signature &&
      current?.pages instanceof Map &&
      current.destroyed !== true
    ) {
      return current;
    }

    try {
      current?.destroy?.();
    } catch (_) {}
    slot.innerHTML = "";
    const session = {
      slot,
      signature,
      pages: new Map(),
      activePageKey: "",
      destroyed: false,
      destroy: () => {
        if (session.destroyed) return;
        session.destroyed = true;
        for (const entry of session.pages.values()) {
          this._destroyGridPage(entry);
        }
        session.pages.clear();
        session.activePageKey = "";
      },
    };
    this._host._gridEngine = session;
    return session;
  }

  _activateGridPage(session, pageKey) {
    if (!session || session.destroyed) return;
    for (const [key, entry] of session.pages) {
      this._setGridPageActive(entry, key === pageKey);
    }
    session.activePageKey = pageKey;
  }

  _refreshGridPageSeverity(entry) {
    entry?.grid
      ?.querySelectorAll?.(".live-grid-cell[data-grid-entity]")
      ?.forEach?.((cell) => {
        cell.classList?.remove?.("grid-alert", "grid-detection");
        applyGridCellSeverityClass(
          cell,
          this._host._gridCellSeverity(cell.dataset.gridEntity || ""),
        );
      });
  }

  takeGridLiveHandoff(entity) {
    const targetEntity = String(entity || "").trim();
    const session = this._host._gridEngine;
    if (!targetEntity || !session?.pages) return null;
    for (const entry of session.pages.values()) {
      const handoff = entry?.liveHandoffs?.get?.(targetEntity);
      if (!handoff?.take) continue;
      const result = handoff.take();
      if (!result?.engine || !result?.slot) continue;
      entry.liveHandoffs.delete(targetEntity);
      return result;
    }
    return null;
  }

  activateCurrentGridPage() {
    const slot =
      this._host.shadowRoot?.querySelector?.("#grid-engine") ||
      this._host._gridEngine?.slot ||
      null;
    if (!slot) return false;
    this.mountGridEngine(slot);
    return true;
  }

  mountGridEngine(slot) {
    if (!slot) return;
    this._setGridPresentation(slot, true);
    const indices = this.pageCameraIndices();
    const cameras = resolveGridCameras(
      this._host._config?.cameras,
      this._host._config?.grid_order,
    );
    const signatureParts = [];
    const mediaSignatureParts = [];

    for (const idx of indices) {
      const camera = idx >= 0 ? cameras[idx] : null;
      const entity = camera?.entity || "";
      const severity = idx >= 0 ? this._host._gridCellSeverity(entity) : "";
      const useLive = idx >= 0 && this._shouldUseLive(entity);
      const liveStreamHint =
        idx >= 0 ? this._resolveGridCellLiveStreamHint(entity) : "webrtc";
      signatureParts.push(
        buildGridSignaturePart({
          index: idx,
          entity,
          severity,
          useLive,
          liveStreamHint,
        }),
      );
      mediaSignatureParts.push(
        buildGridSignaturePart({
          index: idx,
          entity,
          severity: "",
          useLive,
          liveStreamHint,
        }),
      );
    }

    const nextSignature = signatureParts.join("|");
    const nextMediaSignature = mediaSignatureParts.join("|");
    const pageKey = String(Math.max(0, Number(indices[0]) || 0));
    const session = this._ensureGridSession(slot, cameras);
    const cachedPage = session.pages.get(pageKey);
    if (cachedPage?.mediaSignature === nextMediaSignature) {
      this._refreshGridPageSeverity(cachedPage);
      cachedPage.signature = nextSignature;
      this._activateGridPage(session, pageKey);
      this._host._gridLastRenderSignature = nextSignature;
      this._host._setActiveStreamType("grid");
      this._host._syncSnapshotRefreshTimer?.();
      return;
    }

    if (cachedPage) {
      this._destroyGridPage(cachedPage);
      session.pages.delete(pageKey);
    }

    this._host._gridLastRenderSignature = nextSignature;
    const gridState = { destroyed: false, cleanup: [] };
    const grid = createGridRootElement();
    const pageEntry = {
      grid,
      gridState,
      liveHandoffs: new Map(),
      signature: nextSignature,
      mediaSignature: nextMediaSignature,
      destroyed: false,
    };
    this._setGridPageActive(pageEntry, false);
    session.pages.set(pageKey, pageEntry);
    slot.appendChild(grid);
    for (const idx of indices) {
      const cell = createGridCellElement();
      grid.appendChild(cell);
      if (idx >= 0) {
        const camera = cameras[idx];
        const entity = camera?.entity || "";
        const useGo2Rtc = entity
          ? this._host._shouldUseGo2RtcForEntity(entity)
          : false;
        const cameraStreamHint = useGo2Rtc
          ? "webrtc"
          : this._resolveGridCellLiveStreamHint(entity);
        const stateObj = entity
          ? buildHaCameraStreamState(
              this._host._hass,
              entity,
              cameraStreamHint,
              this._host._preferredStreamType(),
            ) ||
            this._host._hass?.states?.[entity] ||
            null
          : null;
        const severity = this._host._gridCellSeverity(entity);
        applyGridCellSeverityClass(cell, severity);
        const useLive = this._shouldUseLive(entity);
        cell.dataset.gridUseLive = useLive ? "1" : "0";
        if (entity) {
          this._mountGridCameraCellMedia(cell, {
            entity,
            stateObj,
            useLive,
            liveStreamHint: cameraStreamHint,
            gridState,
            fallbackOnLiveError: true,
            snapshotPlaceholderWhileLive: true,
            preferWebRtc: true,
            prioritizeSnapshot: true,
            onLiveReady: (_engine, handoff) => {
              if (handoff?.take) {
                pageEntry.liveHandoffs.set(entity, handoff);
              }
            },
          });
        } else {
          cell.classList.add("empty");
        }
        cell.dataset.gridCamidx = String(
          camera?.logical_camera_index ?? idx,
        );
        cell.dataset.gridEntity = entity;
        const label = createGridLabelElement(this._buildLabelText(camera));
        cell.appendChild(label);
      } else {
        cell.classList.add("empty");
      }
      if (cell.classList.contains("empty")) {
        renderGridEmptyPlaceholder(
          cell,
          this._liveIconSvg,
          this._host._localization?.t,
        );
      }
    }
    this._activateGridPage(session, pageKey);
    this._host._setActiveStreamType("grid");
    this._host._syncSnapshotRefreshTimer?.();
  }

  teardownGridEngine({ slot = null, keepSlotVisible = false } = {}) {
    const gridSlot =
      slot || this._host.shadowRoot?.querySelector?.("#grid-engine") || null;
    const gridEngine = this._host._gridEngine;
    this._host._gridEngine = null;
    try {
      gridEngine?.destroy?.();
    } catch (_) {}
    if (!gridSlot) return;
    if (!keepSlotVisible) this._setGridPresentation(gridSlot, false);
    gridSlot.innerHTML = "";
  }
}
