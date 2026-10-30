import assert from "node:assert/strict";
import test from "node:test";

import { MuteStateManager } from "../src/features/live/mute-state-manager.js";

const createStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
};

test("mute state is remembered independently for each camera", () => {
  const manager = new MuteStateManager({ storage: createStorage() });

  assert.equal(manager.resolve("camera.one"), undefined);
  manager.remember("camera.one", true);
  manager.remember("camera.two", false);

  assert.equal(manager.resolve("camera.one"), true);
  assert.equal(manager.resolve("camera.two"), false);
  assert.equal(manager.resolve("camera.three"), undefined);
});

test("mute state survives manager replacement through session storage", () => {
  const storage = createStorage();
  const first = new MuteStateManager({ storage });
  first.remember("camera.front", true);

  const replacement = new MuteStateManager({ storage });
  assert.equal(replacement.resolve("camera.front"), true);

  replacement.remember("camera.front", false);
  assert.equal(first.resolve("camera.front"), false);
});

test("clearing one camera leaves other camera choices intact", () => {
  const manager = new MuteStateManager({ storage: createStorage() });
  manager.remember("camera.one", true);
  manager.remember("camera.two", false);

  assert.equal(manager.clear("camera.one"), true);
  assert.equal(manager.resolve("camera.one"), undefined);
  assert.equal(manager.resolve("camera.two"), false);
});
