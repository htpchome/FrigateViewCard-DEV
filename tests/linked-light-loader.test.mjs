import assert from "node:assert/strict";
import test from "node:test";

import { VERSION } from "../src/constants.js";
import {
  ensureLinkedLightModule,
  LazyLinkedLightController,
} from "../src/features/linked-entities/light.loader.js";

test("linked-light loader resolves the versioned companion asset", async () => {
  let requestedUrl = "";
  const module = await ensureLinkedLightModule({
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
    "/local/frigate-view-card-linked-light.js",
  );
  assert.equal(assetUrl.searchParams.get("fvc-version"), VERSION);
});

test("card without linked lights keeps the companion dormant", () => {
  let loads = 0;
  const regions = [{ hidden: false }];
  const host = {
    _config: { cameras: [{ entity: "camera.front" }] },
    _activeCam: { entity: "camera.front" },
    shadowRoot: {
      querySelectorAll: () => regions,
    },
  };
  const controller = new LazyLinkedLightController(host, {
    loadModule: async () => {
      loads += 1;
      return {};
    },
  });

  assert.equal(controller.stateSignature(), "");
  assert.equal(controller.buildMarkup(), "");
  controller.sync();
  assert.equal(loads, 0);
  assert.equal(regions[0].hidden, true);
});

test("configured linked lights load once and synchronize existing regions", async () => {
  const calls = [];
  class Controller {
    constructor(host) {
      calls.push(["create", host]);
    }

    sync() {
      calls.push(["sync"]);
    }

    stateSignature() {
      return "light.porch:on";
    }

    buildMarkup(options) {
      calls.push(["markup", options]);
      return "<button>Porch</button>";
    }
  }
  const camera = {
    entity: "camera.front",
    linked_entities: [{ entity: "light.porch", position: "left" }],
  };
  const host = {
    _config: { cameras: [camera] },
    _activeCam: camera,
    shadowRoot: { querySelectorAll: () => [] },
  };
  let loads = 0;
  const controller = new LazyLinkedLightController(host, {
    loadModule: async () => {
      loads += 1;
      return { LinkedLightController: Controller };
    },
  });

  assert.deepEqual(controller.config(), camera.linked_entities[0]);
  assert.equal(controller.position(controller.config()), "left");
  assert.equal(controller.stateSignature(), "loading");
  controller.sync();
  await controller._ensureDelegate();

  assert.equal(loads, 1);
  assert.deepEqual(calls.slice(0, 2), [["create", host], ["sync"]]);
  assert.equal(controller.stateSignature(), "light.porch:on");
  assert.equal(
    controller.buildMarkup({ buttonClass: "icon-btn" }),
    "<button>Porch</button>",
  );
  assert.deepEqual(calls.at(-1), ["markup", { buttonClass: "icon-btn" }]);
});
