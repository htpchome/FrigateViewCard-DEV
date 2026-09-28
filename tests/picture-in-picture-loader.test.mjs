import assert from "node:assert/strict";
import { test } from "node:test";

import { VERSION } from "../src/constants.js";
import {
  ensurePictureInPictureModule,
  LazyPictureInPictureController,
} from "../src/shared/media/picture-in-picture.loader.js";

const createButton = () => ({
  hidden: false,
  disabled: false,
});

const createVideo = () => {
  const attributes = new Set();
  return {
    disablePictureInPicture: false,
    setAttribute: (name) => attributes.add(name),
    removeAttribute: (name) => attributes.delete(name),
    hasAttribute: (name) => attributes.has(name),
  };
};

test("PiP loader resolves the versioned companion asset", async () => {
  let requestedUrl = "";
  const module = await ensurePictureInPictureModule({
    baseUrl: "https://example.test/local/frigate-view-card.js",
    importModule: async (url) => {
      requestedUrl = url;
      return { loaded: true };
    },
  });

  assert.equal(module.loaded, true);
  const assetUrl = new URL(requestedUrl);
  assert.equal(
    assetUrl.pathname,
    "/local/frigate-view-card-picture-in-picture.js",
  );
  assert.equal(assetUrl.searchParams.get("fvc-version"), VERSION);
});

test("mobile and tablet PiP sync remains dormant and preserves Firefox suppression", async () => {
  const liveButton = createButton();
  const popupButton = createButton();
  const liveVideo = createVideo();
  const popupVideo = createVideo();
  let loads = 0;
  const controller = new LazyPictureInPictureController(
    {
      resolveButton: (scope) =>
        scope === "popup" ? popupButton : liveButton,
      resolveLiveVideo: () => liveVideo,
      resolvePopupVideo: () => popupVideo,
      isPopupOpen: () => true,
      isMobileTabletViewport: () => true,
      isFirefox: () => true,
    },
    {
      loadModule: async () => {
        loads += 1;
        return {};
      },
    },
  );

  controller.sync();
  await Promise.resolve();

  assert.equal(loads, 0);
  assert.equal(liveButton.hidden, true);
  assert.equal(liveButton.disabled, true);
  assert.equal(popupButton.hidden, true);
  assert.equal(popupButton.disabled, true);
  assert.equal(liveVideo.disablePictureInPicture, true);
  assert.equal(liveVideo.hasAttribute("disablepictureinpicture"), true);
  assert.equal(popupVideo.disablePictureInPicture, true);
  assert.equal(popupVideo.hasAttribute("disablepictureinpicture"), true);
});

test("desktop PiP sync loads once and replays against the full controller", async () => {
  const calls = [];
  let loads = 0;
  class PictureInPictureController {
    constructor(options) {
      calls.push(["construct", options]);
    }

    sync() {
      calls.push(["sync"]);
    }

    async toggle(video, options) {
      calls.push(["toggle", video, options]);
      return "toggled";
    }
  }
  const options = {
    resolveButton: () => createButton(),
    resolveLiveVideo: () => null,
    resolvePopupVideo: () => null,
    isPopupOpen: () => false,
    isMobileTabletViewport: () => false,
    isFirefox: () => false,
  };
  const controller = new LazyPictureInPictureController(options, {
    loadModule: async () => {
      loads += 1;
      return { PictureInPictureController };
    },
  });

  controller.sync();
  const video = { id: "live-video" };
  const result = await controller.toggle(video, { popup: false });
  controller.sync();

  assert.equal(result, "toggled");
  assert.equal(loads, 1);
  assert.deepEqual(calls, [
    ["construct", options],
    ["sync"],
    ["toggle", video, { popup: false }],
    ["sync"],
  ]);
});

test("PiP clear and dispose do not wake a dormant controller", async () => {
  const liveButton = createButton();
  const popupButton = createButton();
  let loads = 0;
  const controller = new LazyPictureInPictureController(
    {
      resolveButton: (scope) =>
        scope === "popup" ? popupButton : liveButton,
    },
    {
      loadModule: async () => {
        loads += 1;
        return {};
      },
    },
  );

  controller.clear("live");
  controller.dispose();
  await Promise.resolve();

  assert.equal(loads, 0);
  assert.equal(liveButton.hidden, true);
  assert.equal(popupButton.hidden, true);
});
