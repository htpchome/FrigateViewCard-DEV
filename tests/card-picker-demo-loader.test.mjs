import assert from "node:assert/strict";
import { test } from "node:test";

import { VERSION } from "../src/constants.js";
import {
  ensureCardPickerDemoModule,
  LazyCardPickerDemoController,
} from "../src/features/editor-preview/card-picker-demo.loader.js";

test("card-picker demo loader resolves the versioned companion asset", async () => {
  let requestedUrl = "";
  const module = await ensureCardPickerDemoModule({
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
    "/local/frigate-view-card-card-picker-demo.js",
  );
  assert.equal(assetUrl.searchParams.get("fvc-version"), VERSION);
});

test("normal dashboard rendering keeps the card-picker demo dormant", async () => {
  let loads = 0;
  const host = {
    classList: { toggle() {}, remove() {} },
    shadowRoot: { querySelector: () => null },
  };
  const controller = new LazyCardPickerDemoController(host, {
    loadModule: async () => {
      loads += 1;
      return {};
    },
  });

  assert.equal(controller.render(false), false);
  controller.dispose();
  await Promise.resolve();

  assert.equal(loads, 0);
});

test("card-picker rendering loads once and replays the active state", async () => {
  const calls = [];
  let loads = 0;
  class CardPickerDemoController {
    constructor(host) {
      calls.push(["construct", host]);
    }

    render(active) {
      calls.push(["render", active]);
      return active;
    }
  }
  const host = {
    classList: {
      toggle: (...args) => calls.push(["toggle", ...args]),
      remove: (...args) => calls.push(["remove", ...args]),
    },
    shadowRoot: { querySelector: () => null },
  };
  const controller = new LazyCardPickerDemoController(host, {
    loadModule: async () => {
      loads += 1;
      return { CardPickerDemoController };
    },
  });

  assert.equal(controller.render(true), true);
  await controller.prepare();
  assert.equal(controller.render(true), true);

  assert.equal(loads, 1);
  assert.deepEqual(calls, [
    ["toggle", "card-picker-demo-host", true],
    ["construct", host],
    ["render", true],
    ["toggle", "card-picker-demo-host", true],
    ["render", true],
  ]);
});

test("a card leaving the picker before load does not paint the demo", async () => {
  let finishLoad;
  const rendered = [];
  class CardPickerDemoController {
    render(active) {
      rendered.push(active);
    }
  }
  const host = {
    classList: { toggle() {}, remove() {} },
    shadowRoot: { querySelector: () => null },
  };
  const controller = new LazyCardPickerDemoController(host, {
    loadModule: () =>
      new Promise((resolve) => {
        finishLoad = () => resolve({ CardPickerDemoController });
      }),
  });

  controller.render(true);
  controller.render(false);
  await Promise.resolve();
  finishLoad();
  await controller.prepare();

  assert.deepEqual(rendered, [false]);
});
