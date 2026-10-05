import {
  resolveFrigateCameraRuntimeState,
  setFrigateCameraRuntimeSuspended,
} from "../../integrations/home-assistant/frigate-camera-runtime.js";
import { CARD_DISPLAY_NAME } from "../../product-identity.mjs";
import { applyLocalizedText } from "../localization/localized-dom.js";
import {
  hasCurrentHaDirectLiveEvidence,
  isLiveTransportType,
} from "./stream.state.js";
import { buildLiveCameraPowerControlMarkup } from "./view.tmpl.js";
import { canUserManageCameraSuspension } from "./camera-suspension-policy.js";

const CONFIRMATION_TIMEOUT_MS = 12000;
const DIALOG_COPY = Object.freeze({
  suspend: {
    titleKey: "runtime.live.cameraSuspendDialogTitle",
    title: "Suspend camera?",
    detailKey: "runtime.live.cameraSuspendDialogDetail",
    detail:
      "Suspending this camera in Frigate stops live video, recordings, and detections. Existing alerts, clips, snapshots, and recordings remain available in the card. If Frigate restarts, Frigate will lift this suspension automatically.",
    warningKey: "runtime.live.cameraSuspendDialogWarning",
    warning:
      `Warning: Suspending this camera disables live view and recording in Frigate, Home Assistant, and ${CARD_DISPLAY_NAME}. It does not stop recording to the camera’s SD card or prevent direct live connections through go2rtc.`,
    actionKey: "runtime.live.suspendCamera",
    action: "Suspend camera",
  },
  resume: {
    titleKey: "runtime.live.cameraResumeDialogTitle",
    title: "Resume camera?",
    detailKey: "runtime.live.cameraResumeDialogDetail",
    detail:
      "Resuming this camera in Frigate restores live video, recordings, and detections. Frigate may need a short time before live video and new events become available.",
    actionKey: "runtime.live.resumeCamera",
    action: "Resume camera",
  },
});

export class FrigateCameraRuntimeController {
  constructor(host, { icons = {}, confirmationTimeoutMs } = {}) {
    this._host = host;
    this._icons = icons;
    this._confirmationTimeoutMs =
      Number(confirmationTimeoutMs) || CONFIRMATION_TIMEOUT_MS;
    this._activeSnapshot = null;
    this._confirmedResumedEntities = new Set();
    this._pending = null;
    this._confirmationTimer = null;
    this._dialogState = null;
    this._dialogElement = null;
    this._dialogDocument = null;
    this._dialogReturnFocus = null;
    this._onDialogKeyDown = (event) => this._handleDialogKeyDown(event);
    this._onDocumentClick = (event) => this._handleDocumentClick(event);
  }

  activeEntity() {
    return String(
      this._host._activeGroupMemberOverride ||
        this._host._activeCam?.entity ||
        "",
    ).trim();
  }

  _resolveReportedState(entity = this.activeEntity()) {
    const normalizedEntity = String(entity || "").trim();
    return resolveFrigateCameraRuntimeState({
      entity: normalizedEntity,
      state: this._host._hass?.states?.[normalizedEntity] || null,
    });
  }

  resolve(entity = this.activeEntity()) {
    const runtime = this._resolveReportedState(entity);
    if (
      runtime.suspended &&
      !runtime.unavailable &&
      this._confirmedResumedEntities.has(runtime.entity)
    ) {
      return { ...runtime, suspended: false };
    }
    return runtime;
  }

  isSuspended(entity = this.activeEntity()) {
    return this.resolve(entity).suspended;
  }

  _hasCommittedLiveEvidence() {
    const activeEntity = this.activeEntity();
    return Boolean(
      activeEntity &&
        activeEntity === this._host._committedLiveAvailabilityEntity &&
        this._host._engine &&
        this._host._committedLiveAvailabilityEngine === this._host._engine &&
        hasCurrentHaDirectLiveEvidence(
          this._host._engine, this._host._hass?.states?.[activeEntity],
        ) &&
        isLiveTransportType(this._host._activeStreamType),
    );
  }

  _sharesActiveFrigateClient(entity) {
    const activeState = this._host._hass?.states?.[this.activeEntity()];
    const candidateState = this._host._hass?.states?.[entity];
    const clientId = (state) =>
      String(
        state?.attributes?.client_id ||
          state?.attributes?.mqtt_client_id ||
          "",
      ).trim();
    const activeClientId = clientId(activeState);
    return Boolean(
      activeClientId && activeClientId === clientId(candidateState),
    );
  }

  isAvailable(entity = this.activeEntity()) {
    const normalizedEntity = String(entity || "").trim();
    const state = this._host._hass?.states?.[normalizedEntity] || null;
    if (!state) return true;
    const runtime = this.resolve(normalizedEntity);
    if (runtime.suspended) return false;
    if (!runtime.unavailable) return true;
    if (!this._hasCommittedLiveEvidence()) return false;
    if (normalizedEntity === this.activeEntity()) return true;

    // A playing stream disproves the active entity's stale unavailable state.
    // Treat sibling entities from the same Frigate client consistently until
    // Home Assistant finishes publishing their recovered states.
    return (
      this._resolveReportedState(this.activeEntity()).unavailable &&
      this._sharesActiveFrigateClient(normalizedEntity)
    );
  }

  canManageCameraSuspension() {
    return canUserManageCameraSuspension({
      access: this._host._config?.camera_suspend_access,
      user: this._host._hass?.user,
    });
  }

  canShowControl(runtime = this.resolve()) {
    return (
      this._host._viewMode !== "grid" &&
      runtime.controllable &&
      this.canManageCameraSuspension()
    );
  }

  buildControlMarkup({ buttonClass = "square-btn" } = {}) {
    const runtime = this.resolve();
    return buildLiveCameraPowerControlMarkup({
      icons: this._icons,
      buttonClass,
      suspended: runtime.suspended,
      hidden: !this.canShowControl(runtime),
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
      placement: "live",
      tone,
    });
  }

  _finishPending(runtime) {
    if (!this._pending || this._pending.entity !== runtime.entity) return;
    if (this._pending.serviceResolved !== true) return;
    const confirmed = this._pending.suspended
      ? runtime.suspended
      : !runtime.suspended && !runtime.unavailable;
    if (!confirmed) return;
    const suspended = this._pending.suspended;
    if (suspended) {
      this._confirmedResumedEntities.delete(runtime.entity);
    } else {
      this._confirmedResumedEntities.add(runtime.entity);
    }
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
    button.hidden = !this.canShowControl(runtime);
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

  _setDialogText(element, key, fallback, values = null) {
    if (!element) return;
    element.setAttribute?.("data-fvc-i18n", key);
    if (values) {
      element.setAttribute?.(
        "data-fvc-i18n-values",
        JSON.stringify(values),
      );
    } else {
      element.removeAttribute?.("data-fvc-i18n-values");
    }
    element.textContent = fallback;
  }

  _renderConfirmationDialog({ focus = false } = {}) {
    if (!this._dialogState) return false;
    const modal = this._host._$("#camera-runtime-confirmation-modal");
    if (!modal) return false;
    if (this._dialogElement !== modal) {
      this._dialogElement?.removeEventListener?.(
        "keydown",
        this._onDialogKeyDown,
      );
      this._dialogElement = modal;
      modal.addEventListener?.("keydown", this._onDialogKeyDown);
    }

    const suspending = this._dialogState.suspended;
    const copy = suspending ? DIALOG_COPY.suspend : DIALOG_COPY.resume;
    const title = modal.querySelector?.("#camera-runtime-confirmation-title");
    const detail = modal.querySelector?.("#camera-runtime-confirmation-detail");
    const warning = modal.querySelector?.(
      "#camera-runtime-confirmation-warning",
    );
    const submit = modal.querySelector?.("#camera-runtime-confirmation-submit");
    this._setDialogText(title, copy.titleKey, copy.title);
    this._setDialogText(detail, copy.detailKey, copy.detail);
    if (warning) {
      warning.hidden = !suspending;
      if (suspending) {
        this._setDialogText(warning, copy.warningKey, copy.warning, {
          cardName: CARD_DISPLAY_NAME,
        });
      }
    }
    this._setDialogText(submit, copy.actionKey, copy.action);
    submit?.setAttribute?.("data-fvc-i18n-title", copy.actionKey);
    submit?.setAttribute?.("data-fvc-i18n-aria-label", copy.actionKey);
    submit?.setAttribute?.("title", copy.action);
    submit?.setAttribute?.("aria-label", copy.action);
    submit?.classList?.toggle?.("is-resume", !suspending);
    modal.dataset.cameraRuntimeAction = suspending ? "suspend" : "resume";
    modal.hidden = false;
    const ownerDocument = modal.ownerDocument || globalThis.document;
    if (this._dialogDocument !== ownerDocument) {
      this._dialogDocument?.removeEventListener?.(
        "click",
        this._onDocumentClick,
        true,
      );
      this._dialogDocument = ownerDocument || null;
      this._dialogDocument?.addEventListener?.(
        "click",
        this._onDocumentClick,
        true,
      );
    }
    applyLocalizedText(modal, this._host._localization?.t);
    if (focus) {
      modal.querySelector?.(".camera-runtime-confirmation-cancel")?.focus?.();
    }
    return true;
  }

  openConfirmation() {
    const runtime = this.resolve();
    if (
      !this.canShowControl(runtime) ||
      this._pending
    ) {
      return false;
    }
    this.closeConfirmation({ restoreFocus: false });
    this._dialogState = {
      entity: runtime.entity,
      suspended: !runtime.suspended,
    };
    this._dialogReturnFocus = this._host._$("#live-camera-power-btn");
    if (this._renderConfirmationDialog({ focus: true })) return true;
    this._dialogState = null;
    this._dialogReturnFocus = null;
    return false;
  }

  closeConfirmation({ restoreFocus = true } = {}) {
    const currentModal = this._host._$("#camera-runtime-confirmation-modal");
    for (const modal of new Set([this._dialogElement, currentModal])) {
      if (!modal) continue;
      modal.removeEventListener?.("keydown", this._onDialogKeyDown);
      modal.hidden = true;
    }
    this._dialogDocument?.removeEventListener?.(
      "click",
      this._onDocumentClick,
      true,
    );
    const returnFocus = this._dialogReturnFocus;
    this._dialogState = null;
    this._dialogElement = null;
    this._dialogDocument = null;
    this._dialogReturnFocus = null;
    if (restoreFocus) returnFocus?.focus?.();
  }

  _handleDialogKeyDown(event) {
    if (!this._dialogState) return;
    if (event?.key === "Escape") {
      event.preventDefault?.();
      event.stopPropagation?.();
      this.closeConfirmation();
      return;
    }
    if (event?.key !== "Tab") return;
    const modal = this._dialogElement;
    const controls = [
      modal?.querySelector?.(".camera-runtime-confirmation-cancel"),
      modal?.querySelector?.("#camera-runtime-confirmation-submit"),
    ].filter((element) => element && !element.disabled);
    if (controls.length < 2) return;
    const active = this._host.shadowRoot?.activeElement;
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && (active === first || !controls.includes(active))) {
      event.preventDefault?.();
      last.focus?.();
    } else if (!event.shiftKey && (active === last || !controls.includes(active))) {
      event.preventDefault?.();
      first.focus?.();
    }
  }

  _handleDocumentClick(event) {
    if (!this._dialogState || !this._dialogElement) return;
    const dialog = this._dialogElement.querySelector?.(
      ".camera-runtime-confirmation-dialog",
    );
    const path = event?.composedPath?.() || [];
    if (
      path.includes(dialog) ||
      (!path.length && dialog?.contains?.(event?.target))
    ) {
      return;
    }
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    this.closeConfirmation();
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
    if (this._dialogState) {
      const dialogStillValid =
        this._dialogState.entity === runtime.entity &&
        this.canShowControl(runtime) &&
        this._dialogState.suspended !== runtime.suspended;
      if (dialogStillValid) this._renderConfirmationDialog();
      else this.closeConfirmation({ restoreFocus: false });
    }

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
    const reportedRuntime = this._resolveReportedState();
    const previous = this._activeSnapshot;
    this._finishPending(reportedRuntime);
    const runtime = this.resolve(reportedRuntime.entity);
    this._activeSnapshot = runtime;

    // Live evidence may override a stale unavailable state after recovery,
    // but it cannot override a subsequent outage. Retain the player itself.
    if (
      previous?.entity === runtime.entity &&
      !previous.unavailable &&
      runtime.unavailable
    ) {
      this._host._committedLiveAvailabilityEntity = "";
      this._host._committedLiveAvailabilityEngine = null;
      if (isLiveTransportType(this._host._activeStreamType)) {
        this._host._setActiveStreamType?.("--");
      }
    }

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

  async toggle({ entity = this.activeEntity(), suspended = null } = {}) {
    const runtime = this.resolve(entity);
    if (
      !this.canShowControl(runtime) ||
      this._pending
    ) {
      return false;
    }
    const nextSuspended =
      typeof suspended === "boolean" ? suspended : !runtime.suspended;
    if (nextSuspended === runtime.suspended) return false;
    this._pending = {
      entity: runtime.entity,
      suspended: nextSuspended,
      serviceResolved: false,
    };
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
        suspended: nextSuspended,
      });
      if (this._pending?.entity === runtime.entity) {
        this._pending.serviceResolved = true;
        this.reconcileHass();
      }
      return true;
    } catch (_) {
      this._clearPending();
      this._syncButton(this.resolve(runtime.entity));
      this._toast(
        nextSuspended
          ? "runtime.live.cameraSuspendFailed"
          : "runtime.live.cameraResumeFailed",
        nextSuspended
          ? "Unable to suspend camera"
          : "Unable to resume camera",
      );
      return false;
    }
  }

  handleClick(target) {
    if (target?.closest?.("[data-camera-runtime-confirm-cancel]")) {
      this.closeConfirmation();
      return true;
    }
    const submit = target?.closest?.("[data-camera-runtime-confirm]");
    if (submit) {
      const intent = this._dialogState;
      if (intent && !submit.disabled) {
        this.closeConfirmation({ restoreFocus: false });
        void this.toggle(intent);
      }
      return true;
    }
    if (target?.closest?.("#camera-runtime-confirmation-modal")) return true;
    const button = target?.closest?.("#live-camera-power-btn");
    if (!button) return false;
    if (!button.disabled) this.openConfirmation();
    return true;
  }

  dispose() {
    this.closeConfirmation({ restoreFocus: false });
    this._clearPending();
    this._confirmedResumedEntities.clear();
    this._activeSnapshot = null;
  }
}
