import { test } from "node:test";
import assert from "node:assert/strict";

import { createGridControllers } from "../src/features/grid/composition.js";

test("Grid composition keeps camera cells eager and Grid runtime lazy", () => {
  const calls = [];
  const options = {};
  const controllers = {
    cameraCell: { type: "camera-cell" },
    feature: { type: "feature" },
    alert: { type: "alert" },
    page: { type: "page" },
    media: { type: "media" },
  };
  const card = {};
  const factories = {
    createCameraCellMediaController: (host) => {
      calls.push(["camera-cell", host]);
      return controllers.cameraCell;
    },
    createFeatureController: (host, value) => {
      calls.push(["feature", host]);
      options.feature = value;
      return controllers.feature;
    },
    createAlertController: (feature) => {
      calls.push(["alert", feature]);
      return controllers.alert;
    },
    createPageController: (host, feature) => {
      calls.push(["page", host, feature]);
      return controllers.page;
    },
    createMediaController: (host, feature, cameraCell) => {
      calls.push(["media", host, feature, cameraCell]);
      return controllers.media;
    },
  };

  const result = createGridControllers(card, { factories });

  assert.deepEqual(result, {
    _cameraCellMediaController: controllers.cameraCell,
    _gridFeatureController: controllers.feature,
    _gridAlertController: controllers.alert,
    _gridPageController: controllers.page,
    _gridMediaController: controllers.media,
  });
  assert.deepEqual(calls, [
    ["camera-cell", card],
    ["feature", card],
    ["alert", controllers.feature],
    ["page", card, controllers.feature],
    ["media", card, controllers.feature, controllers.cameraCell],
  ]);
  assert.equal(options.feature.alertConstants.DAY, 86400);
  assert.equal(
    Number.isFinite(
      options.feature.alertConstants.SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC,
    ),
    true,
  );
  assert.equal(
    options.feature.buildLabelText({ name: "front door" }),
    "Front door",
  );
  assert.match(options.feature.liveIconSvg, /<svg/);
  assert.equal(
    options.feature.cameraCellMediaController,
    controllers.cameraCell,
  );
});
