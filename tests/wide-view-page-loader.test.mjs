import assert from "node:assert/strict";
import { test } from "node:test";

import { VERSION } from "../src/constants.js";
import {
  ensureWideViewPageModule,
  LazyWideViewPageController,
} from "../src/features/wide-view/page.loader.js";

const constants = {
  DEVICE_ROUTE_BUCKETS: { mobile: "mobile" },
  PAGE_IDS: { wideView: "wide-view" },
};

test("Wide View page loader resolves the versioned companion asset", async () => {
  let requestedUrl = "";
  const module = await ensureWideViewPageModule({
    baseUrl: "https://example.test/local/frigate-view-card.js",
    importModule: async (url) => {
      requestedUrl = url;
      return { loaded: true };
    },
  });

  assert.equal(module.loaded, true);
  const assetUrl = new URL(requestedUrl);
  assert.equal(assetUrl.pathname, "/local/frigate-view-card-wide-view.js");
  assert.equal(assetUrl.searchParams.get("fvc-version"), VERSION);
});

test("disabled Wide View never loads its page asset", async () => {
  let loads = 0;
  const host = {
    _config: { wide_view_page_enabled: false },
    _deviceRouteBucket: () => "desktop",
    _pageId: "wide-view",
  };
  const controller = new LazyWideViewPageController(host, constants, {
    loadModule: async () => {
      loads += 1;
      return {};
    },
  });

  assert.equal(controller.buildMainLayoutShellMarkup(), "");
  controller.activateWideViewPageRoute({ startup: true });
  controller.startWideViewMode();
  assert.equal(await controller.prepare(), null);
  await Promise.resolve();
  assert.equal(loads, 0);
});

test("phone clients never load the Wide View page asset", async () => {
  let loads = 0;
  const host = {
    _config: { wide_view_page_enabled: true },
    _deviceRouteBucket: () => "mobile",
    _pageId: "wide-view",
  };
  const controller = new LazyWideViewPageController(host, constants, {
    loadModule: async () => {
      loads += 1;
      return {};
    },
  });

  assert.equal(controller.isWideViewSupported(), false);
  assert.equal(controller.buildMainLayoutShellMarkup(), "");
  controller.activateWideViewPageRoute({ startup: true });
  controller.resumeCompanionMedia();
  assert.equal(await controller.prepare(), null);
  await Promise.resolve();
  assert.equal(loads, 0);
});

test("supported Wide View loads once and replays startup activation", async () => {
  const calls = [];
  class Controller {
    constructor(host, createdConstants, options) {
      calls.push(["create", host, createdConstants, options]);
    }

    activateWideViewPageRoute(context) {
      calls.push(["activate", context]);
    }

    applyPageConfigUpdate(options) {
      calls.push(["config", options]);
    }

    scheduleToolbarPanelPlacement() {
      calls.push(["position-toolbar-panel"]);
      return true;
    }
  }
  const host = {
    _config: { wide_view_page_enabled: true },
    _deviceRouteBucket: () => "desktop",
    _pageId: "wide-view",
    _renderShellPreserveLive: () => calls.push(["shell"]),
  };
  const companionController = { type: "companion" };
  const timelineController = {
    type: "timeline",
    prepare: async () => calls.push(["timeline-prepare"]),
  };
  let loads = 0;
  const controller = new LazyWideViewPageController(host, constants, {
    companionController,
    timelineController,
    loadModule: async () => {
      loads += 1;
      return {
        WideViewPageController: Controller,
        buildWideViewMainLayoutShellMarkup: ({ marker }) =>
          `<main>${marker}</main>`,
        installWideViewPageStyles: (createdHost) =>
          calls.push(["styles", createdHost]),
      };
    },
  });

  controller.activateWideViewPageRoute({ startup: true });
  controller.applyPageConfigUpdate({ startModeChanged: true });
  await controller.prepare();
  assert.equal(controller.scheduleToolbarPanelPlacement(), true);

  assert.equal(loads, 1);
  assert.equal(
    controller.buildMainLayoutShellMarkup({ marker: "wide" }),
    "<main>wide</main>",
  );
  assert.deepEqual(calls, [
    ["styles", host],
    [
      "create",
      host,
      constants,
      { companionController, timelineController },
    ],
    ["shell"],
    ["timeline-prepare"],
    ["activate", { startup: true }],
    ["config", { startModeChanged: true }],
    ["position-toolbar-panel"],
  ]);
});

test("Wide View page loader forwards resize reflow", () => {
  const host = {
    _config: { wide_view_page_enabled: true },
    _deviceRouteBucket: () => "desktop",
    _pageId: "wide-view",
  };
  const controller = new LazyWideViewPageController(host, constants);
  let calls = 0;
  controller._delegate = {
    reflowColumnsForResize: () => {
      calls += 1;
      return true;
    },
  };

  assert.equal(controller.reflowColumnsForResize(), true);
  assert.equal(calls, 1);
});

test("Wide View landing startup waits for its timeline before live activation", async () => {
  let releaseTimeline;
  const calls = [];
  class Controller {
    activateWideViewPageRoute(context) {
      calls.push(["activate", context]);
    }
  }
  const host = {
    _config: { wide_view_page_enabled: true },
    _deviceRouteBucket: () => "desktop",
    _pageId: "wide-view",
    _renderShellPreserveLive: () => calls.push(["shell"]),
  };
  const timelineController = {
    prepare: () => {
      calls.push(["timeline-prepare"]);
      return new Promise((resolve) => {
        releaseTimeline = resolve;
      });
    },
  };
  const controller = new LazyWideViewPageController(host, constants, {
    timelineController,
    loadModule: async () => ({
      WideViewPageController: Controller,
      buildWideViewMainLayoutShellMarkup: () => "<main></main>",
    }),
  });

  controller.activateWideViewPageRoute({ startup: true });
  const prepared = controller.prepare();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, [["shell"], ["timeline-prepare"]]);

  releaseTimeline();
  await prepared;

  assert.deepEqual(calls, [
    ["shell"],
    ["timeline-prepare"],
    ["activate", { startup: true }],
  ]);
});

test("priority landing preparation loads Wide View dependencies before activation", async () => {
  let releaseTimeline;
  const calls = [];
  class Controller {
    activateWideViewPageRoute(context) {
      calls.push(["activate", context]);
    }
  }
  const host = {
    _config: { wide_view_page_enabled: true },
    _deviceRouteBucket: () => "desktop",
    _pageId: "wide-view",
    _renderShellPreserveLive: () => calls.push(["shell"]),
  };
  const timelineController = {
    prepare: () => {
      calls.push(["timeline-prepare"]);
      return new Promise((resolve) => {
        releaseTimeline = resolve;
      });
    },
  };
  const controller = new LazyWideViewPageController(host, constants, {
    timelineController,
    loadModule: async () => ({
      WideViewPageController: Controller,
      buildWideViewMainLayoutShellMarkup: () => "<main></main>",
    }),
  });

  const preparation = controller.prepare({ startup: true });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, [["shell"], ["timeline-prepare"]]);

  releaseTimeline();
  await preparation;
  assert.deepEqual(calls, [["shell"], ["timeline-prepare"]]);
});

test("a closed Wide View does not activate after a pending page load", async () => {
  let releaseModule;
  const calls = [];
  class Controller {
    activateWideViewPageRoute(context) {
      calls.push(["activate", context]);
    }
  }
  const host = {
    _config: { wide_view_page_enabled: true },
    _deviceRouteBucket: () => "desktop",
    _pageId: "wide-view",
    _renderShellPreserveLive: () => calls.push(["shell"]),
  };
  const controller = new LazyWideViewPageController(host, constants, {
    loadModule: () =>
      new Promise((resolve) => {
        releaseModule = resolve;
      }),
  });

  controller.activateWideViewPageRoute({ source: "test" });
  await Promise.resolve();
  host._pageId = "single-view";
  controller.stopWideViewMode();
  releaseModule({
    WideViewPageController: Controller,
    buildWideViewMainLayoutShellMarkup: () => "<main></main>",
  });
  await controller.prepare();

  assert.deepEqual(calls, []);
});
