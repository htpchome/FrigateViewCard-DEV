import assert from "node:assert/strict";
import test from "node:test";

import { ensureShadowStyle } from "../src/shared/shadow-styles.js";

test("shadow styles install once and update in place", () => {
  let installed = null;
  const style = {
    attributes: new Set(),
    textContent: "",
    setAttribute(name) {
      this.attributes.add(name);
    },
  };
  const root = {
    ownerDocument: {
      createElement: (tagName) => (tagName === "style" ? style : null),
    },
    querySelector: () => installed,
    append: (element) => {
      installed = element;
    },
  };
  const host = { shadowRoot: root };

  const first = ensureShadowStyle(host, {
    attribute: "data-feature-styles",
    cssText: ".feature{display:block}",
  });
  const second = ensureShadowStyle(host, {
    attribute: "data-feature-styles",
    cssText: ".feature{display:grid}",
  });

  assert.equal(first, style);
  assert.equal(second, style);
  assert.equal(style.attributes.has("data-feature-styles"), true);
  assert.equal(style.textContent, ".feature{display:grid}");
});

test("shadow style installation is inert without a usable shadow root", () => {
  assert.equal(ensureShadowStyle(null), null);
  assert.equal(
    ensureShadowStyle(
      { shadowRoot: {} },
      { attribute: "data-feature-styles", cssText: ".feature{}" },
    ),
    null,
  );
});
