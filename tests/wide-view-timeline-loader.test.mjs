import assert from "node:assert/strict";
import { test } from "node:test";

import { VERSION } from "../src/constants.js";
import {
  ensureWideViewTimelineModule,
  LazyWideViewTimelineController,
} from "../src/features/wide-view/timeline.loader.js";

test("Wide View timeline loader resolves the versioned companion asset", async () => {
  let requestedUrl = "";
  const module = await ensureWideViewTimelineModule({
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
    "/local/frigate-view-card-wide-timeline.js",
  );
  assert.equal(assetUrl.searchParams.get("fvc-version"), VERSION);
});

test("disabled Wide View timeline remains dormant", () => {
  let loads = 0;
  const host = { _config: { wide_view_timeline_enabled: false } };
  const controller = new LazyWideViewTimelineController(
    host,
    {},
    {
      isActive: () => true,
      loadModule: async () => {
        loads += 1;
        return {};
      },
    },
  );

  assert.equal(controller.enabled(), false);
  assert.equal(controller.buildRegionMarkup(), "");
  controller.bind();
  controller.render({ force: true });
  controller.scheduleRender({ resetToNow: true });
  controller.applyConfigUpdate({ enabledChanged: true });
  assert.equal(controller.handleClick({}, null), false);
  assert.equal(loads, 0);
});

test("enabled Wide View timeline loads once and replays pending work", async () => {
  const calls = [];
  let ready = 0;
  class Controller {
    constructor(host, deps) {
      calls.push(["create", host, deps]);
    }

    buildRegionMarkup() {
      return "<aside>Timeline</aside>";
    }

    bind() {
      calls.push(["bind"]);
    }

    scheduleRender(options) {
      calls.push(["render", options]);
    }

    handleClick(event, target) {
      calls.push(["click", event, target]);
      return true;
    }

    teardown(options) {
      calls.push(["teardown", options]);
    }
  }
  const host = { _config: { wide_view_timeline_enabled: true } };
  const deps = { icons: { right: "right" } };
  const controller = new LazyWideViewTimelineController(host, deps, {
    isActive: () => true,
    onReady: () => {
      ready += 1;
      return false;
    },
    loadModule: async () => ({ WideViewTimelineController: Controller }),
  });

  assert.equal(controller.buildRegionMarkup(), "");
  controller.bind();
  controller.scheduleRender({ force: true });
  await controller._ensureDelegate();

  assert.equal(ready, 1);
  assert.deepEqual(calls.slice(0, 3), [
    ["create", host, deps],
    ["bind"],
    ["render", { force: true }],
  ]);
  assert.equal(controller.buildRegionMarkup(), "<aside>Timeline</aside>");
  const event = {};
  const target = {};
  assert.equal(controller.handleClick(event, target), true);
  controller.teardown({ preserveScroll: true });
  assert.deepEqual(calls.slice(3), [
    ["click", event, target],
    ["teardown", { preserveScroll: true }],
  ]);
});

test("loaded Wide View timeline stays inactive after its route closes", async () => {
  let ready = 0;
  let binds = 0;
  class Controller {
    bind() {
      binds += 1;
    }
  }
  const host = { _config: { wide_view_timeline_enabled: true } };
  const controller = new LazyWideViewTimelineController(host, {}, {
    isActive: () => false,
    onReady: () => {
      ready += 1;
      return true;
    },
    loadModule: async () => ({ WideViewTimelineController: Controller }),
  });

  controller.bind();
  await controller._ensureDelegate();

  assert.equal(ready, 0);
  assert.equal(binds, 0);
});

test("timeline readiness repaints browse state after replacing the Wide View shell", async () => {
  const calls = [];
  class Controller {}
  const host = {
    _config: { wide_view_timeline_enabled: true },
    _wideViewPageController: {
      isWideViewPageActive: () => true,
    },
    _renderShellPreserveLive: () => calls.push(["shell"]),
    _renderList: (options) => calls.push(["list", options]),
  };
  const controller = new LazyWideViewTimelineController(host, {}, {
    loadModule: async () => ({ WideViewTimelineController: Controller }),
  });

  controller.buildRegionMarkup();
  await controller._ensureDelegate();

  assert.deepEqual(calls, [
    ["shell"],
    ["list", { renderWideTimeline: false }],
  ]);
});
