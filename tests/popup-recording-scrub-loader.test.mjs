import assert from "node:assert/strict";
import { test } from "node:test";

import { VERSION } from "../src/constants.js";
import {
  LazyPopupRecordingScrubController,
  ensurePopupRecordingScrubModule,
} from "../src/features/popup/recording-scrub.loader.js";

test("recording scrub loader resolves the versioned companion asset", async () => {
  let requestedUrl = "";
  const module = await ensurePopupRecordingScrubModule({
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
    "/local/frigate-view-card-recording-scrub.js",
  );
  assert.equal(assetUrl.searchParams.get("fvc-version"), VERSION);
});

test("recording scrub loader stays dormant and returns safe defaults", () => {
  let loads = 0;
  const controller = new LazyPopupRecordingScrubController(
    {},
    {
      loadModule: async () => {
        loads += 1;
        return {};
      },
    },
  );

  assert.equal(controller.range(), null);
  assert.equal(controller.segmentRange(), null);
  assert.equal(controller.setSourceUrl("/recording.mp4"), false);
  assert.equal(controller.toggleSegmentManager(), false);
  assert.equal(controller.resetSegmentSelection(), null);
  assert.equal(controller.cancelSegmentSelection(), false);
  assert.equal(controller.handleClick({}, null), false);
  assert.equal(controller.closeSegmentPreview(), false);
  controller.teardown();
  assert.equal(loads, 0);
});

test("recording initialization loads once and preserves a pending source URL", async () => {
  const calls = [];
  let resolveModule;
  class Controller {
    constructor(options) {
      calls.push(["create", options]);
    }

    initialize(payload) {
      calls.push(["initialize", payload]);
      return { start: payload.start, end: payload.end };
    }

    range() {
      return { start: 10, end: 20 };
    }

    segmentRange() {
      return { start: 12, end: 18 };
    }

    setSourceUrl(url) {
      calls.push(["source", url]);
      return true;
    }

    handleClick(event, target) {
      calls.push(["click", event, target]);
      return true;
    }

    teardown() {
      calls.push(["teardown"]);
    }

    dispose() {
      calls.push(["dispose"]);
    }
  }
  const options = { query: () => null };
  const controller = new LazyPopupRecordingScrubController(options, {
    loadModule: () =>
      new Promise((resolve) => {
        resolveModule = resolve;
      }),
  });

  const initialization = controller.initialize({
    start: 10,
    end: 20,
    sourceUrl: "",
  });
  assert.equal(controller.setSourceUrl("/signed-recording.mp4"), false);
  resolveModule({ PopupRecordingScrubController: Controller });

  assert.deepEqual(await initialization, { start: 10, end: 20 });
  assert.deepEqual(calls.slice(0, 2), [
    ["create", options],
    [
      "initialize",
      {
        start: 10,
        end: 20,
        sourceUrl: "/signed-recording.mp4",
      },
    ],
  ]);
  assert.deepEqual(controller.range(), { start: 10, end: 20 });
  assert.deepEqual(controller.segmentRange(), { start: 12, end: 18 });
  assert.equal(controller.setSourceUrl("/next.mp4"), true);
  const event = {};
  const target = {};
  assert.equal(controller.handleClick(event, target), true);
  controller.teardown();
  controller.dispose();
  assert.deepEqual(calls.slice(2), [
    ["source", "/next.mp4"],
    ["click", event, target],
    ["teardown"],
    ["dispose"],
  ]);
});

test("recording teardown cancels initialization while the asset loads", async () => {
  let resolveModule;
  let initializations = 0;
  class Controller {
    initialize() {
      initializations += 1;
      return { start: 1, end: 2 };
    }
  }
  const controller = new LazyPopupRecordingScrubController(
    {},
    {
      loadModule: () =>
        new Promise((resolve) => {
          resolveModule = resolve;
        }),
    },
  );

  const initialization = controller.initialize({ start: 1, end: 2 });
  controller.teardown();
  resolveModule({ PopupRecordingScrubController: Controller });

  assert.equal(await initialization, null);
  assert.equal(initializations, 0);
});

test("recording scrub loader can initialize again after disposal", async () => {
  let creations = 0;
  let disposals = 0;
  class Controller {
    constructor() {
      creations += 1;
    }

    initialize(payload) {
      return { start: payload.start, end: payload.end };
    }

    dispose() {
      disposals += 1;
    }
  }
  const controller = new LazyPopupRecordingScrubController(
    {},
    {
      loadModule: async () => ({
        PopupRecordingScrubController: Controller,
      }),
    },
  );

  assert.deepEqual(await controller.initialize({ start: 1, end: 2 }), {
    start: 1,
    end: 2,
  });
  controller.dispose();
  assert.deepEqual(await controller.initialize({ start: 3, end: 4 }), {
    start: 3,
    end: 4,
  });
  assert.equal(creations, 2);
  assert.equal(disposals, 1);
});
