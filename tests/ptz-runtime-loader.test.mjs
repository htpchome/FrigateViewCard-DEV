import assert from "node:assert/strict";
import { test } from "node:test";

import { VERSION } from "../src/constants.js";
import {
  createLazyPtzControllers,
  ensurePtzRuntimeModule,
} from "../src/features/ptz/runtime.loader.js";

test("PTZ runtime loader resolves the versioned companion asset", async () => {
  let requestedUrl = "";
  const module = await ensurePtzRuntimeModule({
    baseUrl: "https://example.test/local/frigate-view-card.js",
    importModule: async (url) => {
      requestedUrl = url;
      return { loaded: true };
    },
  });

  assert.equal(module.loaded, true);
  const assetUrl = new URL(requestedUrl);
  assert.equal(assetUrl.pathname, "/local/frigate-view-card-ptz.js");
  assert.equal(assetUrl.searchParams.get("fvc-version"), VERSION);
});

test("cards without configured PTZ keep the runtime dormant", async () => {
  let loads = 0;
  const host = {
    _activeCam: { entity: "camera.front", ptz: false },
    _camCache: {},
  };
  const controllers = createLazyPtzControllers(host, {
    loadModule: async () => {
      loads += 1;
      return {};
    },
  });

  assert.equal(await controllers._ptzFeatureController.prepare(), null);
  assert.equal(controllers._ptzCapabilityController.activeInfo(), null);
  await controllers._ptzInteractionController.handleControlPointerDown({
    target: { closest: () => null },
  });
  await controllers._ptzInteractionController.stopMotion("release");
  await controllers._ptzInteractionController.dispose();

  assert.equal(loads, 0);
  assert.equal(controllers._ptzFeatureController.isLoaded(), false);
});

test("PTZ controls load once and replay their pending render", async () => {
  const calls = [];
  const list = { id: "controls-list" };
  const capability = {
    activeInfo: () => ({ features: ["pt"] }),
    ensureActiveInfo: async () => ({ features: ["pt"] }),
    resolveContext: async () => ({ camera: "front" }),
  };
  const host = {
    _activeCam: { entity: "camera.front", ptz: true },
    _camCache: {},
    _tab: "controls",
    _pageShellRegionElement: () => list,
    _setListHtmlIfChanged: (target, markup) =>
      calls.push(["clear", target, markup]),
  };
  let loads = 0;
  const controllers = createLazyPtzControllers(host, {
    loadModule: async () => {
      loads += 1;
      return {
        createPtzRuntimeControllers: () => ({
          action: { execute: async () => {} },
          capability,
          interaction: { dispose: async () => {} },
          motion: { dispose: async () => {} },
        }),
        renderPtzControls: (targetHost, targetList) =>
          calls.push(["render", targetHost, targetList]),
        syncPtzControlsLabels: (targetHost) =>
          calls.push(["sync", targetHost]),
      };
    },
  });

  controllers._ptzFeatureController.renderControls(list);
  controllers._ptzFeatureController.renderControls(list);
  await controllers._ptzFeatureController.prepare();
  await Promise.resolve();
  controllers._ptzFeatureController.syncControlsLabels();

  assert.equal(loads, 1);
  assert.equal(controllers._ptzFeatureController.isLoaded(), true);
  assert.deepEqual(calls, [
    ["clear", list, ""],
    ["render", host, list],
    ["sync", host],
  ]);
});

test("PTZ facade preserves capability, action, motion, and interaction results", async () => {
  const calls = [];
  const host = {
    _activeCam: { entity: "camera.front", ptz: true },
    _camCache: {
      "camera.front": { ptzInfo: { features: ["pt"] } },
    },
  };
  const controllers = createLazyPtzControllers(host, {
    loadModule: async () => ({
      createPtzRuntimeControllers: () => ({
        action: {
          execute: async (context) => {
            calls.push(["execute", context]);
            return "executed";
          },
        },
        capability: {
          activeInfo: () => ({ features: ["pt"], presets: ["Home"] }),
          ensureActiveInfo: async () => "ready",
          resolveContext: async () => ({ id: "context" }),
        },
        interaction: {
          handlePreset: async (name) => {
            calls.push(["preset", name]);
            return "preset-handled";
          },
          stopMotion: async (reason) => calls.push(["stop", reason]),
          dispose: async () => calls.push(["dispose-interaction"]),
        },
        motion: {
          start: async (action) => {
            calls.push(["start", action]);
            return "started";
          },
          dispose: async () => calls.push(["dispose-motion"]),
        },
      }),
      renderPtzControls() {},
      syncPtzControlsLabels() {},
    }),
  });

  assert.deepEqual(controllers._ptzCapabilityController.activeInfo(), {
    features: ["pt"],
  });
  assert.equal(
    await controllers._ptzCapabilityController.ensureActiveInfo(),
    "ready",
  );
  assert.deepEqual(controllers._ptzCapabilityController.activeInfo(), {
    features: ["pt"],
    presets: ["Home"],
  });
  assert.equal(
    await controllers._ptzExec.execute({ id: "action" }),
    "executed",
  );
  assert.equal(await controllers._ptzMotionController.start("left"), "started");
  assert.equal(
    await controllers._ptzInteractionController.handlePreset("Home"),
    "preset-handled",
  );
  await controllers._ptzInteractionController.stopMotion("release");
  await controllers._ptzInteractionController.dispose();

  assert.deepEqual(calls, [
    ["execute", { id: "action" }],
    ["start", "left"],
    ["preset", "Home"],
    ["stop", "release"],
    ["dispose-interaction"],
  ]);
});
