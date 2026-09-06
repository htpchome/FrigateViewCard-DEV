import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MediaOverlayControlsController as LiveOverlayControlsController,
} from "../src/shared/media/overlay-controls.ctrl.js";

function createTarget() {
  const listeners = new Map();

  return {
    addEventListener(type, listener, options = {}) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
      options.signal?.addEventListener(
        "abort",
        () => {
          this.removeEventListener(type, listener);
        },
        { once: true },
      );
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type, event = {}) {
      for (const listener of [...(listeners.get(type) || [])]) {
        listener(event);
      }
    },
  };
}

test("LiveOverlayControlsController shows on mouse hover and hides on leave", () => {
  const wrap = createTarget();
  const calls = [];
  const controller = new LiveOverlayControlsController({
    wrap,
    show: () => calls.push("show"),
    hideNow: () => calls.push("hideNow"),
    hideSoon: (ms) => calls.push(["hideSoon", ms]),
  });

  controller.bind();
  wrap.dispatch("pointerenter", { pointerType: "mouse" });
  wrap.dispatch("pointerleave", { pointerType: "mouse" });

  assert.deepEqual(calls, ["show", "hideNow"]);
});

test("LiveOverlayControlsController can auto-hide temporary mouse overlays", () => {
  const wrap = createTarget();
  const calls = [];
  const controller = new LiveOverlayControlsController({
    wrap,
    show: () => calls.push("show"),
    hideNow: () => calls.push("hideNow"),
    hideSoon: (ms) => calls.push(["hideSoon", ms]),
    autoHideMouse: true,
  });

  controller.bind();
  wrap.dispatch("pointerenter", { pointerType: "mouse" });
  wrap.dispatch("pointermove", { pointerType: "mouse", buttons: 1 });

  assert.deepEqual(calls, ["show", ["hideSoon", 1300]]);
});

test("LiveOverlayControlsController restarts a ten-second idle window on mouse movement", () => {
  const originalNow = Date.now;
  const wrap = createTarget();
  const calls = [];
  let now = 1000;
  Date.now = () => now;
  try {
    const controller = new LiveOverlayControlsController({
      wrap,
      show: () => calls.push("show"),
      hideNow: () => calls.push("hideNow"),
      hideSoon: (ms) => calls.push(["hideSoon", ms]),
      revealDurationMs: 10000,
      autoHideMouse: true,
    });

    controller.bind();
    wrap.dispatch("pointerenter", { pointerType: "mouse" });
    now += 150;
    wrap.dispatch("pointermove", { pointerType: "mouse", buttons: 0 });

    assert.deepEqual(calls, [
      "show",
      ["hideSoon", 10000],
      "show",
      ["hideSoon", 10000],
    ]);
  } finally {
    Date.now = originalNow;
  }
});

test("LiveOverlayControlsController reveals controls after a stationary touch tap", () => {
  const wrap = createTarget();
  const calls = [];
  const controller = new LiveOverlayControlsController({
    wrap,
    show: (interaction) => calls.push(["show", interaction.pointerType]),
    hideNow: () => calls.push("hideNow"),
    hideSoon: (ms, interaction) =>
      calls.push(["hideSoon", ms, interaction.pointerType]),
  });

  controller.bind();
  wrap.dispatch("pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    clientX: 100,
    clientY: 80,
  });
  wrap.dispatch("pointerup", {
    pointerId: 1,
    pointerType: "touch",
    clientX: 100,
    clientY: 80,
  });

  assert.deepEqual(calls, [
    ["show", "touch"],
    ["hideSoon", 1300, "touch"],
  ]);
});

test("LiveOverlayControlsController can keep touch controls visible longer than mouse controls", () => {
  const wrap = createTarget();
  const calls = [];
  const controller = new LiveOverlayControlsController({
    wrap,
    show: () => calls.push("show"),
    hideNow: () => calls.push("hideNow"),
    hideSoon: (ms) => calls.push(["hideSoon", ms]),
    revealDurationMs: 1300,
    touchRevealDurationMs: 2300,
    autoHideMouse: true,
  });

  controller.bind();
  wrap.dispatch("pointerenter", { pointerType: "mouse" });
  wrap.dispatch("pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    clientX: 100,
    clientY: 80,
  });
  wrap.dispatch("pointerup", {
    pointerId: 1,
    pointerType: "touch",
    clientX: 100,
    clientY: 80,
  });

  assert.deepEqual(calls, [
    "show",
    ["hideSoon", 1300],
    "show",
    ["hideSoon", 2300],
  ]);
});

test("LiveOverlayControlsController leaves zoom pans and pinches alone", () => {
  const wrap = createTarget();
  const calls = [];
  const controller = new LiveOverlayControlsController({
    wrap,
    show: () => calls.push("show"),
    hideNow: () => calls.push("hideNow"),
    hideSoon: (ms) => calls.push(["hideSoon", ms]),
  });

  controller.bind();
  wrap.dispatch("pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    clientX: 100,
    clientY: 80,
  });
  wrap.dispatch("pointermove", {
    pointerId: 1,
    pointerType: "touch",
    clientX: 120,
    clientY: 80,
  });
  wrap.dispatch("pointerup", {
    pointerId: 1,
    pointerType: "touch",
    clientX: 120,
    clientY: 80,
  });

  wrap.dispatch("pointerdown", {
    pointerId: 2,
    pointerType: "touch",
    clientX: 80,
    clientY: 80,
  });
  wrap.dispatch("pointerdown", {
    pointerId: 3,
    pointerType: "touch",
    clientX: 140,
    clientY: 80,
  });
  wrap.dispatch("pointerup", {
    pointerId: 2,
    pointerType: "touch",
    clientX: 80,
    clientY: 80,
  });
  wrap.dispatch("pointerup", {
    pointerId: 3,
    pointerType: "touch",
    clientX: 140,
    clientY: 80,
  });

  assert.deepEqual(calls, []);
});

test("LiveOverlayControlsController ignores touch controls inside the media", () => {
  const wrap = createTarget();
  const calls = [];
  const controller = new LiveOverlayControlsController({
    wrap,
    show: () => calls.push("show"),
    hideNow: () => calls.push("hideNow"),
    hideSoon: (ms) => calls.push(["hideSoon", ms]),
  });
  const ignoredTarget = {
    closest: (selector) =>
      selector === "[data-media-overlay-ignore]" ? {} : null,
  };

  controller.bind();
  wrap.dispatch("pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    clientX: 100,
    clientY: 80,
    target: ignoredTarget,
  });
  wrap.dispatch("pointerup", {
    pointerId: 1,
    pointerType: "touch",
    clientX: 100,
    clientY: 80,
    target: ignoredTarget,
  });

  assert.deepEqual(calls, []);
});

test("LiveOverlayControlsController removes listeners and hides on dispose", () => {
  const wrap = createTarget();
  const calls = [];
  const controller = new LiveOverlayControlsController({
    wrap,
    show: () => calls.push("show"),
    hideNow: () => calls.push("hideNow"),
    hideSoon: (ms) => calls.push(["hideSoon", ms]),
  });

  controller.bind();
  controller.dispose();
  wrap.dispatch("pointerenter", { pointerType: "mouse" });

  assert.deepEqual(calls, ["hideNow"]);
});
