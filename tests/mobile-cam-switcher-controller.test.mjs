import { test } from "node:test";
import assert from "node:assert/strict";

import { MobileCamSwitcherController } from "../src/features/mobile-view/cam-switcher.ctrl.js";

function createTarget(matchers = {}) {
  return {
    closest(selector) {
      return matchers[selector] || null;
    },
  };
}

test("mobile cam switcher controller toggles open on trigger click", () => {
  let open = false;
  let renderCalls = 0;
  const controller = new MobileCamSwitcherController({
    isOpen: () => open,
    setOpen: (next) => {
      open = next;
    },
    renderCamSwitcher: () => {
      renderCalls += 1;
    },
  });

  const handled = controller.handleClickTarget(
    createTarget({
      "[data-mobile-cam-trigger]": {},
    }),
  );

  assert.equal(handled, true);
  assert.equal(open, true);
  assert.equal(renderCalls, 1);
});

test("mobile cam switcher controller activates a stationary touch without double toggling on click", () => {
  let open = false;
  let renderCalls = 0;
  let prevented = 0;
  const trigger = {};
  const target = createTarget({
    "[data-mobile-cam-trigger]": trigger,
  });
  const controller = new MobileCamSwitcherController({
    isOpen: () => open,
    setOpen: (next) => {
      open = next;
    },
    renderCamSwitcher: () => {
      renderCalls += 1;
    },
  });

  assert.equal(
    controller.handlePointerDown(
      {
        pointerId: 4,
        pointerType: "touch",
        clientX: 40,
        clientY: 20,
      },
      target,
    ),
    true,
  );
  assert.equal(
    controller.handlePointerUp(
      {
        pointerId: 4,
        pointerType: "touch",
        clientX: 42,
        clientY: 21,
        preventDefault: () => {
          prevented += 1;
        },
      },
      target,
    ),
    true,
  );
  assert.equal(open, true);
  assert.equal(renderCalls, 1);
  assert.equal(prevented, 1);

  assert.equal(controller.handleClickTarget(target), true);
  assert.equal(open, true);
  assert.equal(renderCalls, 1);
});

test("mobile cam switcher controller does not activate a dragged touch", () => {
  let open = false;
  const trigger = {};
  const target = createTarget({
    "[data-mobile-cam-trigger]": trigger,
  });
  const controller = new MobileCamSwitcherController({
    isOpen: () => open,
    setOpen: (next) => {
      open = next;
    },
  });

  controller.handlePointerDown(
    {
      pointerId: 7,
      pointerType: "touch",
      clientX: 10,
      clientY: 10,
    },
    target,
  );
  assert.equal(
    controller.handlePointerUp(
      {
        pointerId: 7,
        pointerType: "touch",
        clientX: 10,
        clientY: 30,
      },
      target,
    ),
    false,
  );
  assert.equal(open, false);
});

test("mobile cam switcher controller switches camera on option click", async () => {
  let open = true;
  let paused = 0;
  let switchedIdx = null;
  const controller = new MobileCamSwitcherController({
    isOpen: () => open,
    setOpen: (next) => {
      open = next;
    },
    pauseSlideshowForInteraction: () => {
      paused += 1;
    },
    switchCamera: async (idx) => {
      switchedIdx = idx;
    },
  });

  const handled = controller.handleClickTarget(
    createTarget({
      "[data-mobile-camidx]": {
        dataset: { mobileCamidx: "2" },
      },
    }),
  );

  assert.equal(handled, true);
  await Promise.resolve();
  assert.equal(open, false);
  assert.equal(paused, 1);
  assert.equal(switchedIdx, 2);
});

test("mobile cam switcher controller closes when clicking outside", () => {
  let open = true;
  let renderCalls = 0;
  const controller = new MobileCamSwitcherController({
    isOpen: () => open,
    setOpen: (next) => {
      open = next;
    },
    renderCamSwitcher: () => {
      renderCalls += 1;
    },
  });

  controller.closeIfOutside(createTarget({}));

  assert.equal(open, false);
  assert.equal(renderCalls, 1);
});

test("mobile cam switcher controller close collapses open picker once", () => {
  let open = true;
  let renderCalls = 0;
  const controller = new MobileCamSwitcherController({
    isOpen: () => open,
    setOpen: (next) => {
      open = next;
    },
    renderCamSwitcher: () => {
      renderCalls += 1;
    },
  });

  controller.close();
  controller.close();

  assert.equal(open, false);
  assert.equal(renderCalls, 1);
});
