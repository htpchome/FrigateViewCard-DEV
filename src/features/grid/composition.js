import {
  DAY,
  SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC,
} from "../../constants.js";
import { camDisplayName, cap } from "../../helpers.js";
import { ICONS } from "../../icons.js";
import { CameraCellMediaController } from "../live/camera-cell-media.ctrl.js";
import {
  LazyGridAlertController,
  LazyGridFeatureController,
  LazyGridMediaController,
  LazyGridPageController,
} from "./runtime.loader.js";

const DEFAULT_FACTORIES = Object.freeze({
  createCameraCellMediaController: (card) =>
    new CameraCellMediaController(card),
  createFeatureController: (card, options) =>
    new LazyGridFeatureController(card, options),
  createAlertController: (featureController) =>
    new LazyGridAlertController(featureController),
  createPageController: (card, featureController) =>
    new LazyGridPageController(card, featureController),
  createMediaController: (
    card,
    featureController,
    cameraCellMediaController,
  ) =>
    new LazyGridMediaController(
      card,
      featureController,
      cameraCellMediaController,
    ),
});

export const createGridControllers = (
  card,
  { factories = DEFAULT_FACTORIES } = {},
) => {
  const resolvedFactories = { ...DEFAULT_FACTORIES, ...factories };
  const cameraCellMediaController =
    resolvedFactories.createCameraCellMediaController(card);
  const gridFeatureController = resolvedFactories.createFeatureController(card, {
    alertConstants: {
      DAY,
      SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC,
    },
    cameraCellMediaController,
    buildLabelText: (camera) => cap(camDisplayName(camera)),
    liveIconSvg: ICONS.live,
  });
  const gridAlertController =
    resolvedFactories.createAlertController(gridFeatureController);
  const gridPageController =
    resolvedFactories.createPageController(card, gridFeatureController);
  const gridMediaController = resolvedFactories.createMediaController(
    card,
    gridFeatureController,
    cameraCellMediaController,
  );

  return {
    _cameraCellMediaController: cameraCellMediaController,
    _gridFeatureController: gridFeatureController,
    _gridAlertController: gridAlertController,
    _gridPageController: gridPageController,
    _gridMediaController: gridMediaController,
  };
};
