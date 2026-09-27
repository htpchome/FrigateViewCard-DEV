import {
  DAY,
  SLIDESHOW_ALERT_HOLD_MS,
  SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC,
  SLIDESHOW_REVIEW_WATCH_MAX_MS,
  SLIDESHOW_REVIEW_WATCH_MIN_MS,
} from "../../constants.js";
import {
  LazySlideshowAlertController,
  LazySlideshowFeatureController,
  LazySlideshowPageController,
} from "./runtime.loader.js";

const DEFAULT_FACTORIES = Object.freeze({
  createFeatureController: (card, options) =>
    new LazySlideshowFeatureController(card, options),
  createAlertController: (card, featureController) =>
    new LazySlideshowAlertController(card, featureController),
  createPageController: (card, featureController) =>
    new LazySlideshowPageController(card, featureController),
});

export const createSlideshowControllers = (
  card,
  { factories = DEFAULT_FACTORIES } = {},
) => {
  const resolvedFactories = { ...DEFAULT_FACTORIES, ...factories };
  const slideshowFeatureController =
    resolvedFactories.createFeatureController(card, {
      alertConstants: {
        DAY,
        SLIDESHOW_ALERT_HOLD_MS,
        SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC,
        SLIDESHOW_REVIEW_WATCH_MIN_MS,
        SLIDESHOW_REVIEW_WATCH_MAX_MS,
      },
    });
  const slideshowAlertController =
    resolvedFactories.createAlertController(card, slideshowFeatureController);
  const slideshowPageController =
    resolvedFactories.createPageController(card, slideshowFeatureController);

  return {
    _slideshowFeatureController: slideshowFeatureController,
    _slideshowAlertController: slideshowAlertController,
    _slideshowPageController: slideshowPageController,
  };
};
