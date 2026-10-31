import { test } from "node:test";
import assert from "node:assert/strict";

import { applyHaDirectPresentationSizing } from "../src/integrations/home-assistant/camera-provider.js";

const createStyle = () => {
  const values = new Map();
  return {
    values,
    setProperty: (property, value, priority) => {
      values.set(property, { value, priority });
    },
  };
};

test("HA Direct sizes its nested player and video to the projected bounds", () => {
  const video = { style: createStyle() };
  const player = {
    style: createStyle(),
    shadowRoot: { querySelector: (selector) => selector === "video" ? video : null },
  };
  const provider = {
    style: createStyle(),
    shadowRoot: {
      querySelectorAll: (selector) =>
        selector === "ha-hls-player,ha-web-rtc-player" ? [player] : [],
    },
  };

  applyHaDirectPresentationSizing(provider);

  assert.deepEqual(provider.style.values.get("position"), {
    value: "relative",
    priority: "important",
  });
  for (const element of [provider, player, video]) {
    assert.deepEqual(element.style.values.get("width"), {
      value: "100%",
      priority: "important",
    });
    assert.deepEqual(element.style.values.get("height"), {
      value: "100%",
      priority: "important",
    });
  }
  assert.equal(player.style.values.has("display"), false);
  assert.deepEqual(video.style.values.get("object-fit"), {
    value: "contain",
    priority: "important",
  });
});
