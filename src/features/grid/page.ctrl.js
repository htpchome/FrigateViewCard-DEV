import { GRID_ROTATION_OPTIONS_SECONDS } from "../../constants.js";
import {
  PAGE_START_MODES,
  normalizePageStartMode,
} from "../navigation/start-mode.js";
import { cameraMemberEntities } from "../camera-groups/model.js";
import { resolveGridCameras } from "./config.js";

export class GridPageController {
  constructor(host) {
    this._host = host;
    this._returnLiveStreamType = "";
    this._hasReturnLiveTarget = false;
    this._rotationDueAt = 0;
    this._resumeRotationDelayMs = 0;
    this._alertTakeoverSequence = 0;
  }

  _displayCameras() {
    return resolveGridCameras(
      this._host._config?.cameras,
      this._host._config?.grid_order,
    );
  }

  prepareLiveForGrid() {
    const activeStreamType = String(this._host._activeStreamType || "--");
    const normalizedStreamType = activeStreamType.toLowerCase();
    if (normalizedStreamType !== "grid") {
      this._returnLiveStreamType = activeStreamType;
    }
    this._hasReturnLiveTarget =
      Boolean(this._host._engine) ||
      ["webrtc", "mse", "hls"].includes(normalizedStreamType);
  }

  captureBackgroundLiveStreamType(type) {
    if (this._host._viewMode !== "grid") return false;
    const activeStreamType = String(type || "--");
    if (activeStreamType.toLowerCase() === "grid") return false;
    this._returnLiveStreamType = activeStreamType;
    this._hasReturnLiveTarget = ["webrtc", "mse", "hls"].includes(
      activeStreamType.toLowerCase(),
    );
    return true;
  }

  takeColdStartLiveHandoff() {
    if (this._hasReturnLiveTarget || this._host._engine) return null;
    const firstEntity = String(this._displayCameras()[0]?.entity || "").trim();
    if (!firstEntity) return null;
    return (
      this._host._gridMediaController?.takeGridLiveHandoff?.(firstEntity) ||
      null
    );
  }

  restoreLiveAfterGrid() {
    const hasReturnLiveTarget =
      this._hasReturnLiveTarget || Boolean(this._host._engine);
    const activeStreamType =
      this._returnLiveStreamType || this._host._lastLiveStreamHint || "--";
    this._returnLiveStreamType = "";
    this._hasReturnLiveTarget = false;
    if (!hasReturnLiveTarget) {
      const firstCamera = this._displayCameras()[0] || null;
      this._host._activeCamIdx = Math.max(
        0,
        Number(firstCamera?.logical_camera_index) || 0,
      );
      this._host._activeGroupMemberOverride =
        firstCamera?.group_member === "B"
          ? String(firstCamera?.entity || "")
          : "";
    }
    this._host._setActiveStreamType(activeStreamType);
    return hasReturnLiveTarget;
  }

  isGridModeAvailable() {
    return (
      this._host._config?.grid_mode_enabled === true &&
      this._host._isLikelyMobileClient?.() !== true &&
      this._displayCameras().length > 1
    );
  }

  gridRotationMs() {
    const seconds = Number(this._host._config?.grid_rotation_seconds);
    return GRID_ROTATION_OPTIONS_SECONDS.includes(seconds)
      ? seconds * 1000
      : 30000;
  }

  isGridSessionActive() {
    return (
      this._host._viewMode === "grid" ||
      this._host._gridResumePending === true
    );
  }

  _clearRotationTimer({ preserveRemaining = false } = {}) {
    if (preserveRemaining && this._rotationDueAt > Date.now()) {
      this._resumeRotationDelayMs = Math.max(
        250,
        this._rotationDueAt - Date.now(),
      );
    }
    if (this._host._gridRotationT) clearTimeout(this._host._gridRotationT);
    this._host._gridRotationT = null;
    this._rotationDueAt = 0;
  }

  _pauseRotationInEditorPreview() {
    if (this._host._isEditorPreviewContext?.() !== true) return false;
    this._clearRotationTimer();
    return true;
  }

  clearGridTimers() {
    this._clearRotationTimer();
    if (this._host._gridAlertReturnT)
      clearTimeout(this._host._gridAlertReturnT);
    if (this._host._gridRefreshT) clearTimeout(this._host._gridRefreshT);
    this._host._gridAlertReturnT = null;
    this._host._gridRefreshT = null;
    this._resumeRotationDelayMs = 0;
    this._alertTakeoverSequence += 1;
    this._host._gridAlertController.clearTimers();
    this._host._clearSnapshotRefreshTimer?.();
  }

  clearGridAlertTracking() {
    this._host._gridAlertController.clearAlertTracking();
    this._host._gridLastRenderSignature = "";
  }

  scheduleGridRefresh(delayMs = 80) {
    if (this._host._gridRefreshT) clearTimeout(this._host._gridRefreshT);
    if (this._host._viewMode !== "grid") return;
    this._host._gridRefreshT = setTimeout(
      () => {
        this._host._gridRefreshT = null;
        if (this._host._viewMode !== "grid") return;
        this._host._mountEngine(null, { quiet: true });
      },
      Math.max(0, Number(delayMs) || 0),
    );
  }

  shouldStartInGridMode() {
    const legacyMode = this._host._config?.grid_start_in_grid_enabled
      ? PAGE_START_MODES.grid
      : PAGE_START_MODES.live;
    let configuredMode = legacyMode;
    if (
      this._host._isCardViewPageActive?.() ||
      this._host._config?.card_view_standalone === true
    ) {
      configuredMode =
        this._host._config?.card_view_start_mode ?? legacyMode;
    } else if (
      this._host._wideViewPageController?.isWideViewPageActive?.()
    ) {
      configuredMode =
        this._host._config?.wide_view_start_mode ?? legacyMode;
    } else if (this._host._pageId === "single-view") {
      configuredMode =
        this._host._config?.single_view_start_mode ?? legacyMode;
    }
    return (
      normalizePageStartMode(configuredMode) === PAGE_START_MODES.grid &&
      this.isGridModeAvailable()
    );
  }

  applyStartInGridMode(_source = "") {
    if (this._host._isPreviewPageActive()) return;
    if (!this.shouldStartInGridMode()) return;
    if (this._host._viewMode === "grid") return;
    if (this._host._toolbarButtonStates?.().gridDisabled) return;
    this._host._gridRotationStart = 0;
    this._host._setViewMode("grid");
  }

  scheduleGridRotation() {
    if (!this.isGridModeAvailable()) return;
    if (this._host._viewMode !== "grid") return;
    if (this._pauseRotationInEditorPreview()) return;
    if (this._displayCameras().length <= 4) {
      this._clearRotationTimer();
      this._resumeRotationDelayMs = 0;
      return;
    }
    this._clearRotationTimer();
    const wait =
      this._resumeRotationDelayMs > 0
        ? this._resumeRotationDelayMs
        : this.gridRotationMs();
    this._resumeRotationDelayMs = 0;
    this._rotationDueAt = Date.now() + wait;
    this._host._gridRotationT = setTimeout(() => {
      this._host._gridRotationT = null;
      this._rotationDueAt = 0;
      this.advanceGridRotation();
    }, wait);
  }

  advanceGridRotation() {
    if (!this.isGridModeAvailable()) return;
    if (this._host._viewMode !== "grid") return;
    if (this._pauseRotationInEditorPreview()) return;
    const total = this._displayCameras().length;
    if (total <= 4) {
      this._host._gridRotationStart = 0;
      this.scheduleGridRotation();
      return;
    }
    const totalPages = Math.max(1, Math.ceil(total / 4));
    const currentPage = Math.min(
      totalPages - 1,
      Math.max(0, Math.floor((Number(this._host._gridRotationStart) || 0) / 4)),
    );
    const nextPage = (currentPage + 1) % totalPages;
    this._host._gridRotationStart = nextPage * 4;
    this._host._mountEngine(null, { quiet: true });
    this.scheduleGridRotation();
  }

  beginAlertPageHold(entity) {
    if (this._host._viewMode !== "grid") return false;
    if (!this.isGridModeAvailable()) return false;
    if (!this._displayCameras().some((camera) => camera?.entity === entity)) {
      return false;
    }

    const sequence = ++this._alertTakeoverSequence;
    this._clearRotationTimer({ preserveRemaining: true });
    if (this._host._gridRefreshT) clearTimeout(this._host._gridRefreshT);
    this._host._gridRefreshT = null;
    this.focusGridPageForCamera(entity, { scheduleRotation: false });
    this._host._gridPinnedRotationStart = Math.max(
      0,
      Number(this._host._gridRotationStart) || 0,
    );
    if (this._host._gridAlertReturnT) {
      clearTimeout(this._host._gridAlertReturnT);
    }

    // Alert presentation preempts Grid rotation in the same task. The normal
    // Grid timer resumes only after the configured alert hold has completed.
    void this._host._mountEngine?.(null, { quiet: true });
    const holdMs = Math.max(
      1000,
      Number(this._host._gridAlertHoldMs?.()) || this.gridRotationMs(),
    );
    this._host._gridAlertReturnT = setTimeout(() => {
      this._host._gridAlertReturnT = null;
      if (sequence !== this._alertTakeoverSequence) return;
      if (this._host._viewMode !== "grid") return;
      this.scheduleGridRotation();
    }, holdMs);
    return true;
  }

  async beginAlertTakeover(entity, severity = "alert") {
    if (!this.isGridSessionActive()) return false;
    if (this._host._alertCameraTakeoverEnabled?.() !== true) return false;
    const index = this._host._cameraIndexByEntity?.(entity) ?? -1;
    if (index < 0) return false;

    const target = this._displayCameras().find(
      (camera) => camera?.entity === entity,
    );
    const logicalCamera = this._host._config?.cameras?.[index];
    const grouped = cameraMemberEntities(logicalCamera).length > 1;
    const sequence = ++this._alertTakeoverSequence;
    if (this._host._viewMode === "grid") {
      this._clearRotationTimer({ preserveRemaining: true });
      if (this._host._gridRefreshT) clearTimeout(this._host._gridRefreshT);
      this._host._gridRefreshT = null;
    }
    this.focusGridPageForCamera(entity, { scheduleRotation: false });
    this._host._gridPinnedRotationStart = Math.max(
      0,
      Number(this._host._gridRotationStart) || 0,
    );
    if (this._host._gridAlertReturnT) {
      clearTimeout(this._host._gridAlertReturnT);
    }
    this._host._gridAlertReturnT = null;
    this._host._gridResumePending = true;
    this._host._setSlideshowAlertState?.(severity);
    this._host._syncToolbarButtons?.();

    const holdMs = Math.max(
      1000,
      Number(this._host._gridAlertHoldMs?.()) || this.gridRotationMs(),
    );
    this._host._gridAlertReturnT = setTimeout(() => {
      this._host._gridAlertReturnT = null;
      if (sequence !== this._alertTakeoverSequence) return;
      this.completeAlertTakeover();
    }, holdMs);

    try {
      await this._host._switchCamera?.(index, {
        source: "alert",
        origin: "grid-alert-takeover",
        gridAlertTakeover: true,
        keepGridResume: true,
        ...(grouped && target?.entity
          ? { groupMemberEntity: target.entity }
          : {}),
      });
    } catch (_) {
      if (sequence === this._alertTakeoverSequence) {
        this.completeAlertTakeover();
      }
      return false;
    }

    if (
      sequence !== this._alertTakeoverSequence ||
      this._host._gridResumePending !== true
    ) {
      return false;
    }
    this._host._setSlideshowAlertState?.(severity);
    return true;
  }

  completeAlertTakeover() {
    if (this._host._gridResumePending !== true) return false;
    if (this._host._gridAlertReturnT) {
      clearTimeout(this._host._gridAlertReturnT);
    }
    this._host._gridAlertReturnT = null;
    this._host._gridResumePending = false;
    this._host._gridRotationStart = Math.max(
      0,
      Number(this._host._gridPinnedRotationStart) || 0,
    );
    this._host._setSlideshowAlertState?.("");
    if (!this.isGridModeAvailable()) {
      this.stopGridModeState();
      this._host._syncToolbarButtons?.();
      return false;
    }
    this._host._setViewMode?.("grid");
    return true;
  }

  handleAlertTakeoverStateChange(enabled) {
    if (enabled === true || this._host._gridResumePending !== true) return;
    this.completeAlertTakeover();
  }

  focusGridPageForCamera(entity, { scheduleRotation = true } = {}) {
    if (!this.isGridModeAvailable()) return false;
    const idx = this._displayCameras().findIndex(
      (camera) => camera?.entity === entity,
    );
    if (idx < 0) return false;
    const total = this._displayCameras().length;
    if (total <= 0) return false;
    const maxStart = Math.max(0, (Math.ceil(total / 4) - 1) * 4);
    const nextStart = Math.min(maxStart, Math.floor(idx / 4) * 4);
    const currentStart = Math.min(
      maxStart,
      Math.max(
        0,
        Math.floor((Number(this._host._gridRotationStart) || 0) / 4) * 4,
      ),
    );
    if (nextStart === currentStart) return false;
    this._host._gridRotationStart = nextStart;
    this._host._gridPinnedRotationStart = nextStart;
    if (scheduleRotation) this.scheduleGridRotation();
    return true;
  }

  stopGridModeState() {
    this.clearGridTimers();
    this._host._gridMediaController?.teardownGridEngine?.();
    this._host._gridResumePending = false;
    this._host._gridPinnedRotationStart = Math.max(
      0,
      Number(this._host._gridRotationStart) || 0,
    );
    this._host._gridAlertController.stopSession();
    this._host._gridLastRenderSignature = "";
    this._host._setSlideshowAlertState("");
  }

  toggleGridMode() {
    if (this._host._isPreviewPageActive()) return;
    if (this._host._viewMode === "grid") {
      this._host._gridResumePending = false;
      this._host._setViewMode("single");
      return;
    }
    if (this._host._gridResumePending) {
      this._host._gridResumePending = false;
      this.stopGridModeState();
      this._host._syncToolbarButtons();
      return;
    }
    if (this._host._toolbarButtonStates?.().gridDisabled) {
      this._host._syncToolbarButtons?.();
      return;
    }
    this._host._gridRotationStart = 0;
    this._host._gridPinnedRotationStart = 0;
    this.clearGridAlertTracking();
    this._host._setViewMode("grid");
  }
}
