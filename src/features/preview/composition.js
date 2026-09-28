import {
  DAY,
  PREVIEW_ALERT_END_GRACE_MS,
  PREVIEW_ALERT_HOLD_MS,
  SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC,
} from "../../constants.js";
import { DEVICE_PROFILE } from "../../helpers.js";
import { PAGE_IDS } from "../navigation/router.js";
import { createLazyPreviewControllers } from "./page.loader.js";

export const initializePreviewControllers = (card) => {
  const controllers = createLazyPreviewControllers(card, {
    alert: {
      DAY,
      PREVIEW_ALERT_HOLD_MS,
      PREVIEW_ALERT_END_GRACE_MS,
      SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC,
    },
    page: {
      PAGE_IDS,
      DEVICE_PROFILE,
    },
  });
  card._previewAlertController = controllers.alert;
  card._previewPageController = controllers.page;
};
