import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DAY,
  SLIDESHOW_ALERT_HOLD_MS,
  SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC,
  SLIDESHOW_REVIEW_WATCH_MAX_MS,
  SLIDESHOW_REVIEW_WATCH_MIN_MS,
} from "../src/constants.js";
import { createSlideshowControllers } from "../src/features/slideshow/composition.js";

test("Slideshow composition keeps its runtime controllers lazy", () => {
  const calls = [];
  const options = {};
  const featureController = { type: "feature" };
  const alertController = { type: "alert" };
  const pageController = { type: "page" };
  const card = {};
  const factories = {
    createFeatureController: (host, value) => {
      calls.push(["feature", host]);
      options.feature = value;
      return featureController;
    },
    createAlertController: (host, feature) => {
      calls.push(["alert", host, feature]);
      return alertController;
    },
    createPageController: (host, feature) => {
      calls.push(["page", host, feature]);
      return pageController;
    },
  };

  const result = createSlideshowControllers(card, { factories });

  assert.deepEqual(result, {
    _slideshowFeatureController: featureController,
    _slideshowAlertController: alertController,
    _slideshowPageController: pageController,
  });
  assert.deepEqual(calls, [
    ["feature", card],
    ["alert", card, featureController],
    ["page", card, featureController],
  ]);
  assert.deepEqual(options.feature.alertConstants, {
    DAY,
    SLIDESHOW_ALERT_HOLD_MS,
    SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC,
    SLIDESHOW_REVIEW_WATCH_MIN_MS,
    SLIDESHOW_REVIEW_WATCH_MAX_MS,
  });
});
