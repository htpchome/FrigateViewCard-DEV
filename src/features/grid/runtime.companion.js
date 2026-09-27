import { GridAlertController } from "./alert.ctrl.js";
import { GridPageController } from "./page.ctrl.js";
import { GridMediaController } from "./runtime-media.ctrl.js";

export const createGridRuntimeControllers = (host, options = {}) => ({
  alert: new GridAlertController(host, options.alertConstants || {}),
  page: new GridPageController(host),
  media: new GridMediaController(host, {
    cameraCellMediaController: options.cameraCellMediaController,
    buildLabelText: options.buildLabelText,
    liveIconSvg: options.liveIconSvg,
  }),
});

export { GridAlertController, GridPageController, GridMediaController };
