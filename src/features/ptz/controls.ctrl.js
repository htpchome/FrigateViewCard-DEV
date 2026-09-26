import {
  hasCameraPtz,
  hasPtzPanTiltCapability,
  isPtzHomePreset,
  normalizePtzPresetNames,
} from "./index.js";
import {
  buildControlsSectionMarkup,
  syncControlsPadLabels,
} from "./controls.tmpl.js";
import { VERSION } from "../../constants.js";

const CIRCLE_PAD_TAG = "circle-pad-control-2";
const CIRCLE_PAD_ASSET_NAME = "frigate-view-card-circle-pad.js";
let circlePadLoadPromise = null;

export const ensureCirclePadControl = ({
  customElementsRef = globalThis.customElements,
  importModule = (url) => import(url),
  baseUrl = import.meta.url,
} = {}) => {
  if (!customElementsRef) return Promise.resolve(false);
  if (customElementsRef.get(CIRCLE_PAD_TAG)) return Promise.resolve(true);
  if (circlePadLoadPromise) return circlePadLoadPromise;

  const assetUrl = new URL(`./${CIRCLE_PAD_ASSET_NAME}`, baseUrl);
  assetUrl.searchParams.set("fvc-version", VERSION);
  circlePadLoadPromise = Promise.resolve(importModule(assetUrl.href))
    .then(() => Boolean(customElementsRef.get(CIRCLE_PAD_TAG)))
    .catch((error) => {
      circlePadLoadPromise = null;
      throw error;
    });
  return circlePadLoadPromise;
};

export const syncPtzControlsLabels = (host) =>
  syncControlsPadLabels(host._$("#controls-pad"), host._localization.t);

export const renderPtzControls = (host, list) => {
  void ensureCirclePadControl()
    .then((loaded) => {
      if (loaded) syncPtzControlsLabels(host);
    })
    .catch((error) => {
      console.warn("[Frigate] PTZ control could not load", error);
    });
  void host._ptzCapabilityController.ensureActiveInfo();
  host._renderListLabel();
  const ptzInfo = host._ptzCapabilityController.activeInfo();
  const ptzConfigured = hasCameraPtz(host._activeCam);
  const presetItems = ptzConfigured
    ? normalizePtzPresetNames(ptzInfo).map((name) => ({
        name,
        isHome: isPtzHomePreset(name),
      }))
    : [];
  host._setListHtmlIfChanged(
    list,
    buildControlsSectionMarkup({
      panTiltEnabled: ptzConfigured && hasPtzPanTiltCapability(ptzInfo),
      zoomEnabled: ptzConfigured,
      presetItems,
      t: host._localization.t,
    }),
  );
  syncPtzControlsLabels(host);
};
