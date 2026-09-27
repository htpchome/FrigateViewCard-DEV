import assert from "node:assert/strict";
import test from "node:test";

import { VERSION } from "../src/constants.js";
import { ensureCardViewPageStyles } from "../src/features/card-view/page-style.loader.js";
import { LazyCardViewPageController } from "../src/features/card-view/page.loader.js";

const constants = {
  PAGE_IDS: {
    cardView: "card-view",
    preview: "preview",
    singleView: "single-view",
  },
};

test("Card View styles load once and install for each card host", async () => {
  const importedUrls = [];
  const installedHosts = [];
  const hostA = { id: "a" };
  const hostB = { id: "b" };
  const options = {
    baseUrl: "https://example.test/local/frigate-view-card.js",
    importModule: async (url) => {
      importedUrls.push(url);
      return {
        installCardViewPageStyles: (host) => {
          installedHosts.push(host);
          return { host };
        },
      };
    },
  };

  const first = await ensureCardViewPageStyles(hostA, options);
  const second = await ensureCardViewPageStyles(hostB, options);

  assert.equal(importedUrls.length, 1);
  const assetUrl = new URL(importedUrls[0]);
  assert.equal(
    assetUrl.pathname,
    "/local/frigate-view-card-card-view.js",
  );
  assert.equal(assetUrl.searchParams.get("fvc-version"), VERSION);
  assert.deepEqual(installedHosts, [hostA, hostB]);
  assert.equal(first.host, hostA);
  assert.equal(second.host, hostB);
});

test("disabled Card View never loads its page asset", async () => {
  let loads = 0;
  const host = {
    _config: { card_view_page_enabled: false },
    _pageId: "card-view",
  };
  const controller = new LazyCardViewPageController(host, constants, {
    loadModule: async () => {
      loads += 1;
      return {};
    },
  });

  assert.equal(controller.buildMainLayoutShellMarkup(), "");
  controller.activateCardViewPageRoute({ startup: true });
  assert.equal(await controller.prepare(), null);
  await Promise.resolve();
  assert.equal(loads, 0);
});

test("Card View loads on a phone and replays route activation", async () => {
  const calls = [];
  class Controller {
    activateCardViewPageRoute(context) {
      calls.push(["activate", context]);
    }
  }
  const host = {
    _config: { card_view_page_enabled: true },
    _deviceRouteBucket: () => "mobile",
    _pageId: "card-view",
    _renderShellPreserveLive: () => calls.push(["shell"]),
  };
  let loads = 0;
  const controller = new LazyCardViewPageController(host, constants, {
    loadModule: async () => {
      loads += 1;
      return {
        createCardViewPageController: (createdHost, createdConstants) => {
          calls.push(["create", createdHost, createdConstants]);
          return new Controller();
        },
        buildCardViewMainLayoutShellMarkup: ({ marker }) =>
          `<main>${marker}</main>`,
        installCardViewPageStyles: (createdHost) =>
          calls.push(["styles", createdHost]),
      };
    },
  });

  controller.activateCardViewPageRoute({ startup: true });
  await controller.prepare();

  assert.equal(loads, 1);
  assert.equal(
    controller.buildMainLayoutShellMarkup({ marker: "card" }),
    "<main>card</main>",
  );
  assert.deepEqual(calls, [
    ["styles", host],
    ["create", host, constants],
    ["shell"],
    ["activate", { startup: true }],
  ]);
});

test("priority Card View preparation builds its shell without activating", async () => {
  const calls = [];
  const delegate = {
    syncCardViewPageMarkup: () => calls.push(["sync"]),
  };
  const host = {
    _config: { card_view_page_enabled: true },
    _deviceRouteBucket: () => "mobile",
    _pageId: "card-view",
    _renderShellPreserveLive: () => calls.push(["shell"]),
  };
  const controller = new LazyCardViewPageController(host, constants, {
    loadModule: async () => ({
      createCardViewPageController: () => delegate,
      buildCardViewMainLayoutShellMarkup: () => "<main></main>",
    }),
  });

  await controller.prepare({ startup: true });

  assert.deepEqual(calls, [["shell"], ["sync"]]);
  assert.equal(controller._delegate, delegate);
});

test("a loaded Card View still synchronizes cleanup after leaving its route", async () => {
  const calls = [];
  const delegate = {
    syncCardViewPageMarkup: () => calls.push("sync"),
  };
  const host = {
    _config: { card_view_page_enabled: true },
    _pageId: "card-view",
    _renderShellPreserveLive: () => {},
  };
  const controller = new LazyCardViewPageController(host, constants, {
    loadModule: async () => ({
      createCardViewPageController: () => delegate,
      buildCardViewMainLayoutShellMarkup: () => "<main></main>",
    }),
  });

  await controller.prepare();
  host._pageId = "single-view";
  controller.syncCardViewPageMarkup();

  assert.deepEqual(calls, ["sync", "sync"]);
});

test("a closed Card View does not activate after a pending page load", async () => {
  let releaseModule;
  const calls = [];
  class Controller {
    activateCardViewPageRoute(context) {
      calls.push(["activate", context]);
    }
  }
  const host = {
    _config: { card_view_page_enabled: true },
    _pageId: "card-view",
    _renderShellPreserveLive: () => calls.push(["shell"]),
  };
  const controller = new LazyCardViewPageController(host, constants, {
    loadModule: () =>
      new Promise((resolve) => {
        releaseModule = resolve;
      }),
  });

  controller.activateCardViewPageRoute({ source: "test" });
  await Promise.resolve();
  host._pageId = "single-view";
  controller.deactivate();
  releaseModule({
    createCardViewPageController: () => new Controller(),
    buildCardViewMainLayoutShellMarkup: () => "<main></main>",
  });
  await controller.prepare();

  assert.deepEqual(calls, []);
});
