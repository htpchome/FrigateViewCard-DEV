import { test } from "node:test";
import assert from "node:assert/strict";

import { BrowseBackgroundWorkController } from "../src/features/browse/background-work.ctrl.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const createFixture = ({ requestIdle = null } = {}) => {
  const calls = [];
  const timers = new Map();
  const idleCallbacks = new Map();
  let nextHandle = 1;
  const host = {
    isConnected: true,
    _browseWindowLoaderController: {
      scheduleWarmOtherCamerasEvents: (delayMs) =>
        calls.push(["warm", delayMs]),
    },
    _prefetchCalendarActivityForActiveCamera: async () =>
      calls.push(["calendar"]),
  };
  const controller = new BrowseBackgroundWorkController(host, {
    setTimer: (callback, delayMs) => {
      const handle = nextHandle++;
      timers.set(handle, { callback, delayMs });
      return handle;
    },
    clearTimer: (handle) => timers.delete(handle),
    requestIdle:
      requestIdle === false
        ? null
        : (callback, options) => {
            const handle = nextHandle++;
            idleCallbacks.set(handle, { callback, options });
            return handle;
          },
    cancelIdle: (handle) => idleCallbacks.delete(handle),
    phoneDelayMs: 2500,
    idleTimeoutMs: 5000,
  });
  return { calls, controller, host, idleCallbacks, timers };
};

test("desktop startup preserves eager camera warming and post-load calendar prefetch", async () => {
  const fixture = createFixture();
  const initialLoad = deferred();

  fixture.controller.scheduleStartup({
    phone: false,
    initialLoad: initialLoad.promise,
  });

  assert.deepEqual(fixture.calls, [["warm", undefined]]);
  initialLoad.resolve();
  await initialLoad.promise;
  await Promise.resolve();

  assert.deepEqual(fixture.calls, [["warm", undefined], ["calendar"]]);
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.idleCallbacks.size, 0);
});

test("phone startup waits for visible data, a delay, and browser idle", async () => {
  const fixture = createFixture();
  const initialLoad = deferred();

  fixture.controller.scheduleStartup({
    phone: true,
    initialLoad: initialLoad.promise,
  });
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.timers.size, 0);

  initialLoad.resolve();
  await initialLoad.promise;
  await Promise.resolve();

  assert.equal(fixture.timers.size, 1);
  const timer = [...fixture.timers.values()][0];
  assert.equal(timer.delayMs, 2500);
  timer.callback();
  assert.deepEqual(fixture.calls, []);

  assert.equal(fixture.idleCallbacks.size, 1);
  const idle = [...fixture.idleCallbacks.values()][0];
  assert.deepEqual(idle.options, { timeout: 5000 });
  idle.callback();

  assert.deepEqual(fixture.calls, [["warm", 0], ["calendar"]]);
});

test("phone startup uses the delayed fallback when requestIdleCallback is unavailable", async () => {
  const fixture = createFixture({ requestIdle: false });

  fixture.controller.scheduleStartup({ phone: true });
  await Promise.resolve();
  const timer = [...fixture.timers.values()][0];
  timer.callback();

  assert.deepEqual(fixture.calls, [["warm", 0], ["calendar"]]);
  assert.equal(fixture.idleCallbacks.size, 0);
});

test("cancel prevents pending phone background work", async () => {
  const fixture = createFixture();

  fixture.controller.scheduleStartup({ phone: true });
  await Promise.resolve();
  fixture.controller.cancel();

  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.idleCallbacks.size, 0);
  assert.deepEqual(fixture.calls, []);
});

test("detached cards do not start deferred phone requests", async () => {
  const fixture = createFixture();

  fixture.controller.scheduleStartup({ phone: true });
  await Promise.resolve();
  fixture.host.isConnected = false;
  const timer = [...fixture.timers.values()][0];
  timer.callback();

  assert.equal(fixture.idleCallbacks.size, 0);
  assert.deepEqual(fixture.calls, []);
});
