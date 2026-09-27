import { ensureShadowStyle } from "../../shared/shadow-styles.js";
import { WideViewPageController } from "./page.ctrl.js";
import { buildWideViewMainLayoutShellMarkup } from "./page.tmpl.js";
import { WIDE_VIEW_PAGE_STYLES } from "./page.styles.js";

export const WIDE_VIEW_PAGE_STYLE_ATTRIBUTE =
  "data-fvc-wide-view-page-styles";

export const installWideViewPageStyles = (host) =>
  ensureShadowStyle(host, {
    attribute: WIDE_VIEW_PAGE_STYLE_ATTRIBUTE,
    cssText: WIDE_VIEW_PAGE_STYLES,
  });

export { WideViewPageController, buildWideViewMainLayoutShellMarkup };
