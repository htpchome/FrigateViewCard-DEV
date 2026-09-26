import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LazyHomeAssistantNavbarController,
  cardNeedsNavbarModule,
  dashboardConfigNeedsPreMountNavbar,
  installLazyHomeAssistantDashboardNavbarCustomization,
} from "../src/integrations/home-assistant/navbar.loader.js";

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

test("navbar loader stays dormant when no navbar presentation needs it", async () => {
  let loads = 0;
  const host = {
    _config: { mobile_view_ha_navbar_bottom: false },
    _isLikelyMobileClient: () => true,
    _isRotateOverlayViewportCoverActive: () => false,
  };
  const controller = new LazyHomeAssistantNavbarController(
    host,
    { findCurrentHuiRoot: () => null },
    {
      loadModule: async () => {
        loads += 1;
        return {};
      },
    },
  );

  controller.sync();
  await flushPromises();

  assert.equal(loads, 0);
  assert.equal(controller.isNavbarAtBottom(), false);
  assert.equal(controller.bottomNavbarExtraHeightPx(), 0);
  assert.equal(controller.homeAssistantViewContentHeightPx(), null);
});

test("navbar loader creates one delegate and refreshes dependent layout", async () => {
  const calls = [];
  class Controller {
    constructor(host, options) {
      calls.push(["create", host, options]);
    }

    sync() {
      calls.push(["sync"]);
      return true;
    }

    disconnect(options) {
      calls.push(["disconnect", options]);
    }

    isNavbarAtBottom() {
      return true;
    }

    bottomNavbarExtraHeightPx() {
      return 10;
    }

    homeAssistantViewContentHeightPx() {
      return 620;
    }
  }
  const host = {
    _config: { mobile_view_ha_navbar_bottom: true },
    _isLikelyMobileClient: () => true,
    _applyCardStyle: () => calls.push(["layout"]),
    _previewPageController: {
      syncBottomNavbarPreviewChrome: () => calls.push(["preview"]),
    },
    _scheduleRotateOverlayUpdate: () => calls.push(["rotate"]),
  };
  const options = { cardTag: "frigate-view-card", isIOS: true };
  const controller = new LazyHomeAssistantNavbarController(host, options, {
    loadModule: async () => ({
      HomeAssistantNavbarController: Controller,
      installHomeAssistantDashboardNavbarCustomization: (installOptions) =>
        calls.push(["install", installOptions]),
    }),
  });

  controller.sync();
  controller.sync();
  await flushPromises();
  controller.sync();
  controller.disconnect({ force: true });

  assert.equal(calls.filter(([type]) => type === "create").length, 1);
  assert.equal(calls.filter(([type]) => type === "install").length, 1);
  assert.equal(calls.filter(([type]) => type === "sync").length, 2);
  assert.equal(calls.some(([type]) => type === "layout"), true);
  assert.equal(calls.some(([type]) => type === "preview"), true);
  assert.equal(calls.some(([type]) => type === "rotate"), true);
  assert.equal(controller.isNavbarAtBottom(), true);
  assert.equal(controller.bottomNavbarExtraHeightPx(), 10);
  assert.equal(controller.homeAssistantViewContentHeightPx(), 620);
  assert.deepEqual(calls.at(-1), ["disconnect", { force: true }]);
});

test("navbar activation recognizes local, rotation, and dashboard-wide needs", () => {
  const dashboardConfig = {
    views: [
      {
        cards: [
          {
            type: "custom:frigate-view-card",
            mobile_view_ha_navbar_bottom: true,
            mobile_view_ha_navbar_dashboard: true,
          },
        ],
      },
    ],
  };
  assert.equal(dashboardConfigNeedsPreMountNavbar(dashboardConfig), true);
  assert.equal(
    dashboardConfigNeedsPreMountNavbar({
      views: [{ cards: [{ type: "custom:frigate-view-card" }] }],
    }),
    false,
  );
  assert.equal(
    cardNeedsNavbarModule({
      _config: { mobile_view_ha_navbar_bottom: true },
      _isLikelyMobileClient: () => true,
    }),
    true,
  );
  assert.equal(
    cardNeedsNavbarModule({
      _config: {},
      _isLikelyMobileClient: () => true,
      _isRotateOverlayViewportCoverActive: () => true,
    }),
    true,
  );
  assert.equal(
    cardNeedsNavbarModule({
      _config: { mobile_view_rotate_to_fullscreen: true },
      _isLikelyMobileClient: () => true,
      _isLikelyPhoneClient: () => true,
    }),
    true,
  );
  assert.equal(
    cardNeedsNavbarModule({
      _config: { mobile_view_rotate_to_fullscreen: true },
      _isLikelyMobileClient: () => true,
      _isLikelyPhoneClient: () => false,
    }),
    false,
  );
  assert.equal(
    cardNeedsNavbarModule({
      _config: { mobile_view_ha_navbar_bottom: true },
      _isLikelyMobileClient: () => false,
    }),
    false,
  );
});

test("pre-mount navbar bootstrap loads once for a dashboard owner", async () => {
  const listeners = new Map();
  const huiRoot = {};
  const panel = {
    lovelace: {
      config: {
        views: [
          {
            cards: [
              {
                type: "custom:frigate-view-card",
                mobile_view_ha_navbar_bottom: true,
                mobile_view_ha_navbar_dashboard: true,
              },
            ],
          },
        ],
      },
    },
  };
  const calls = [];
  const windowRef = {
    customElements: { whenDefined: () => new Promise(() => {}) },
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
  };

  const bootstrap = installLazyHomeAssistantDashboardNavbarCustomization({
    documentRef: {},
    windowRef,
    isMobile: true,
    findCurrentHuiRoot: () => huiRoot,
    findPanel: () => panel,
    loadModule: async () => ({
      installHomeAssistantDashboardNavbarCustomization: (options) => {
        calls.push(options);
        return { disconnect: () => calls.push("disconnect") };
      },
    }),
  });
  await flushPromises();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].cardTag, "frigate-view-card");
  assert.equal(listeners.size, 0);
  bootstrap.disconnect();
  assert.equal(calls.at(-1), "disconnect");
});

test("pre-mount navbar bootstrap does not install on desktop", () => {
  assert.equal(
    installLazyHomeAssistantDashboardNavbarCustomization({
      documentRef: {},
      windowRef: {},
      isMobile: false,
    }),
    null,
  );
});
