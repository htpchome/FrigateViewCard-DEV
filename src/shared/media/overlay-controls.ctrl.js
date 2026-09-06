import { CleanupController } from "../cleanup.js";
import { MEDIA_OVERLAY_TIMING } from "../../constants.js";

const TAP_MOVE_TOLERANCE_PX = 8;

export class MediaOverlayControlsController {
  constructor({
    surface,
    wrap,
    show,
    hideNow,
    hideSoon,
    cancelScheduledHide,
    revealDurationMs = 1300,
    touchRevealDurationMs = revealDurationMs,
    mouseLeaveDelayMs = MEDIA_OVERLAY_TIMING.mouse.leaveHideDelayMs,
    autoHideMouse = false,
  }) {
    this._surface = surface || wrap;
    this._show = show;
    this._hideNow = hideNow;
    this._hideSoon = hideSoon;
    this._cancelScheduledHide = cancelScheduledHide;
    this._revealDurationMs = Math.max(0, Number(revealDurationMs) || 0);
    this._touchRevealDurationMs = Math.max(
      0,
      Number(touchRevealDurationMs) || 0,
    );
    this._mouseLeaveDelayMs = Math.max(0, Number(mouseLeaveDelayMs) || 0);
    this._autoHideMouse = autoHideMouse === true;
    this._lastMouseRevealAt = 0;
    this._mouseLeaveTimer = null;
    this._cleanup = new CleanupController();
    this._pointers = new Map();
  }

  bind() {
    if (!this._surface) return;
    this._cleanup.addEventListener(
      this._surface,
      "pointerenter",
      this._onPointerEnter,
      { passive: true },
    );
    this._cleanup.addEventListener(
      this._surface,
      "pointerleave",
      this._onPointerLeave,
      { passive: true },
    );
    this._cleanup.addEventListener(
      this._surface,
      "pointerdown",
      this._onPointerDown,
      { passive: true, capture: true },
    );
    this._cleanup.addEventListener(
      this._surface,
      "pointermove",
      this._onPointerMove,
      { passive: true, capture: true },
    );
    this._cleanup.addEventListener(
      this._surface,
      "pointerup",
      this._onPointerUp,
      { passive: true, capture: true },
    );
    this._cleanup.addEventListener(
      this._surface,
      "pointercancel",
      this._onPointerCancel,
      { passive: true, capture: true },
    );
  }

  dispose() {
    this._cleanup.dispose();
    this._pointers.clear();
    this._clearMouseLeaveTimer();
    this._hideNow?.();
  }

  _onPointerEnter = (event) => {
    if (event?.pointerType !== "mouse") return;
    this._clearMouseLeaveTimer();
    const interaction = { pointerType: "mouse" };
    this._show?.(interaction);
    if (this._autoHideMouse) {
      this._lastMouseRevealAt = Date.now();
      this._hideSoon?.(this._revealDurationMs, interaction);
    }
  };

  _onPointerLeave = (event) => {
    if (event?.pointerType !== "mouse") return;
    this._clearMouseLeaveTimer();
    this._cancelScheduledHide?.();
    if (this._mouseLeaveDelayMs <= 0) {
      this._hideNow?.();
      return;
    }
    this._mouseLeaveTimer = setTimeout(() => {
      this._mouseLeaveTimer = null;
      this._hideNow?.();
    }, this._mouseLeaveDelayMs);
  };

  _clearMouseLeaveTimer() {
    if (this._mouseLeaveTimer === null) return;
    clearTimeout(this._mouseLeaveTimer);
    this._mouseLeaveTimer = null;
  }

  _onPointerDown = (event) => {
    const pointerType = String(event?.pointerType || "").toLowerCase();
    if (pointerType === "mouse") return;
    if (event?.target?.closest?.("[data-media-overlay-ignore]")) return;
    this._pointers.set(event.pointerId, {
      startX: Number(event.clientX) || 0,
      startY: Number(event.clientY) || 0,
      moved: false,
    });
    if (this._pointers.size > 1) {
      this._pointers.forEach((pointer) => {
        pointer.moved = true;
      });
    }
  };

  _onPointerMove = (event) => {
    if (event?.pointerType === "mouse") {
      if (!this._autoHideMouse || Number(event?.buttons) > 0) return;
      const now = Date.now();
      if (now - this._lastMouseRevealAt < 100) return;
      this._lastMouseRevealAt = now;
      const interaction = { pointerType: "mouse" };
      this._show?.(interaction);
      this._hideSoon?.(this._revealDurationMs, interaction);
      return;
    }
    const pointer = this._pointers.get(event.pointerId);
    if (!pointer || pointer.moved) return;
    const distance = Math.hypot(
      (Number(event.clientX) || 0) - pointer.startX,
      (Number(event.clientY) || 0) - pointer.startY,
    );
    if (distance > TAP_MOVE_TOLERANCE_PX) pointer.moved = true;
  };

  _onPointerUp = (event) => {
    const pointer = this._pointers.get(event.pointerId);
    this._pointers.delete(event.pointerId);
    if (!pointer || pointer.moved) return;
    const interaction = { pointerType: "touch" };
    this._show?.(interaction);
    this._hideSoon?.(this._touchRevealDurationMs, interaction);
  };

  _onPointerCancel = (event) => {
    this._pointers.delete(event.pointerId);
  };
}
