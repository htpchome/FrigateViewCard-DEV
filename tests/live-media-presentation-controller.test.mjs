import { test } from "node:test";
import assert from "node:assert/strict";

import { LiveMediaPresentationController } from "../src/features/live/media-presentation.ctrl.js";

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const playbackFixture = ({ rejectFirstPlay = false } = {}) => {
  const video = Object.assign(new EventTarget(), {
    style: {},
    isConnected: true,
    paused: true,
    ended: false,
    muted: true,
    readyState: 2,
    playCalls: 0,
    play() {
      this.playCalls += 1;
      if (rejectFirstPlay && this.playCalls === 1) {
        return Promise.reject(Object.assign(new Error("not ready"), {
          name: "AbortError",
        }));
      }
      this.paused = false;
      this.dispatchEvent(new Event("playing"));
      return Promise.resolve();
    },
  });
  const engine = { video, entity: "camera.one" };
  const host = {
    _engine: engine,
    _started: true,
    _viewMode: "single",
    _activeCam: { entity: "camera.one" },
    _isPreviewPageActive: () => false,
    _isCardVisible: () => true,
    _isCameraRuntimeSuspended: () => false,
    _$: () => null,
  };
  return { video, engine, host };
};

test("live media presentation replaces engines through one cleanup path", () => {
  const previousEngine = { id: "previous" };
  const nextEngine = { id: "next" };
  const calls = [];
  const host = {
    _engine: previousEngine,
    _haDirectMounter: {
      release: (engine) => calls.push(["release", engine]),
    },
    _liveVideoZoomController: {
      dispose: () => calls.push(["dispose-zoom"]),
    },
    _clearPictureInPictureButtonController: (scope) =>
      calls.push(["clear-pip", scope]),
    _liveViewResizeController: {
      attachMedia: (media) => calls.push(["resize", media]),
    },
    _syncPictureInPictureButtons: () => calls.push(["sync-pip"]),
  };
  const controller = new LiveMediaPresentationController(host);
  controller.attachVideoZoom = (engine) => calls.push(["attach", engine]);

  controller.assignEngine(nextEngine);

  assert.equal(host._engine, nextEngine);
  assert.deepEqual(calls, [
    ["release", previousEngine],
    ["dispose-zoom"],
    ["clear-pip", "live"],
    ["resize", null],
    ["attach", nextEngine],
  ]);
});

test("live media presentation refreshes an unchanged video attachment", () => {
  const engine = {};
  const video = { style: {} };
  const zoomHost = {};
  const interactionTarget = {};
  const calls = [];
  const host = {
    _engine: engine,
    _liveViewResizeController: {
      attachMedia: (media) => calls.push(["resize", media]),
    },
    _liveVideoZoomController: {
      video,
      host: zoomHost,
      interactionTarget,
      refresh: () => calls.push(["refresh"]),
    },
    _syncPictureInPictureButtons: () => calls.push(["sync-pip"]),
  };

  new LiveMediaPresentationController(host).attachVideoZoom(engine, video);

  assert.deepEqual(calls, [
    ["resize", video],
    ["refresh"],
    ["sync-pip"],
  ]);
  assert.deepEqual(video.style, {
    display: "block",
    width: "100%",
    height: "100%",
    objectPosition: "center center",
    objectFit: "contain",
  });
});

test("live media presentation releases Catalyst HLS through its side path", () => {
  const previousEngine = { catalystHls: true };
  const nextEngine = {};
  const calls = [];
  const host = {
    _engine: previousEngine,
    _catalystHlsMounter: {
      release: (engine) => calls.push(["release-catalyst", engine]),
    },
    _haDirectMounter: {
      release: () => calls.push(["release-ha"]),
    },
    _clearPictureInPictureButtonController: () => {},
    _liveViewResizeController: { attachMedia: () => {} },
  };
  const controller = new LiveMediaPresentationController(host);
  controller.attachVideoZoom = () => {};

  controller.assignEngine(nextEngine);

  assert.deepEqual(calls, [["release-catalyst", previousEngine]]);
});

test("live media presentation suspends zoom during rotate overlays", () => {
  const suspended = [];
  const host = {
    _liveVideoZoomController: {
      setPresentationSuspended: (value) => suspended.push(value),
    },
  };
  const controller = new LiveMediaPresentationController(host);

  controller.syncRotateZoomPresentation({
    classList: {
      contains: (name) => name === "mobile-rotate-live-exit",
    },
  });
  controller.syncRotateZoomPresentation({
    classList: { contains: () => false },
  });

  assert.deepEqual(suspended, [true, false]);
});

test("selected presentation restarts a paused retained video without changing mute state", async () => {
  const { video, engine, host } = playbackFixture();
  const controller = new LiveMediaPresentationController(host);

  assert.equal(controller.activateSelectedPlayback(engine, video), true);
  await flush();

  assert.equal(video.playCalls, 1);
  assert.equal(video.muted, true);

  video.paused = true;
  video.dispatchEvent(new Event("pause"));
  await flush();

  assert.equal(video.playCalls, 2);
  assert.equal(video.muted, true);
});

test("selected presentation retries when the final video becomes media-ready", async () => {
  const { video, engine, host } = playbackFixture({ rejectFirstPlay: true });
  const controller = new LiveMediaPresentationController(host);

  controller.activateSelectedPlayback(engine, video);
  await flush();
  assert.equal(video.playCalls, 1);

  video.dispatchEvent(new Event("canplay"));
  await flush();

  assert.equal(video.playCalls, 2);
  assert.equal(video.paused, false);
});

test("selected presentation does not restart media on Grid, Preview, or hidden pages", async () => {
  for (const blocked of ["grid", "preview", "hidden"]) {
    const { video, engine, host } = playbackFixture();
    if (blocked === "grid") host._viewMode = "grid";
    if (blocked === "preview") host._isPreviewPageActive = () => true;
    if (blocked === "hidden") host._isCardVisible = () => false;
    const controller = new LiveMediaPresentationController(host);

    assert.equal(controller.activateSelectedPlayback(engine, video), true);
    await flush();
    assert.equal(video.playCalls, 0, blocked);
  }
});

test("replaced engines cannot restart their former retained video", async () => {
  const first = playbackFixture();
  const second = playbackFixture();
  const controller = new LiveMediaPresentationController(first.host);

  controller.activateSelectedPlayback(first.engine, first.video);
  await flush();
  assert.equal(first.video.playCalls, 1);

  first.host._engine = second.engine;
  controller.activateSelectedPlayback(second.engine, second.video);
  await flush();
  first.video.paused = true;
  first.video.dispatchEvent(new Event("pause"));
  await flush();

  assert.equal(first.video.playCalls, 1);
  assert.equal(second.video.playCalls, 1);
});

test("a retained engine cannot restart after camera selection has moved on", async () => {
  const { video, engine, host } = playbackFixture();
  host._activeCam = { entity: "camera.two" };
  const controller = new LiveMediaPresentationController(host);

  controller.activateSelectedPlayback(engine, video);
  await flush();

  assert.equal(video.playCalls, 0);
});
