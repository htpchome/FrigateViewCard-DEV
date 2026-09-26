import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LazyHomeAssistantDashboardSwipeNavigationController,
  cardConfigEnablesDashboardSwipeNavigation,
  dashboardConfigNeedsPreMountSwipeNavigation,
  installLazyHomeAssistantDashboardSwipeNavigation,
} from "../src/integrations/home-assistant/dashboard-swipe-navigation.loader.js";

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

test("dashboard swipe loader stays dormant when no card owns navigation", async () => {
  let loads = 0;
  const host = {
    _config: {
      ha_dashboard_swipe_navigation_owner: false,
      ha_dashboard_swipe_navigation: "dashboard-wide",
    },
  };
  const controller =
    new LazyHomeAssistantDashboardSwipeNavigationController(
      host,
      {},
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
  assert.equal(controller.isCurrentDashboardScope(), false);
});

test("dashboard swipe loader creates and reuses the real controller on demand", async () => {
  const calls = [];
  class Controller {
    constructor(host, options) {
      calls.push(["create", host, options]);
    }

    sync() {
      calls.push(["sync"]);
    }

    disconnect(options) {
      calls.push(["disconnect", options]);
    }

    isCurrentDashboardScope() {
      return true;
    }
  }
  const host = {
    _config: {
      ha_dashboard_swipe_navigation_owner: true,
      ha_dashboard_swipe_navigation: "inside-card",
    },
  };
  const options = { cardTag: "frigate-view-card", hasTouch: true };
  const controller =
    new LazyHomeAssistantDashboardSwipeNavigationController(
      host,
      options,
      {
        loadModule: async () => ({
          HomeAssistantDashboardSwipeNavigationController: Controller,
          installHomeAssistantDashboardSwipeNavigation: (installOptions) =>
            calls.push(["install", installOptions]),
        }),
      },
    );

  controller.sync();
  controller.sync();
  await flushPromises();
  controller.sync();
  controller.disconnect({ force: true });

  assert.equal(calls.filter(([type]) => type === "create").length, 1);
  assert.equal(calls.filter(([type]) => type === "install").length, 1);
  assert.equal(calls.filter(([type]) => type === "sync").length, 2);
  assert.deepEqual(calls.at(-1), ["disconnect", { force: true }]);
  assert.equal(controller.isCurrentDashboardScope(), true);
});

test("pre-mount loader recognizes only dashboard-spanning owner modes", () => {
  const dashboard = (config) => ({
    views: [
      {
        cards: [
          { type: "entities" },
          { type: "custom:frigate-view-card", ...config },
        ],
      },
    ],
  });

  assert.equal(
    dashboardConfigNeedsPreMountSwipeNavigation(
      dashboard({
        ha_dashboard_swipe_navigation_owner: true,
        ha_dashboard_swipe_navigation: "dashboard-wide",
      }),
    ),
    true,
  );
  assert.equal(
    dashboardConfigNeedsPreMountSwipeNavigation(
      dashboard({
        ha_dashboard_swipe_navigation_owner: true,
        ha_dashboard_swipe_navigation: "inside-card",
      }),
    ),
    false,
  );
  assert.equal(
    dashboardConfigNeedsPreMountSwipeNavigation(
      dashboard({
        ha_dashboard_swipe_navigation_owner: true,
        ha_dashboard_swipe_navigation: "inside-card",
        ha_dashboard_swipe_include_other_cards: true,
      }),
    ),
    true,
  );
  assert.equal(
    dashboardConfigNeedsPreMountSwipeNavigation(
      dashboard({
        ha_dashboard_swipe_navigation_owner: true,
        ha_dashboard_swipe_navigation: "none",
      }),
    ),
    false,
  );
  assert.equal(
    dashboardConfigNeedsPreMountSwipeNavigation(
      dashboard({
        ha_dashboard_swipe_navigation_owner: true,
        ha_dashboard_swipe_navigation: "legacy-invalid-value",
      }),
    ),
    true,
  );
});

test("pre-mount bootstrap loads once when dashboard config requires it", async () => {
  const listeners = new Map();
  const panel = {
    lovelace: {
      config: {
        views: [
          {
            cards: [
              {
                type: "custom:frigate-view-card",
                ha_dashboard_swipe_navigation_owner: true,
                ha_dashboard_swipe_navigation: "landing-dashboard",
              },
            ],
          },
        ],
      },
    },
  };
  const huiRoot = {};
  const fullBootstrap = { disconnect: () => {} };
  const calls = [];
  const windowRef = {
    navigator: { maxTouchPoints: 1 },
    customElements: { whenDefined: () => new Promise(() => {}) },
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
  };

  const bootstrap = installLazyHomeAssistantDashboardSwipeNavigation({
    documentRef: {},
    windowRef,
    hasTouch: true,
    findCurrentHuiRoot: () => huiRoot,
    findPanel: () => panel,
    loadModule: async () => ({
      installHomeAssistantDashboardSwipeNavigation: (options) => {
        calls.push(options);
        return fullBootstrap;
      },
    }),
  });
  await flushPromises();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].cardTag, "frigate-view-card");
  assert.equal(listeners.size, 0);
  bootstrap.disconnect();
});

test("card-level swipe activation requires ownership and a non-none mode", () => {
  assert.equal(cardConfigEnablesDashboardSwipeNavigation(null), false);
  assert.equal(
    cardConfigEnablesDashboardSwipeNavigation({
      ha_dashboard_swipe_navigation_owner: true,
      ha_dashboard_swipe_navigation: "none",
    }),
    false,
  );
  assert.equal(
    cardConfigEnablesDashboardSwipeNavigation({
      ha_dashboard_swipe_navigation_owner: true,
      ha_dashboard_swipe_navigation: "dashboard-wide",
    }),
    true,
  );
  assert.equal(
    cardConfigEnablesDashboardSwipeNavigation(
      {
        ha_dashboard_swipe_navigation_owner: true,
        ha_dashboard_swipe_navigation: "dashboard-wide",
      },
      { hasTouch: false },
    ),
    false,
  );
  assert.equal(
    cardConfigEnablesDashboardSwipeNavigation(
      {
        ha_dashboard_swipe_navigation_owner: true,
        ha_dashboard_swipe_navigation: "dashboard-wide",
        ha_dashboard_swipe_mouse_enabled: true,
      },
      { hasTouch: false },
    ),
    true,
  );
});
