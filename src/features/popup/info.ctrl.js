import {
  buildCardViewPopupOverlayMarkup,
  buildPopupInfoMarkup,
  buildPopupInfoModel,
} from "./info.js";
import { isCardViewDrawerPopupPresentation } from "./media.js";

export class PopupInfoController {
  constructor({
    query,
    getActiveCamera,
    formatTime,
    formatWeekday,
    formatMonthDay,
    formatFullDate = () => "-",
    formatEventDuration,
    onResetRecordingScrub,
    onMediaCameraChange,
    onNavigateEventMedia,
    onDownloadEvent,
    onDownloadRecording,
  } = {}) {
    this._query = query;
    this._getActiveCamera = getActiveCamera;
    this._formatTime = formatTime;
    this._formatWeekday = formatWeekday;
    this._formatMonthDay = formatMonthDay;
    this._formatFullDate = formatFullDate;
    this._formatEventDuration = formatEventDuration;
    this._onResetRecordingScrub = onResetRecordingScrub;
    this._onMediaCameraChange = onMediaCameraChange;
    this._onNavigateEventMedia = onNavigateEventMedia;
    this._onDownloadEvent = onDownloadEvent;
    this._onDownloadRecording = onDownloadRecording;
  }

  render(event = null, options = {}) {
    const info = this._query?.("#popup-info");
    if (!info) return null;

    const model = buildPopupInfoModel({
      event,
      options,
      activeCamera: this._getActiveCamera?.() || "",
      formatTime: this._formatTime,
      formatWeekday: this._formatWeekday,
      formatMonthDay: this._formatMonthDay,
      formatEventDuration: this._formatEventDuration,
    });
    if (!model) {
      this.hide();
      return null;
    }

    this._onMediaCameraChange?.(model.camera);
    if (model.mediaType !== "recording") {
      this._onResetRecordingScrub?.();
    }

    if (isCardViewDrawerPopupPresentation(options.presentation)) {
      info.innerHTML = "";
      info.hidden = true;
      const overlay = buildCardViewPopupOverlayMarkup({
        model,
        fullDate: this._formatFullDate?.(
          options.startTime ?? event?.start_time,
        ),
      });
      const label = this._query?.("#popup-card-view-label");
      if (label) {
        label.textContent = overlay.labelText;
        label.hidden = false;
      }
      const actions = this._query?.("#popup-card-view-actions");
      if (actions) {
        actions.innerHTML = overlay.actionsHtml;
        actions.hidden = !overlay.actionsHtml;
      }
      return model;
    }

    this._clearCardViewOverlay();

    const markup = buildPopupInfoMarkup({ event, model });
    info.innerHTML = markup.infoHtml;
    info.hidden = false;
    return model;
  }

  hide() {
    const info = this._query?.("#popup-info");
    this._onResetRecordingScrub?.();
    this._onMediaCameraChange?.("");
    if (info) {
      info.innerHTML = "";
      info.hidden = true;
    }
    this._clearCardViewOverlay();
  }

  _clearCardViewOverlay() {
    const label = this._query?.("#popup-card-view-label");
    if (label) {
      label.textContent = "";
      label.hidden = true;
    }
    const actions = this._query?.("#popup-card-view-actions");
    if (actions) {
      actions.innerHTML = "";
      actions.hidden = true;
    }
  }

  handleClick(event, target = event?.target) {
    const mediaNavigationAction = target?.closest?.(
      ".popup-action[data-popup-media-target]",
    );
    if (mediaNavigationAction) {
      event?.stopPropagation?.();
      this._onNavigateEventMedia?.(
        mediaNavigationAction.dataset.popupEventId,
        mediaNavigationAction.dataset.popupMediaTarget,
      );
      return true;
    }

    const recordingAction = target?.closest?.(
      ".popup-action[data-rec-dl-start]",
    );
    if (recordingAction) {
      event?.stopPropagation?.();
      const start = Number(recordingAction.dataset.recDlStart);
      const end = Number(recordingAction.dataset.recDlEnd);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        this._onDownloadRecording?.(start, end);
      }
      return true;
    }

    const eventAction = target?.closest?.(".popup-action[data-dl]");
    if (!eventAction) return false;
    event?.stopPropagation?.();
    this._onDownloadEvent?.(
      eventAction.dataset.dl,
      eventAction.dataset.dlFile,
    );
    return true;
  }
}
