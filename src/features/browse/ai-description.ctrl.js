import { applyLocalizedText } from "../localization/localized-dom.js";

const SWIPE_CLOSE_DISTANCE_PX = 72;

export class BrowseAiDescriptionController {
  constructor(host) {
    this._host = host;
    this._lastTrigger = null;
    this._drag = null;
    this._onKeyDown = (event) => {
      if (event.key === "Escape") this.close();
    };
    this._onPointerMove = (event) => this._handlePointerMove(event);
    this._onPointerEnd = (event) => this._handlePointerEnd(event);
  }

  handleClick(event, target) {
    const close = target?.closest?.("[data-ai-description-close]");
    if (close) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      this.close();
      return true;
    }

    const trigger = target?.closest?.("[data-ai-description-open]");
    if (!trigger) return false;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    this.open(trigger);
    return true;
  }

  handlePointerDown(event, target) {
    if (!this._host._isLikelyPhoneClient?.()) return false;
    if (target?.closest?.("button")) return false;
    const handle = target?.closest?.("[data-ai-description-drag-handle]");
    const dialog = handle?.closest?.(".browse-ai-dialog");
    if (!dialog || event.button > 0) return false;

    this._drag = {
      dialog,
      pointerId: event.pointerId,
      startY: event.clientY,
      offsetY: 0,
    };
    dialog.classList.add("is-dragging");
    try {
      handle.setPointerCapture?.(event.pointerId);
    } catch (_) {
      // Pointer capture can be unavailable in older embedded WebViews.
    }
    const documentTarget = dialog.ownerDocument;
    documentTarget.addEventListener("pointermove", this._onPointerMove);
    documentTarget.addEventListener("pointerup", this._onPointerEnd);
    documentTarget.addEventListener("pointercancel", this._onPointerEnd);
    event.preventDefault?.();
    return true;
  }

  open(trigger) {
    const modal = this._modal();
    if (!modal) return;
    const title = String(trigger?.dataset?.aiTitle || "").trim();
    if (!title) return;

    const description = String(
      trigger.dataset.aiDescription || "",
    ).trim();
    const score = String(trigger.dataset.aiScore || "").trim();
    const concerns = String(trigger.dataset.aiConcerns || "").trim();
    const none = this._host._localization?.t?.("runtime.browse.ai.none") || "None";

    this._setField(modal, "title", title);
    this._setField(modal, "description", description);
    this._setField(modal, "score", score ? `${score}%` : "", {
      hideWhenEmpty: true,
    });
    this._setField(modal, "concerns", concerns || none);
    applyLocalizedText(modal, this._host._localization?.t);

    this._lastTrigger = trigger;
    modal.hidden = false;
    modal.classList.add("is-open");
    const dialog = modal.querySelector(".browse-ai-dialog");
    dialog?.ownerDocument?.addEventListener("keydown", this._onKeyDown);
    modal.querySelector(".browse-ai-dialog-close")?.focus?.();
  }

  close({ restoreFocus = true } = {}) {
    const modal = this._modal();
    this._cancelDrag();
    if (modal) {
      modal.classList.remove("is-open");
      modal.hidden = true;
      modal.querySelector(".browse-ai-dialog")?.style.removeProperty("transform");
      modal.ownerDocument?.removeEventListener("keydown", this._onKeyDown);
    }
    if (restoreFocus && this._lastTrigger?.isConnected) {
      this._lastTrigger.focus?.();
    }
    this._lastTrigger = null;
  }

  dispose() {
    this.close({ restoreFocus: false });
  }

  _modal() {
    return this._host.shadowRoot?.querySelector?.("[data-browse-ai-modal]") || null;
  }

  _setField(modal, name, value, { hideWhenEmpty = false } = {}) {
    const field = modal.querySelector(`[data-ai-field="${name}"]`);
    const output = field?.querySelector?.(`[data-ai-value="${name}"]`);
    if (field) field.hidden = hideWhenEmpty && !value;
    if (output) output.textContent = value;
  }

  _handlePointerMove(event) {
    if (!this._drag || event.pointerId !== this._drag.pointerId) return;
    const offsetY = Math.max(0, event.clientY - this._drag.startY);
    this._drag.offsetY = offsetY;
    this._drag.dialog.style.transform = `translateY(${offsetY}px)`;
  }

  _handlePointerEnd(event) {
    if (!this._drag || event.pointerId !== this._drag.pointerId) return;
    const shouldClose = this._drag.offsetY >= SWIPE_CLOSE_DISTANCE_PX;
    const dialog = this._drag.dialog;
    this._cancelDrag();
    if (shouldClose) {
      this.close();
      return;
    }
    dialog.style.removeProperty("transform");
  }

  _cancelDrag() {
    if (!this._drag) return;
    const { dialog } = this._drag;
    const documentTarget = dialog.ownerDocument;
    dialog.classList.remove("is-dragging");
    documentTarget.removeEventListener("pointermove", this._onPointerMove);
    documentTarget.removeEventListener("pointerup", this._onPointerEnd);
    documentTarget.removeEventListener("pointercancel", this._onPointerEnd);
    this._drag = null;
  }
}
