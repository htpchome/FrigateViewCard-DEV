import assert from "node:assert/strict";
import { test } from "node:test";

import { VERSION } from "../src/constants.js";
import {
  createLazyPreviewControllers,
  ensurePreviewPageModule,
} from "../src/features/preview/page.loader.js";

const constants = {
  alert: { PREVIEW_ALERT_HOLD_MS: 10_000 },
  page: {
    DEVICE_PROFILE: { isMobile: false },
    PAGE_IDS: { preview: "preview" },
  },
};

test("Preview Page loader resolves the versioned companion asset", async () => {
  let requestedUrl = "";
  const module = await ensurePreviewPageModule({
    baseUrl: "https://example.test/local/frigate-view-card.js",
    importModule: async (url) => {
      requestedUrl = url;
      return { loaded: true };
    },
  });

  assert.equal(module.loaded, true);
  const assetUrl = new URL(requestedUrl);
  assert.equal(assetUrl.pathname, "/local/frigate-view-card-preview.js");
  assert.equal(assetUrl.searchParams.get("fvc-version"), VERSION);
});

test("disabled Preview Page never loads its feature asset", async () => {
  let loads = 0;
  const host = {
    _config: { preview_page_enabled: false },
    _pageId: "preview",
  };
  const controllers = createLazyPreviewControllers(host, constants, {
    loadModule: async () => {
      loads += 1;
      return {};
    },
  });

  assert.equal(controllers.page.buildMainLayoutShellMarkup(), "");
  controllers.page.activatePreviewPageRoute({ startup: true });
  controllers.alert.handleRealtimeMessage({ type: "new" });
  assert.equal(await controllers.page.prepare(), null);
  await Promise.resolve();
  assert.equal(loads, 0);
});

test("enabled inactive Preview Page remains dormant", async () => {
  let loads = 0;
  const host = {
    _config: { preview_page_enabled: true },
    _pageId: "single-view",
  };
  const controllers = createLazyPreviewControllers(host, constants, {
    loadModule: async () => {
      loads += 1;
      return {};
    },
  });

  controllers.page.renderPreviewPage();
  controllers.page.updatePreviewMeta();
  controllers.alert.markAlertCamera("camera.front");
  controllers.alert.handleRealtimeMessage({ type: "new" });
  await Promise.resolve();

  assert.equal(loads, 0);
  assert.equal(controllers.alert.isCameraAlertLive("camera.front"), false);
});

test("mobile preload installs enabled Preview code/styles without activating media or timers", async () => {
  for (const enabled of [false, true]) {
    for (const mobile of [false, true]) {
      const calls = [];
      const host = { _config: { preview_page_enabled: enabled }, _pageId: "mobile-view",
        _isLikelyMobileClient: () => mobile };
      const controllers = createLazyPreviewControllers(host, constants, {
        loadModule: async () => {
          calls.push("load");
          return {
            buildPreviewPageMainLayoutShellMarkup: () => "<main></main>",
            installPreviewPageStyles: () => calls.push("styles"),
            createPreviewControllers: () => ({
              page: { startPreviewMode: () => calls.push("start"),
                activatePreviewPageRoute: () => calls.push("activate") },
              alert: { start: () => calls.push("alerts") },
            }),
          };
        },
      });
      await controllers.page.preloadForMobile();
      await controllers.page.preloadForMobile();
      assert.deepEqual(calls, enabled && mobile ? ["load", "styles"] : []);
      assert.equal(host._pageId, "mobile-view");
    }
  }
});

test("Preview landing preparation loads once and hydrates its shell", async () => {
  const calls = [];
  class PageController {}
  class AlertController {}
  const host = {
    _config: { preview_page_enabled: true },
    _pageId: "preview",
    _renderShellPreserveLive: () => calls.push(["shell"]),
  };
  let loads = 0;
  const controllers = createLazyPreviewControllers(host, constants, {
    loadModule: async () => {
      loads += 1;
      return {
        buildPreviewPageMainLayoutShellMarkup: ({ marker }) =>
          `<main>${marker}</main>`,
        createPreviewControllers: (createdHost, createdConstants) => {
          calls.push(["create", createdHost, createdConstants]);
          return {
            page: new PageController(),
            alert: new AlertController(),
          };
        },
        installPreviewPageStyles: (createdHost) =>
          calls.push(["styles", createdHost]),
      };
    },
  });

  await controllers.page.prepare({ startup: true });
  await controllers.page.prepare({ startup: true });

  assert.equal(loads, 1);
  assert.equal(
    controllers.page.buildMainLayoutShellMarkup({ marker: "preview" }),
    "<main>preview</main>",
  );
  assert.deepEqual(calls, [
    ["styles", host],
    ["create", host, constants],
    ["shell"],
  ]);
});

test("Preview navigation replays activation after the lazy asset arrives", async () => {
  const calls = [];
  class PageController {
    activatePreviewPageRoute(context) {
      calls.push(["activate", context]);
    }
  }
  class AlertController {
    handleRealtimeMessage(message) {
      calls.push(["realtime", message]);
    }
  }
  const host = {
    _config: { preview_page_enabled: true },
    _pageId: "preview",
  };
  const controllers = createLazyPreviewControllers(host, constants, {
    loadModule: async () => ({
      buildPreviewPageMainLayoutShellMarkup: () => "<main></main>",
      createPreviewControllers: () => ({
        page: new PageController(),
        alert: new AlertController(),
      }),
    }),
  });

  controllers.page.activatePreviewPageRoute({
    previousPageId: "single-view",
  });
  await controllers.page.prepare();
  controllers.alert.handleRealtimeMessage({ type: "new" });

  assert.deepEqual(calls, [
    ["activate", { previousPageId: "single-view" }],
    ["realtime", { type: "new" }],
  ]);
});

test("Preview live-camera fallback stays synchronous before loading", () => {
  const desktop = createLazyPreviewControllers(
    {
      _config: {
        preview_page_enabled: true,
        preview_page_live_cameras: true,
      },
      _pageId: "single-view",
    },
    constants,
  );
  const mobile = createLazyPreviewControllers(
    {
      _config: {
        preview_page_enabled: true,
        preview_page_live_cameras_mobile: true,
      },
      _pageId: "single-view",
    },
    {
      ...constants,
      page: {
        ...constants.page,
        DEVICE_PROFILE: { isMobile: true },
      },
    },
  );

  assert.equal(desktop.page.previewLiveCamerasEnabled(), true);
  assert.equal(mobile.page.previewLiveCamerasEnabled(), true);
});
