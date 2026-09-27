import { SlideshowAlertController } from "./alert.ctrl.js";
import { SlideshowPageController } from "./page.ctrl.js";

export const createSlideshowRuntimeControllers = (
  host,
  { alertConstants = {} } = {},
) => ({
  alert: new SlideshowAlertController(host, alertConstants),
  page: new SlideshowPageController(host),
});
