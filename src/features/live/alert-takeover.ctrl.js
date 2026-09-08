import { parseRealtimeAlertMessage } from "../../data/realtime-alert.js";
import { reconcileActiveAlertCandidates } from "../../data/review-candidate.js";
import {
  cameraMemberEntities,
  flattenCameraMembers,
} from "../camera-groups/model.js";

export class LiveAlertTakeoverController {
  constructor(host) {
    this._host = host;
    this._haSeverityByEntity = new Map();
    this._haChangedAtByEntity = new Map();
    this._realtimeSeverityByEntity = new Map();
  }

  _activeLiveEntity() {
    return (
      this._host._activeGroupMemberOverride ||
      this._host._activeCam?.entity ||
      ""
    );
  }

  _isAvailable() {
    return (
      this._host._alertCameraTakeoverEnabled?.() === true &&
      this._host._viewMode !== "grid" &&
      this._host._gridResumePending !== true &&
      this._host._slideshowActive !== true
    );
  }

  _activeSeverity() {
    const activeEntity = this._activeLiveEntity();
    const severities = [
      this._haSeverityByEntity.get(activeEntity),
      this._realtimeSeverityByEntity.get(activeEntity),
    ];
    if (severities.includes("alert")) return "alert";
    return severities.includes("detection") ? "detection" : "";
  }

  _syncOutline({ clearIfMissing = false } = {}) {
    if (!this._isAvailable()) {
      if (
        this._host._viewMode !== "grid" &&
        this._host._gridResumePending !== true &&
        this._host._slideshowActive !== true
      ) {
        this._host._setLiveAlertState?.("");
      }
      return false;
    }
    const severity = this._activeSeverity();
    if (severity) {
      this._host._setLiveAlertState?.(severity);
      return true;
    }
    if (clearIfMissing) this._host._setLiveAlertState?.("");
    return false;
  }

  _present(entity, severity = "alert") {
    if (!this._isAvailable() || !entity) return false;
    const index = this._host._cameraIndexByEntity?.(entity) ?? -1;
    if (index < 0) return false;
    this._host._setLiveAlertState?.(severity);
    const camera = this._host._config?.cameras?.[index];
    const grouped = cameraMemberEntities(camera).length > 1;
    const alreadyPresented = grouped
      ? this._host._activeGroupMemberOverride === entity
      : entity === this._activeLiveEntity();
    if (alreadyPresented) return true;
    void this._host._switchCamera(index, {
      source: "alert",
      origin: "live-alert-takeover",
      ...(grouped ? { groupMemberEntity: entity } : {}),
    });
    return true;
  }

  syncHaAlertState({ reportedEntities, candidates } = {}) {
    const { severityByEntity, changedAtByEntity, latestChanged } =
      reconcileActiveAlertCandidates({
        candidates,
        previousSeverityByEntity: this._haSeverityByEntity,
        previousChangedAtByEntity: this._haChangedAtByEntity,
      });
    this._haSeverityByEntity = severityByEntity;
    this._haChangedAtByEntity = changedAtByEntity;

    const configuredEntities = new Set(
      flattenCameraMembers(this._host._config?.cameras).map(
        ({ entity }) => entity,
      ),
    );
    for (const entity of this._realtimeSeverityByEntity.keys()) {
      if (!configuredEntities.has(entity)) {
        this._realtimeSeverityByEntity.delete(entity);
      }
    }

    if (latestChanged && this._isAvailable()) {
      this._present(latestChanged.entity, latestChanged.severity);
    } else {
      this._syncOutline({
        clearIfMissing:
          reportedEntities instanceof Set &&
          reportedEntities.has(this._activeLiveEntity()),
      });
    }
    return Boolean(latestChanged);
  }

  handleRealtimeMessage(message) {
    const parsed = parseRealtimeAlertMessage({
      host: this._host,
      msg: message,
      checkSeverity: false,
    });
    if (!parsed) return false;
    const { cam: entity, type } = parsed;
    const severity = String(parsed.severity || "").trim().toLowerCase();
    if (type === "end") {
      this._realtimeSeverityByEntity.delete(entity);
      if (entity === this._activeLiveEntity()) {
        this._syncOutline({ clearIfMissing: true });
      }
      return false;
    }
    if (!severity) return false;
    if (!this._host._shouldHandleSlideshowReview?.(entity, severity)) {
      return false;
    }
    const previous = this._realtimeSeverityByEntity.get(entity);
    this._realtimeSeverityByEntity.set(entity, severity);
    if (previous === severity && type !== "new") {
      this._syncOutline();
      return false;
    }
    return this._present(entity, severity);
  }
}
