import assert from "node:assert/strict";
import test from "node:test";

globalThis.window = globalThis.window || { customCards: [] };
globalThis.window.customCards = globalThis.window.customCards || [];
globalThis.document = globalThis.document || {
  createElement: () => ({
    style: {},
    setAttribute() {},
    removeAttribute() {},
    appendChild() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  }),
  head: { appendChild() {} },
};
globalThis.customElements = globalThis.customElements || {
  define() {},
  get() {
    return undefined;
  },
};
globalThis.HTMLElement =
  globalThis.HTMLElement ||
  class {
    attachShadow() {
      return {
        addEventListener() {},
        removeEventListener() {},
        querySelector() {
          return null;
        },
        querySelectorAll() {
          return [];
        },
      };
    }
  };
globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};

const { FrigateViewCard } = await import("../src/card/FrigateViewCard.js");

const createClassList = (...initial) => {
  const values = new Set(initial);
  return {
    add: (...tokens) => tokens.forEach((token) => values.add(token)),
    remove: (...tokens) => tokens.forEach((token) => values.delete(token)),
    contains: (token) => values.has(token),
  };
};

test("event tab clicks dispatch from the page-shell tabs region", () => {
  const calls = [];
  const tabsRegion = {};
  const tabButton = {
    dataset: { tab: "clips" },
    closest: (selector) =>
      selector === '[data-fvc-region="tabs"]' ? tabsRegion : null,
  };
  const target = {
    closest: (selector) => (selector === "[data-tab]" ? tabButton : null),
  };

  const handled =
    FrigateViewCard.prototype._handleBrowsePanelToolbarClick.call(
      { _setTab: (tab) => calls.push(tab) },
      target,
    );

  assert.equal(handled, true);
  assert.deepEqual(calls, ["clips"]);
});

test("data-tab outside the tabs region is not treated as a toolbar tab", () => {
  const tabButton = {
    dataset: { tab: "clips" },
    closest: () => null,
  };
  const target = {
    closest: (selector) => (selector === "[data-tab]" ? tabButton : null),
  };

  const handled =
    FrigateViewCard.prototype._handleBrowsePanelToolbarClick.call(
      { _setTab: () => assert.fail("unexpected tab change") },
      target,
    );

  assert.equal(handled, false);
});

test("Single View alert takeover toolbar button reaches its controller", () => {
  const calls = [];
  const button = { disabled: false };
  const target = {
    closest: (selector) =>
      selector === "#single-alert-takeover-btn" ? button : null,
  };

  const handled = FrigateViewCard.prototype._handleTopToolbarClick.call(
    {
      _singleViewPageController: {
        toggleAlertTakeover: () => calls.push("toggle"),
      },
    },
    target,
  );

  assert.equal(handled, true);
  assert.deepEqual(calls, ["toggle"]);
});

test("desktop Mobile View alert takeover reaches its page controller", () => {
  const calls = [];
  const button = { disabled: false };
  const target = {
    closest: (selector) =>
      selector === "#mobile-alert-takeover-btn" ? button : null,
  };

  const handled = FrigateViewCard.prototype._handleTopToolbarClick.call(
    {
      _mobileViewPageController: {
        toggleAlertTakeover: () => calls.push("toggle"),
      },
    },
    target,
  );

  assert.equal(handled, true);
  assert.deepEqual(calls, ["toggle"]);
});

test("mobile-device detection disables takeover before page defaults", () => {
  assert.equal(
    FrigateViewCard.prototype._isAlertCameraTakeoverAvailable.call({
      _isLikelyMobileClient: () => true,
    }),
    false,
  );
  const enabled =
    FrigateViewCard.prototype._alertCameraTakeoverEnabled.call({
      _isAlertCameraTakeoverAvailable: () => false,
      _isCardViewPageActive: () => true,
      _cardViewPageController: {
        alertTakeoverEnabled: () =>
          assert.fail("mobile must not consult configured page defaults"),
      },
    });

  assert.equal(enabled, false);
});

test("toast reuses the card notification and places favorite feedback over browse", () => {
  const properties = new Map();
  const toast = {
    classList: createClassList("toast"),
    dataset: {},
    hidden: true,
    style: {
      removeProperty: (name) => properties.delete(name),
      setProperty: (name, value) => properties.set(name, value),
    },
    textContent: "",
  };
  const card = {
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 600 }),
  };
  const browse = {
    getBoundingClientRect: () => ({ left: 400, top: 200, width: 280 }),
  };
  const context = {
    _$: (selector) => (selector === "#toast" ? toast : card),
    _pageShellRegion: (region) => (region === "browse" ? browse : null),
    _toastT: null,
  };

  FrigateViewCard.prototype._toast.call(context, "Added to Favorites", {
    duration: 10000,
    placement: "browse",
    tone: "success",
  });

  assert.equal(toast.textContent, "Added to Favorites");
  assert.equal(toast.hidden, false);
  assert.equal(toast.classList.contains("toast--success"), true);
  assert.equal(toast.classList.contains("toast--warning"), false);
  assert.equal(toast.classList.contains("toast--error"), false);
  assert.equal(toast.classList.contains("toast--browse"), true);
  assert.equal(toast.dataset.placement, "browse");
  assert.equal(properties.get("--fvc-toast-browse-left"), "440px");
  assert.equal(properties.get("--fvc-toast-browse-top"), "160px");
  assert.equal(properties.get("--fvc-toast-browse-max-width"), "260px");
  clearTimeout(context._toastT);
});

const createFavoriteContext = ({ callWS, retained = false }) => {
  const event = {
    id: "event-1",
    camera: "front",
    retain_indefinitely: retained,
  };
  const cameraContext = {
    clientId: "frigate",
    events: [event],
    kept: retained ? [event] : [],
  };
  const notifications = [];
  const context = {
    _activeCam: { entity: "camera.front" },
    _camCache: { "camera.front": cameraContext },
    _config: {
      cameras: [{ entity: "camera.front" }],
      favorites_mixed_cameras: false,
    },
    _events: [event],
    _kept: retained ? [event] : [],
    _findEventById: () => event,
    _frigateContextForCameraName: () => cameraContext,
    _cc: () => cameraContext,
    _hass: { callWS },
    _renderList() {},
    _toast: (...args) => notifications.push(args),
  };
  return { context, notifications };
};

test("favorite confirmation uses the browse success toast after Frigate accepts it", async () => {
  const requests = [];
  const { context, notifications } = createFavoriteContext({
    callWS: async (payload) => requests.push(payload),
  });

  await FrigateViewCard.prototype._toggleFav.call(context, "event-1");

  assert.deepEqual(requests, [
    {
      type: "frigate/event/retain",
      instance_id: "frigate",
      event_id: "event-1",
      retain: true,
    },
  ]);
  assert.deepEqual(notifications, [
    [
      "Added to Favorites",
      { tone: "success", placement: "browse" },
    ],
  ]);
});

test("favorite removal uses the browse warning toast after Frigate accepts it", async () => {
  const requests = [];
  const { context, notifications } = createFavoriteContext({
    retained: true,
    callWS: async (payload) => requests.push(payload),
  });

  await FrigateViewCard.prototype._toggleFav.call(context, "event-1");

  assert.equal(requests[0].retain, false);
  assert.deepEqual(notifications, [
    [
      "Removed from Favorites",
      { tone: "warning", placement: "browse" },
    ],
  ]);
});

test("favorite failure rolls back and uses the browse error toast", async () => {
  const { context, notifications } = createFavoriteContext({
    callWS: async () => {
      throw new Error("retain failed");
    },
  });
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    await FrigateViewCard.prototype._toggleFav.call(context, "event-1");
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(context._events[0].retain_indefinitely, false);
  assert.deepEqual(notifications, [
    [
      "Could not add to Favorites",
      { tone: "error", placement: "browse" },
    ],
  ]);
});
