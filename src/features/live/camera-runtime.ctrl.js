import {
  resolveFrigateCameraRuntimeState,
  setFrigateCameraRuntimeSuspended,
} from "../../integrations/home-assistant/frigate-camera-runtime.js";
import { applyLocalizedText } from "../localization/localized-dom.js";
import { buildLiveCameraPowerControlMarkup } from "./view.tmpl.js";

const CONFIRMATION_TIMEOUT_MS = 12000;

export class FrigateCameraRuntimeController {
  constructor(host, { icons = {}, confirmationTimeoutMs } = {}) {
    this._host = host;
    this._icons = icons;
    this._confirmationTimeoutMs =
      Number(confirmationTimeoutMs) || CONFIRMATION_TIMEOUT_MS;
    this._activeSnapshot = null;
    this._pending = null;
    this._confirmationTimer = null;
  }

  activeEntity() {
    return String(
      this._host._activeGroupMemberOverride ||
        this._host._activeCam?.entity ||
        "",
    ).trim();
  }

  resolve(entity = this.activeEntity()) {
    const normalizedEntity = String(entity || "").trim();
    return resolveFrigateCameraRuntimeState({
      entity: normalizedEntity,
      state: this._host._hass?.states?.[normalizedEntity] || null,
    });
  }

  isSuspended(entity = this.activeEntity()) {
    return this.resolve(entity).suspended;
  }

  isAvailable(entity = this.activeEntity()) {
    const normalizedEntity = String(entity || "").trim();
    const state = this._host._hass?.states?.[normalizedEntity] || null;
    if (!state) return true;
    const runtime = this.resolve(normalizedEntity);
    return !runtime.unavailable && !runtime.suspended;
  }

  buildControlMarkup({ buttonClass = "square-btn" } = {}) {
    const runtime = this.resolve();
    return buildLiveCameraPowerControlMarkup({
      icons: this._icons,
      buttonClass,
      suspended: runtime.suspended,
      hidden: !runtime.controllable,
    });
  }

  _clearConfirmationTimer() {
    if (this._confirmationTimer) {
      globalThis.clearTimeout?.(this._confirmationTimer);
    }
    this._confirmationTimer = null;
  }

  _clearPending() {
    this._clearConfirmationTimer();
    this._pending = null;
  }

  _toast(key, fallback, tone = "error") {
    this._host._toast?.(fallback, {
      localizationKey: key,
      tone,
    });
  }

  _finishPending(runtime) {
    if (!this._pending || this._pending.entity !== runtime.entity) return;
    const confirmed = this._pending.suspended
      ? runtime.suspended
      : !runtime.suspended && !runtime.unavailable;
    if (!confirmed) return;
    const suspended = this._pending.suspended;
    this._clearPending();
    this._toast(
      suspended
        ? "runtime.live.cameraSuspendedConfirmation"
        : "runtime.live.cameraResumed",
      suspended ? "Camera suspended" : "Camera resumed",
      "success",
    );
  }

  _syncButton(runtime) {
    const button = this._host._$("#live-camera-power-btn");
    if (!button) return;
    const pending = this._pending?.entity === runtime.entity;
    const suspending = pending && this._pending.suspended;
    const labelKey = pending
      ? suspending
        ? "runtime.live.suspendingCamera"
        : "runtime.live.resumingCamera"
      : runtime.suspended
        ? "runtime.live.resumeCamera"
        : "runtime.live.suspendCamera";
    const fallback = pending
      ? suspending
        ? "Suspending camera…"
        : "Resuming camera…"
      : runtime.suspended
        ? "Resume camera"
        : "Suspend camera";
    button.hidden = !runtime.controllable;
    button.disabled = pending;
    button.classList?.toggle?.("is-camera-suspended", runtime.suspended);
    button.classList?.toggle?.("is-pending", pending);
    button.setAttribute?.("aria-pressed", runtime.suspended ? "true" : "false");
    button.setAttribute?.("data-fvc-i18n-title", labelKey);
    button.setAttribute?.("data-fvc-i18n-aria-label", labelKey);
    button.setAttribute?.("title", fallback);
    button.setAttribute?.("aria-label", fallback);
    applyLocalizedText(button.parentElement || button, this._host._localization?.t);
  }

  sync(entity = this.activeEntity()) {
    const runtime = this.resolve(entity);
    const isActive = runtime.entity === this.activeEntity();
    if (!isActive) return runtime;

    const placeholder = this._host._$("#camera-suspended-placeholder");
    const liveStage = this._host._$("#live-stage");
    const engineWrap = this._host._$("#eng-wrap");
    if (placeholder) placeholder.hidden = !runtime.suspended;
    liveStage?.classList?.toggle?.(
      "camera-runtime-suspended",
      runtime.suspended,
    );
    engineWrap?.classList?.toggle?.(
      "camera-runtime-suspended",
      runtime.suspended,
    );
    this._syncButton(runtime);

    if (runtime.suspended) {
      this._host._setStreamLoading?.(false);
      this._host._stopStreamFallbackLoadingRefresh?.();
      this._host._setStreamFallbackVisible?.(false);
      if (this._host._activeStreamType !== "suspended") {
        this._host._setActiveStreamType?.("suspended");
      }
    }
    return runtime;
  }

  applySuspendedMountState(entity = this.activeEntity()) {
    const runtime = this.resolve(entity);
    if (!runtime.suspended) return false;
    this.sync(runtime.entity);
    return true;
  }

  _deactivateActiveLive(entity) {
    if (!entity || entity !== this.activeEntity()) return;
    void this._host._stopTwoWayTalkSession?.({ restoreLive: false });
    this._host._cancelPendingMount?.("camera-suspended");
    this._host._clearLiveEngineSlot?.();
    this._host._liveGraceController?.evictEntity?.(entity);
    this.sync(entity);
  }

  reconcileHass() {
    const runtime = this.resolve();
    const previous = this._activeSnapshot;
    this._activeSnapshot = runtime;
    this._finishPending(runtime);

    if (
      this._host._started === true &&
      runtime.suspended &&
      (!previous ||
        previous.entity !== runtime.entity ||
        !previous.suspended)
    ) {
      this._deactivateActiveLive(runtime.entity);
      return runtime;
    }
    if (
      this._host._started === true &&
      previous?.entity === runtime.entity &&
      previous.suspended &&
      !runtime.suspended &&
      !runtime.unavailable
    ) {
      this.sync(runtime.entity);
      this._host._scheduleResumeLive?.("camera-resumed");
      return runtime;
    }
    this.sync(runtime.entity);
    return runtime;
  }

  async toggle() {
    const runtime = this.resolve();
    if (!runtime.controllable || this._pending) return false;
    const suspended = !runtime.suspended;
    this._pending = { entity: runtime.entity, suspended };
    this._syncButton(runtime);
    this._clearConfirmationTimer();
    this._confirmationTimer = globalThis.setTimeout?.(() => {
      if (!this._pending || this._pending.entity !== runtime.entity) return;
      this._clearPending();
      this._syncButton(this.resolve(runtime.entity));
      this._toast(
        "runtime.live.cameraStateConfirmationFailed",
        "Home Assistant did not confirm the camera state change.",
      );
    }, this._confirmationTimeoutMs);

    try {
      await setFrigateCameraRuntimeSuspended({
        hass: this._host._hass,
        entity: runtime.entity,
        suspended,
      });
      return true;
    } catch (_) {
      this._clearPending();
      this._syncButton(this.resolve(runtime.entity));
      this._toast(
        suspended
          ? "runtime.live.cameraSuspendFailed"
          : "runtime.live.cameraResumeFailed",
        suspended ? "Unable to suspend camera" : "Unable to resume camera",
      );
      return false;
    }
  }

  handleClick(target) {
    const button = target?.closest?.("#live-camera-power-btn");
    if (!button) return false;
    if (!button.disabled) void this.toggle();
    return true;
  }

  dispose() {
    this._clearPending();
    this._activeSnapshot = null;
  }
}
