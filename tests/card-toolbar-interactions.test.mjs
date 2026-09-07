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
