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
