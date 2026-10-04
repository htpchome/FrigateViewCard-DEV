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

test("snapshot refresh scheduler honors the 2 and 5 second options", () => {
  const resolveInterval = (snapshotUpdateSeconds) =>
    FrigateViewCard.prototype._snapshotUpdateMs.call({
      _config: { snapshot_update_seconds: snapshotUpdateSeconds },
    });

  assert.equal(resolveInterval(2), 2000);
  assert.equal(resolveInterval(5), 5000);
  assert.equal(resolveInterval(10), 10000);
});

for (const seconds of [2, 5]) {
  test(`Wide live companions keep refreshing snapshots every ${seconds} seconds`, async (t) => {
    const scheduled = [];
    let refreshes = 0;
    let active = true;
    t.mock.method(globalThis, "setTimeout", (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    });
    t.mock.method(globalThis, "clearTimeout", () => {});
    const host = {
      _config: { snapshot_update_seconds: seconds },
      _viewMode: "single",
      _isPreviewPageActive: () => false,
      _wideViewPageController: {
        isWideViewPageActive: () => active,
        companionLiveCamerasEnabled: () => true,
      },
      _refreshSnapshotMedia: async () => { refreshes += 1; },
    };
    for (const method of ["_snapshotUpdateMs", "_clearSnapshotRefreshTimer", "_syncSnapshotRefreshTimer"]) {
      host[method] = FrigateViewCard.prototype[method].bind(host);
    }
    host._syncSnapshotRefreshTimer();
    assert.equal(scheduled[0].delay, seconds * 1000);
    scheduled[0].callback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(refreshes, 1);
    assert.equal(scheduled.length, 2);
    assert.equal(scheduled[1].delay, seconds * 1000);
    active = false;
    scheduled[1].callback();
    assert.equal(refreshes, 1);
    assert.equal(scheduled.length, 2);
  });
}
