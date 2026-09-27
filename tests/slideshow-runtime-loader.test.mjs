import assert from "node:assert/strict";
import test from "node:test";

import { VERSION } from "../src/constants.js";
import {
  ensureSlideshowRuntimeModule,
  LazySlideshowAlertController,
  LazySlideshowFeatureController,
  LazySlideshowPageController,
} from "../src/features/slideshow/runtime.loader.js";

const createHost = ({ enabled = true } = {}) => ({
  _config: {
    cameras: [
      { entity: "camera.front" },
      { entity: "camera.back" },
    ],
    slideshow_rotation_enabled: enabled,
  },
  _pageId: "single-view",
  _viewMode: "single",
  _slideshowActive: false,
  _slideshowHandledReviewIds: new Set(),
});

test("Slideshow runtime loader resolves the versioned companion asset", async () => {
  let requestedUrl = "";
  const module = await ensureSlideshowRuntimeModule({
    baseUrl: "https://example.test/local/frigate-view-card.js",
    importModule: async (url) => {
      requestedUrl = url;
      return { loaded: true };
    },
  });

  assert.equal(module.loaded, true);
  const assetUrl = new URL(requestedUrl);
  assert.equal(assetUrl.pathname, "/local/frigate-view-card-slideshow.js");
  assert.equal(assetUrl.searchParams.get("fvc-version"), VERSION);
});

test("disabled Slideshow never loads its runtime", async () => {
  let loads = 0;
  const feature = new LazySlideshowFeatureController(
    createHost({ enabled: false }),
    {},
    {
      loadModule: async () => {
        loads += 1;
        return {};
      },
    },
  );

  assert.equal(feature.isSupported(), false);
  assert.equal(await feature.prepare(), null);
  assert.equal(loads, 0);
});

test("Slideshow runtime is prioritized only for landing views configured to start in Slideshow", () => {
  const host = createHost();
  host._config.single_view_start_mode = "slideshow";
  host._config.wide_view_start_mode = "slideshow";
  host._config.card_view_start_mode = "slideshow";
  host._config.card_view_view_mode = "video-only";
  const feature = new LazySlideshowFeatureController(host);
  const pageIds = {
    singleView: "single-view",
    wideView: "wide-view",
    cardView: "card-view",
  };

  assert.equal(
    feature.shouldPrepareForLandingPage("single-view", pageIds),
    true,
  );
  assert.equal(
    feature.shouldPrepareForLandingPage("wide-view", pageIds),
    true,
  );
  assert.equal(
    feature.shouldPrepareForLandingPage("card-view", pageIds),
    true,
  );
  host._config.card_view_view_mode = "bottom-panel-open";
  assert.equal(
    feature.shouldPrepareForLandingPage("card-view", pageIds),
    false,
  );
  assert.equal(
    feature.shouldPrepareForLandingPage("preview", pageIds),
    false,
  );
  host._config.slideshow_rotation_enabled = false;
  assert.equal(
    feature.shouldPrepareForLandingPage("single-view", pageIds),
    false,
  );
});

test("first Slideshow activation loads once and preserves alert takeover", async () => {
  const calls = [];
  const host = createHost();
  const controllers = {
    alert: {
      handleRealtimeMessage: (message) => calls.push(["realtime", message]),
      syncHaAlertState: (options) => {
        calls.push(["ha-alert", options]);
        return true;
      },
    },
    page: {
      toggle: () => calls.push(["toggle"]),
    },
  };
  let loads = 0;
  const feature = new LazySlideshowFeatureController(
    host,
    { marker: "options" },
    {
      loadModule: async () => {
        loads += 1;
        return {
          createSlideshowRuntimeControllers: (createdHost, options) => {
            calls.push(["create", createdHost, options]);
            return controllers;
          },
        };
      },
    },
  );
  const page = new LazySlideshowPageController(host, feature);
  const alert = new LazySlideshowAlertController(host, feature);

  page.toggle();
  page.toggle();
  await feature.prepare();
  await Promise.resolve();
  alert.handleRealtimeMessage({ type: "new" });
  assert.equal(alert.syncHaAlertState({ candidates: [] }), true);

  assert.equal(loads, 1);
  assert.deepEqual(calls, [
    ["create", host, { marker: "options" }],
    ["toggle"],
    ["realtime", { type: "new" }],
    ["ha-alert", { candidates: [] }],
  ]);
});

test("a stale page start cannot activate Slideshow after configuration changes", async () => {
  const host = createHost();
  host._config.single_view_start_mode = "slideshow";
  const starts = [];
  let resolveModule;
  const modulePromise = new Promise((resolve) => {
    resolveModule = resolve;
  });
  const feature = new LazySlideshowFeatureController(host, {}, {
    loadModule: () => modulePromise,
  });
  const page = new LazySlideshowPageController(host, feature);

  assert.equal(page.start("single-view-start"), true);
  const preparation = feature.prepare();
  host._config.single_view_start_mode = "live";
  resolveModule({
    createSlideshowRuntimeControllers: () => ({
      alert: {},
      page: { start: (source) => starts.push(source) },
    }),
  });
  await preparation;
  await Promise.resolve();

  assert.deepEqual(starts, []);
});

test("Slideshow review policy remains available without loading the runtime", () => {
  const host = createHost({ enabled: false });
  host._config.cameras[1].alerts_content = "all_reviews";
  let loads = 0;
  const feature = new LazySlideshowFeatureController(host, {}, {
    loadModule: async () => {
      loads += 1;
      return {};
    },
  });
  const alert = new LazySlideshowAlertController(host, feature);

  assert.equal(alert.shouldHandleReview("camera.front", "alert"), true);
  assert.equal(alert.shouldHandleReview("camera.front", "detection"), false);
  assert.equal(alert.shouldHandleReview("camera.back", "detection"), true);
  assert.equal(loads, 0);
});
