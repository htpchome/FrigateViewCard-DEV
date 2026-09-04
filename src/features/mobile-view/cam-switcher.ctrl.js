export class MobileCamSwitcherController {
  constructor(options = {}) {
    this._isOpen =
      typeof options.isOpen === "function" ? options.isOpen : () => false;
    this._setOpen =
      typeof options.setOpen === "function" ? options.setOpen : () => {};
    this._renderCamSwitcher =
      typeof options.renderCamSwitcher === "function"
        ? options.renderCamSwitcher
        : () => {};
    this._getPicker =
      typeof options.getPicker === "function" ? options.getPicker : () => null;
    this._pauseSlideshowForInteraction =
      typeof options.pauseSlideshowForInteraction === "function"
        ? options.pauseSlideshowForInteraction
        : () => {};
    this._switchCamera =
      typeof options.switchCamera === "function"
        ? options.switchCamera
        : () => Promise.resolve();
    this._pointerGesture = null;
    this._suppressedClick = null;
  }

  _actionForTarget(target) {
    return (
      target?.closest?.("[data-mobile-cam-trigger]") ||
      target?.closest?.("[data-mobile-camidx]") ||
      null
    );
  }

  _activateTarget(target) {
    const trigger = target?.closest?.("[data-mobile-cam-trigger]");
    if (trigger) {
      const open = !this._isOpen();
      this._setOpen(open);
      if (!this._syncOpenState(open)) this._renderCamSwitcher();
      return true;
    }

    const option = target?.closest?.("[data-mobile-camidx]");
    if (option) {
      const idx = Number(option.dataset.mobileCamidx);
      this._setOpen(false);
      this._syncOpenState(false);
      if (Number.isInteger(idx) && idx >= 0) {
        this._pauseSlideshowForInteraction();
        void this._switchCamera(idx);
      } else {
        this._renderCamSwitcher();
      }
      return true;
    }

    return false;
  }

  handleClickTarget(target) {
    const action = this._actionForTarget(target);
    const suppressed = this._suppressedClick;
    const suppressionActive =
      suppressed && Date.now() <= suppressed.until;
    const retargetedInsideSwitcher =
      !action &&
      (target?.closest?.("[data-mobile-cam-switcher-content]") ||
        target?.closest?.('[data-fvc-region="camera-switcher"]'));
    if (
      suppressionActive &&
      (suppressed.action === action || retargetedInsideSwitcher)
    ) {
      this._suppressedClick = null;
      return true;
    }
    if (suppressed && !suppressionActive) this._suppressedClick = null;
    if (!action) return false;
    this._suppressedClick = null;
    return this._activateTarget(target);
  }

  handlePointerDown(event, target = event?.target) {
    if (String(event?.pointerType || "").toLowerCase() === "mouse") {
      return false;
    }
    const action = this._actionForTarget(target);
    if (!action || event?.isPrimary === false) return false;
    this._pointerGesture = {
      action,
      target,
      pointerId: event?.pointerId,
      x: Number(event?.clientX) || 0,
      y: Number(event?.clientY) || 0,
    };
    return true;
  }

  handlePointerUp(event, target = event?.target) {
    const gesture = this._pointerGesture;
    this._pointerGesture = null;
    if (!gesture || gesture.pointerId !== event?.pointerId) return false;
    const action = this._actionForTarget(target);
    const moved = Math.hypot(
      (Number(event?.clientX) || 0) - gesture.x,
      (Number(event?.clientY) || 0) - gesture.y,
    ) > 8;
    if (moved || (action && action !== gesture.action)) return false;
    const activationTarget = action ? target : gesture.target;
    this._suppressedClick = {
      action: gesture.action,
      until: Date.now() + 800,
    };
    event?.preventDefault?.();
    return this._activateTarget(activationTarget);
  }

  cancelPointer() {
    this._pointerGesture = null;
  }

  closeIfOutside(target) {
    if (!this._isOpen()) return;
    const inPicker = target?.closest?.("[data-mobile-cam-picker]");
    if (inPicker) return;
    this.close();
  }

  close() {
    if (!this._isOpen()) return;
    this._setOpen(false);
    if (!this._syncOpenState(false)) this._renderCamSwitcher();
  }

  _syncOpenState(open) {
    const picker = this._getPicker();
    const trigger = picker?.querySelector?.("[data-mobile-cam-trigger]");
    const panel = picker?.querySelector?.("[data-mobile-cam-panel]");
    if (!picker || !trigger || !panel) return false;
    picker.classList?.toggle?.("is-open", open === true);
    trigger.setAttribute?.("aria-expanded", open ? "true" : "false");
    panel.hidden = open !== true;
    return true;
  }
}
