import assert from "node:assert/strict";
import { test } from "node:test";

import { VERSION } from "../src/constants.js";
import {
  ensureWideViewCompanionModule,
  LazyWideViewCompanionController,
} from "../src/features/wide-view/companion.loader.js";

const constants = {
  ICONS: {},
  PAGE_IDS: { wideView: "wide-view" },
};

test("Wide View companion loader resolves the versioned companion asset", async () => {
  let requestedUrl = "";
  const module = await ensureWideViewCompanionModule({
    baseUrl: "https://example.test/local/frigate-view-card.js",
    importModule: async (url) => {
      requestedUrl = url;
      return { loaded: true };
    },
  });

  assert.equal(module.loaded, true);
  const assetUrl = new URL(requestedUrl);
  assert.equal(
    assetUrl.pathname,
    "/local/frigate-view-card-wide-companion.js",
  );
  assert.equal(assetUrl.searchParams.get("fvc-version"), VERSION);
});

test("Wide View companion remains dormant outside Wide View", () => {
  let loads = 0;
  const host = {
    _config: {
      wide_view_alert_takeover: true,
      wide_view_live_cameras: true,
    },
    _pageId: "single-view",
  };
  const controller = new LazyWideViewCompanionController(host, constants, {
    loadModule: async () => {
      loads += 1;
      return {};
    },
  });

  assert.equal(controller.isActive(), false);
  assert.equal(controller.liveCamerasEnabled(), true);
  assert.equal(controller.alertTakeoverEnabled(), true);
  assert.equal(controller.buildRegionMarkup(), "");
  controller.start();
  controller.render();
  controller.resumeVisible();
  controller.updateMeta();
  controller.updateLayout({ width: 100 });
  controller.handleHassUpdate();
  controller.handleRealtimeMessage({ type: "new" });
  assert.equal(
    controller.handleHaReviewStatus("camera.front", "alert"),
    false,
  );
  assert.equal(loads, 0);
});

test("lazy companion preserves takeover availability before loading", () => {
  let loads = 0;
  let toolbarSyncs = 0;
  const host = {
    _config: { wide_view_alert_takeover: true },
    _isAlertCameraTakeoverAvailable: () => false,
    _pageId: "wide-view",
    _syncToolbarButtons: () => {
      toolbarSyncs += 1;
    },
  };
  const controller = new LazyWideViewCompanionController(host, constants, {
    loadModule: async () => {
      loads += 1;
      return {};
    },
  });

  assert.equal(controller.alertTakeoverEnabled(), false);
  assert.equal(controller.toggleAlertTakeover(), false);
  assert.equal(toolbarSyncs, 1);
  assert.equal(loads, 0);
});

test("Wide View companion loads once and replays pending work", async () => {
  const calls = [];
  const host = {
    _config: {
      wide_view_alert_takeover: false,
      wide_view_live_cameras: false,
    },
    _handleAlertTakeoverStateChange: (enabled) =>
      calls.push(["host-takeover", enabled]),
    _pageId: "wide-view",
    _syncToolbarButtons: () => calls.push(["host-toolbar"]),
  };
  class Controller {
    constructor(createdHost, createdConstants) {
      calls.push(["create", createdHost, createdConstants]);
    }

    buildRegionMarkup() {
      return "<section>Companions</section>";
    }

    start() {
      calls.push(["start"]);
    }

    render() {
      calls.push(["render"]);
    }

    resumeVisible() {
      calls.push(["resume"]);
    }

    updateMeta() {
      calls.push(["meta"]);
    }

    updateLayout(options) {
      calls.push(["layout", options]);
    }

    handleRealtimeMessage(message) {
      calls.push(["realtime", message]);
    }

    handleHaReviewStatus(entity, severity) {
      calls.push(["ha-review", entity, severity]);
      return true;
    }

    handleHassUpdate() {
      calls.push(["hass"]);
    }

    applyConfigUpdate(options) {
      calls.push(["config", options]);
    }

    toggleAlertTakeover() {
      calls.push(["toggle"]);
      return true;
    }
  }
  let ready = 0;
  let loads = 0;
  const controller = new LazyWideViewCompanionController(host, constants, {
    loadModule: async () => {
      loads += 1;
      return { WideViewCompanionController: Controller };
    },
    onReady: () => {
      ready += 1;
      return false;
    },
  });

  assert.match(
    controller.buildRegionMarkup(),
    /wide-companion-panel/,
  );
  controller.start();
  controller.render();
  controller.resumeVisible();
  controller.updateMeta();
  controller.updateLayout({ width: 640 });
  controller.handleRealtimeMessage({ type: "new" });
  assert.equal(
    controller.handleHaReviewStatus("camera.front", "detection"),
    true,
  );
  controller.handleHassUpdate();
  controller.applyConfigUpdate({ takeoverDefaultChanged: false });
  assert.equal(controller.toggleAlertTakeover(), true);
  await controller._ensureDelegate();

  assert.equal(loads, 1);
  assert.equal(ready, 1);
  assert.equal(
    controller.buildRegionMarkup(),
    "<section>Companions</section>",
  );
  assert.deepEqual(calls, [
    ["host-takeover", true],
    ["host-toolbar"],
    ["create", host, constants],
    ["start"],
    ["config", { takeoverDefaultChanged: false }],
    ["toggle"],
    ["realtime", { type: "new" }],
    ["ha-review", "camera.front", "detection"],
    ["hass"],
    ["render"],
    ["meta"],
    ["layout", { width: 640 }],
    ["resume"],
  ]);
});

test("companion readiness does not replace the existing Wide View shell", async () => {
  const calls = [];
  class Controller {}
  const host = {
    _config: {},
    _pageId: "wide-view",
    _renderList: (options) => calls.push(["list", options]),
    _renderShellPreserveLive: () => calls.push(["shell"]),
  };
  const controller = new LazyWideViewCompanionController(host, constants, {
    loadModule: async () => ({ WideViewCompanionController: Controller }),
  });

  controller.buildRegionMarkup();
  await controller._ensureDelegate();

  assert.deepEqual(calls, []);
});

test("loaded companion stays inactive if its route closes", async () => {
  let releaseModule;
  let ready = 0;
  let starts = 0;
  class Controller {
    start() {
      starts += 1;
    }
  }
  const host = { _config: {}, _pageId: "wide-view" };
  const controller = new LazyWideViewCompanionController(host, constants, {
    loadModule: () =>
      new Promise((resolve) => {
        releaseModule = resolve;
      }),
    onReady: () => {
      ready += 1;
      return true;
    },
  });

  controller.start();
  await Promise.resolve();
  host._pageId = "single-view";
  controller.stop();
  releaseModule({ WideViewCompanionController: Controller });
  await controller._ensureDelegate();

  assert.equal(ready, 0);
  assert.equal(starts, 0);
});
