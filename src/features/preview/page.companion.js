import { ensureShadowStyle } from "../../shared/shadow-styles.js";
import { PreviewAlertController } from "./alert.ctrl.js";
import { PreviewPageController } from "./page.ctrl.js";
import { buildPreviewPageMainLayoutShellMarkup } from "./page.tmpl.js";
import { PREVIEW_PAGE_STYLES } from "./page.styles.js";

export const PREVIEW_PAGE_STYLE_ATTRIBUTE =
  "data-fvc-preview-page-styles";

export const installPreviewPageStyles = (host) =>
  ensureShadowStyle(host, {
    attribute: PREVIEW_PAGE_STYLE_ATTRIBUTE,
    cssText: PREVIEW_PAGE_STYLES,
  });

export const createPreviewControllers = (host, constants = {}) => ({
  alert: new PreviewAlertController(host, constants.alert),
  page: new PreviewPageController(host, constants.page),
});

export {
  PreviewAlertController,
  PreviewPageController,
  buildPreviewPageMainLayoutShellMarkup,
};
