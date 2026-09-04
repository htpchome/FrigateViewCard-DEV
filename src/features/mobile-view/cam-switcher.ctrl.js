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
      this._setOpen(!this._isOpen());
      this._renderCamSwitcher();
      return true;
    }

    const option = target?.closest?.("[data-mobile-camidx]");
    if (option) {
      const idx = Number(option.dataset.mobileCamidx);
      this._setOpen(false);
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
    if (!action) return false;
    if (
      this._suppressedClick?.action === action &&
      Date.now() <= this._suppressedClick.until
    ) {
      this._suppressedClick = null;
      return true;
    }
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
    if (moved || action !== gesture.action) return false;
    this._suppressedClick = {
      action,
      until: Date.now() + 800,
    };
    event?.preventDefault?.();
    return this._activateTarget(target);
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
    this._renderCamSwitcher();
  }
}
