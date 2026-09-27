import {
  buildCalendarPanelMarkup,
  buildFilterPanelMarkup,
} from "../browse/calendar-filter.tmpl.js";
import { ensureShadowStyle } from "../../shared/shadow-styles.js";
import { CardViewPageController } from "./page.ctrl.js";
import { buildCardViewMainLayoutShellMarkup } from "./page.tmpl.js";
import { CARD_VIEW_PAGE_STYLES } from "./page.styles.js";

export const CARD_VIEW_PAGE_STYLE_ATTRIBUTE =
  "data-fvc-card-view-page-styles";

export const installCardViewPageStyles = (host) =>
  ensureShadowStyle(host, {
    attribute: CARD_VIEW_PAGE_STYLE_ATTRIBUTE,
    cssText: CARD_VIEW_PAGE_STYLES,
  });

export const createCardViewPageController = (host, constants = {}) =>
  new CardViewPageController(host, {
    ...constants,
    buildCalendarPanelMarkup,
    buildFilterPanelMarkup,
  });

export { CardViewPageController, buildCardViewMainLayoutShellMarkup };
