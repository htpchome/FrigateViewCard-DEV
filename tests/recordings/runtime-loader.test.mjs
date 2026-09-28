import assert from "node:assert/strict";
import { test } from "node:test";

import { VERSION } from "../../src/constants.js";
import {
  ensureRecordingsRuntimeModule,
  LazyRecordingsBrowseNavController,
} from "../../src/features/recordings/runtime.loader.js";

test("Recordings runtime loader resolves the versioned companion asset", async () => {
  let requestedUrl = "";
  const module = await ensureRecordingsRuntimeModule({
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
    "/local/frigate-view-card-recordings.js",
  );
  assert.equal(assetUrl.searchParams.get("fvc-version"), VERSION);
});

test("non-recordings tabs keep the Recordings runtime dormant", async () => {
  let loads = 0;
  const controller = new LazyRecordingsBrowseNavController(
    { _tab: "reviews" },
    {
      loadModule: async () => {
        loads += 1;
        return {};
      },
    },
  );

  controller.prepareBrowseNav();
  assert.equal(controller.scheduleBrowseNavUpdate(), false);
  await Promise.resolve();

  assert.equal(loads, 0);
  assert.equal(controller._delegate, null);
});

test("Recordings navigation loads once, disables controls, and replays setup", async () => {
  const calls = [];
  const previous = { disabled: false };
  const next = { disabled: false };
  class Controller {
    constructor(host) {
      calls.push(["create", host]);
    }

    prepareBrowseNav() {
      calls.push(["prepare-nav"]);
    }

    scheduleBrowseNavUpdate() {
      calls.push(["schedule-nav"]);
      return true;
    }
  }
  const host = {
    _tab: "recordings",
    _pageShellRegionElement: (_region, selector) =>
      selector === "#rec-day-prev" ? previous : next,
  };
  let loads = 0;
  const controller = new LazyRecordingsBrowseNavController(host, {
    loadModule: async () => {
      loads += 1;
      return { RecordingsBrowseNavController: Controller };
    },
  });

  controller.prepareBrowseNav();
  assert.equal(controller.scheduleBrowseNavUpdate(), true);
  assert.equal(previous.disabled, true);
  assert.equal(next.disabled, true);
  await controller.prepare();

  assert.equal(loads, 1);
  assert.deepEqual(calls, [
    ["create", host],
    ["prepare-nav"],
    ["schedule-nav"],
  ]);
});

test("Recordings data and navigation calls preserve asynchronous results", async () => {
  const calls = [];
  class Controller {
    async fetchRecordingsInBounds(...args) {
      calls.push(["fetch", ...args]);
      return [{ id: "recording" }];
    }

    async navigateDayAnimated(direction) {
      calls.push(["navigate", direction]);
      return true;
    }
  }
  const controller = new LazyRecordingsBrowseNavController(
    { _tab: "recordings" },
    {
      loadModule: async () => ({
        RecordingsBrowseNavController: Controller,
      }),
    },
  );
  const bounds = { start: 1, end: 2 };

  assert.deepEqual(
    await controller.fetchRecordingsInBounds(bounds, "client", "front"),
    [{ id: "recording" }],
  );
  assert.equal(await controller.navigateDayAnimated(-1), true);
  assert.deepEqual(calls, [
    ["fetch", bounds, "client", "front"],
    ["navigate", -1],
  ]);
});
