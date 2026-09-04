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

test("mobile cam switcher toggles its existing DOM without replacing the touched button", () => {
  let open = false;
  let renderCalls = 0;
  const classes = new Set();
  const attributes = new Map();
  const panel = { hidden: true };
  const pickerTrigger = {
    setAttribute: (name, value) => attributes.set(name, value),
  };
  const picker = {
    classList: {
      toggle: (name, enabled) => {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    querySelector: (selector) => {
      if (selector === "[data-mobile-cam-trigger]") return pickerTrigger;
      if (selector === "[data-mobile-cam-panel]") return panel;
      return null;
    },
  };
  const controller = new MobileCamSwitcherController({
    isOpen: () => open,
    setOpen: (next) => {
      open = next;
    },
    getPicker: () => picker,
    renderCamSwitcher: () => {
      renderCalls += 1;
    },
  });

  controller.handleClickTarget(
    createTarget({ "[data-mobile-cam-trigger]": pickerTrigger }),
  );

  assert.equal(open, true);
  assert.equal(classes.has("is-open"), true);
  assert.equal(attributes.get("aria-expanded"), "true");
  assert.equal(panel.hidden, false);
  assert.equal(renderCalls, 0);
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

test("mobile cam switcher consumes a synthesized click retargeted after its touch render", () => {
  let open = false;
  const trigger = {};
  const triggerTarget = createTarget({
    "[data-mobile-cam-trigger]": trigger,
  });
  const controller = new MobileCamSwitcherController({
    isOpen: () => open,
    setOpen: (next) => {
      open = next;
    },
    renderCamSwitcher: () => {},
  });

  controller.handlePointerDown(
    {
      pointerId: 8,
      pointerType: "touch",
      clientX: 40,
      clientY: 20,
    },
    triggerTarget,
  );
  controller.handlePointerUp(
    {
      pointerId: 8,
      pointerType: "touch",
      clientX: 40,
      clientY: 20,
      preventDefault() {},
    },
    triggerTarget,
  );

  const retargetedClick = createTarget({
    "[data-mobile-cam-switcher-content]": {},
  });
  assert.equal(controller.handleClickTarget(retargetedClick), true);
  assert.equal(open, true);
});

test("mobile cam switcher consumes a synthesized click retargeted to the Card View camera row", () => {
  let open = false;
  const trigger = {};
  const triggerTarget = createTarget({
    "[data-mobile-cam-trigger]": trigger,
  });
  const controller = new MobileCamSwitcherController({
    isOpen: () => open,
    setOpen: (next) => {
      open = next;
    },
    renderCamSwitcher: () => {},
  });

  controller.handlePointerDown(
    {
      pointerId: 9,
      pointerType: "touch",
      clientX: 40,
      clientY: 20,
    },
    triggerTarget,
  );
  controller.handlePointerUp(
    {
      pointerId: 9,
      pointerType: "touch",
      clientX: 40,
      clientY: 20,
      preventDefault() {},
    },
    triggerTarget,
  );

  const retargetedClick = createTarget({
    '[data-fvc-region="camera-switcher"]': {},
  });
  assert.equal(controller.handleClickTarget(retargetedClick), true);
  assert.equal(open, true);
});

test("mobile cam switcher ignores a compatibility click retargeted inside its replaced DOM", async () => {
  let open = false;
  let switchedIdx = null;
  const trigger = {};
  const triggerTarget = createTarget({
    "[data-mobile-cam-trigger]": trigger,
  });
  const controller = new MobileCamSwitcherController({
    isOpen: () => open,
    setOpen: (next) => {
      open = next;
    },
    renderCamSwitcher: () => {},
    switchCamera: async (idx) => {
      switchedIdx = idx;
    },
  });

  controller.handlePointerDown(
    {
      pointerId: 11,
      pointerType: "touch",
      clientX: 40,
      clientY: 20,
    },
    triggerTarget,
  );
  controller.handlePointerUp(
    {
      pointerId: 11,
      pointerType: "touch",
      clientX: 40,
      clientY: 20,
      preventDefault() {},
    },
    triggerTarget,
  );

  const revealedOption = {
    dataset: { mobileCamidx: "1" },
  };
  const retargetedClick = createTarget({
    "[data-mobile-camidx]": revealedOption,
    "[data-mobile-cam-picker]": {},
  });
  assert.equal(controller.handleClickTarget(retargetedClick), true);
  await Promise.resolve();
  assert.equal(open, true);
  assert.equal(switchedIdx, null);
});

test("mobile cam switcher ignores an option tap's compatibility click on the replacement trigger", async () => {
  let open = true;
  let switchedIdx = null;
  const option = { dataset: { mobileCamidx: "1" } };
  const optionTarget = createTarget({
    "[data-mobile-camidx]": option,
  });
  const controller = new MobileCamSwitcherController({
    isOpen: () => open,
    setOpen: (next) => {
      open = next;
    },
    renderCamSwitcher: () => {},
    switchCamera: async (idx) => {
      switchedIdx = idx;
    },
  });

  controller.handlePointerDown(
    {
      pointerId: 12,
      pointerType: "touch",
      clientX: 40,
      clientY: 60,
    },
    optionTarget,
  );
  controller.handlePointerUp(
    {
      pointerId: 12,
      pointerType: "touch",
      clientX: 40,
      clientY: 60,
      preventDefault() {},
    },
    optionTarget,
  );

  const replacementTrigger = {};
  const retargetedClick = createTarget({
    "[data-mobile-cam-trigger]": replacementTrigger,
    "[data-mobile-cam-picker]": {},
  });
  assert.equal(controller.handleClickTarget(retargetedClick), true);
  await Promise.resolve();
  assert.equal(open, false);
  assert.equal(switchedIdx, 1);
});

test("mobile cam switcher completes a stationary touch whose pointerup is retargeted", () => {
  let open = false;
  let prevented = 0;
  const trigger = {};
  const triggerTarget = createTarget({
    "[data-mobile-cam-trigger]": trigger,
  });
  const controller = new MobileCamSwitcherController({
    isOpen: () => open,
    setOpen: (next) => {
      open = next;
    },
    renderCamSwitcher: () => {},
  });

  controller.handlePointerDown(
    {
      pointerId: 10,
      pointerType: "touch",
      clientX: 40,
      clientY: 20,
    },
    triggerTarget,
  );
  assert.equal(
    controller.handlePointerUp(
      {
        pointerId: 10,
        pointerType: "touch",
        clientX: 41,
        clientY: 20,
        preventDefault: () => {
          prevented += 1;
        },
      },
      createTarget({}),
    ),
    true,
  );
  assert.equal(open, true);
  assert.equal(prevented, 1);
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
