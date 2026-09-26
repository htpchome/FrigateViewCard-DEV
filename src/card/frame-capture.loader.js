import { VERSION } from "../constants.js";

const FRAME_CAPTURE_ASSET_NAME = "frigate-view-card-frame-capture.js";
const frameCaptureModuleState = { promise: null };

export const ensureDisplayedFrameCaptureModule = ({
  importModule = (url) => import(url),
  baseUrl = import.meta.url,
} = {}) => {
  if (frameCaptureModuleState.promise) {
    return frameCaptureModuleState.promise;
  }
  const assetUrl = new URL(`./${FRAME_CAPTURE_ASSET_NAME}`, baseUrl);
  assetUrl.searchParams.set("fvc-version", VERSION);
  frameCaptureModuleState.promise = Promise.resolve()
    .then(() => importModule(assetUrl.href))
    .catch((error) => {
      frameCaptureModuleState.promise = null;
      throw error;
    });
  return frameCaptureModuleState.promise;
};
