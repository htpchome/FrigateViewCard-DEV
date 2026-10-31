import { test } from "node:test";
import assert from "node:assert/strict";

import { LiveFullscreenLifecycleController } from "../src/features/live/fullscreen-lifecycle.ctrl.js";

class FakeTarget extends EventTarget {
  playCalls = 0;
  pauseCalls = 0;
  isConnected = true;

  play() {
    this.playCalls += 1;
    return Promise.resolve();
  }

  pause() {
    this.pauseCalls += 1;
  }
}

const createFixture = () => {
  const initialVideo = new FakeTarget();
  let currentVideo = initialVideo;
  const resumeReasons = [];
  let exitCount = 0;
  let frameSequence = 0;
  const frames = new Map();
  const controller = new LiveFullscreenLifecycleController({
    getCurrentVideo: () => currentVideo,
    scheduleResumeLive: (reason) => resumeReasons.push(reason),
    onFullscreenExit: () => {
      exitCount += 1;
    },
    requestFrame: (callback) => {
      const frame = ++frameSequence;
      frames.set(frame, callback);
      return frame;
    },
    cancelFrame: (frame) => frames.delete(frame),
  });

  const flushFrame = () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback();
  };

  return {
    controller,
    initialVideo,
    resumeReasons,
    getExitCount: () => exitCount,
    flushInlineRestore: () => {
      flushFrame();
      flushFrame();
    },
    setCurrentVideo: (video) => {
      currentVideo = video;
    },
  };
};

test("document fullscreen exit resumes the current live video once", () => {
  const fixture = createFixture();
  fixture.controller.beginDocumentFullscreen(fixture.initialVideo);
  assert.equal(fixture.controller.active, true);

  fixture.controller.handleDocumentFullscreenChange({});
  fixture.controller.handleDocumentFullscreenChange(null);
  fixture.controller.handleDocumentFullscreenChange(null);
  fixture.flushInlineRestore();

  assert.equal(fixture.controller.active, false);
  assert.equal(fixture.initialVideo.playCalls, 1);
  assert.deepEqual(fixture.resumeReasons, []);
  assert.equal(fixture.getExitCount(), 1);
});

test("document fullscreen request cancellation does not trigger recovery", () => {
  const fixture = createFixture();
  fixture.controller.beginDocumentFullscreen(fixture.initialVideo);
  fixture.controller.cancel();
  fixture.controller.handleDocumentFullscreenChange(null);

  assert.equal(fixture.initialVideo.playCalls, 0);
  assert.equal(fixture.initialVideo.pauseCalls, 0);
  assert.deepEqual(fixture.resumeReasons, []);
  assert.equal(fixture.getExitCount(), 0);
});

test("native video fullscreen exit uses the current video only when its session video disconnected", () => {
  const fixture = createFixture();
  const replacementVideo = new FakeTarget();
  fixture.controller.beginNativeVideoFullscreen(fixture.initialVideo);
  assert.equal(fixture.controller.active, true);
  fixture.initialVideo.isConnected = false;
  fixture.setCurrentVideo(replacementVideo);

  fixture.initialVideo.dispatchEvent(new Event("webkitendfullscreen"));
  fixture.initialVideo.dispatchEvent(new Event("webkitendfullscreen"));
  fixture.flushInlineRestore();

  assert.equal(fixture.controller.active, false);
  assert.equal(fixture.initialVideo.playCalls, 0);
  assert.equal(fixture.initialVideo.pauseCalls, 0);
  assert.equal(replacementVideo.playCalls, 2);
  assert.equal(replacementVideo.pauseCalls, 1);
  assert.deepEqual(fixture.resumeReasons, []);
});

test("native fullscreen recovery retains its exact connected session video", () => {
  const fixture = createFixture();
  const unrelatedCurrentVideo = new FakeTarget();
  fixture.controller.beginNativeVideoFullscreen(fixture.initialVideo);
  fixture.setCurrentVideo(unrelatedCurrentVideo);

  fixture.initialVideo.dispatchEvent(new Event("webkitendfullscreen"));
  fixture.flushInlineRestore();

  assert.equal(fixture.initialVideo.playCalls, 2);
  assert.equal(fixture.initialVideo.pauseCalls, 1);
  assert.equal(unrelatedCurrentVideo.playCalls, 0);
  assert.deepEqual(fixture.resumeReasons, []);
});

test("native presentation-mode exit resumes live once", () => {
  const fixture = createFixture();
  fixture.initialVideo.webkitPresentationMode = "fullscreen";
  fixture.controller.beginNativeVideoFullscreen(fixture.initialVideo);

  fixture.initialVideo.dispatchEvent(
    new Event("webkitpresentationmodechanged"),
  );
  assert.equal(fixture.controller.active, true);

  fixture.initialVideo.webkitPresentationMode = "inline";
  fixture.initialVideo.dispatchEvent(
    new Event("webkitpresentationmodechanged"),
  );
  fixture.initialVideo.dispatchEvent(new Event("webkitendfullscreen"));
  fixture.flushInlineRestore();

  assert.equal(fixture.controller.active, false);
  assert.equal(fixture.initialVideo.playCalls, 2);
  assert.equal(fixture.initialVideo.pauseCalls, 1);
  assert.deepEqual(fixture.resumeReasons, []);
});

test("fullscreen exit requests recovery only when no retained media remains", () => {
  const fixture = createFixture();
  fixture.controller.beginDocumentFullscreen(null);
  fixture.setCurrentVideo(null);

  fixture.controller.handleDocumentFullscreenChange({});
  fixture.controller.handleDocumentFullscreenChange(null);

  assert.deepEqual(fixture.resumeReasons, ["live-fullscreen-media-missing"]);
});

test("a new fullscreen session cancels a deferred exit resume", () => {
  const fixture = createFixture();
  fixture.controller.beginNativeVideoFullscreen(fixture.initialVideo);
  fixture.initialVideo.dispatchEvent(new Event("webkitendfullscreen"));

  fixture.controller.beginDocumentFullscreen(fixture.initialVideo);
  fixture.flushInlineRestore();

  assert.equal(fixture.initialVideo.playCalls, 1);
  assert.equal(fixture.initialVideo.pauseCalls, 1);
  assert.equal(fixture.controller.active, true);
});
