import { test } from "node:test";
import assert from "node:assert/strict";

import { createGo2RtcRaceMounter } from "../src/features/live/go2rtc-race-mounter.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createRetryHarness = (t, options = {}) => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ style: {}, remove() {} }) };
  const state = {
    now: 1000, token: 0, calls: [], adopted: [], gates: [], pending: [], timer: null,
    webRtc: "failed", mse: true, stable: true, winner: null,
  };
  const result = (type, slot) => ({
    ok: true, type, slot,
    engine: { destroyed: false, destroy() { this.destroyed = true; } },
  });
  const race = createGo2RtcRaceMounter({
    mounter: {
      tryMountWebRtc: async (slot, _startup, { entity, abortSignal }) => {
        state.calls.push([entity, "webrtc"]);
        const mode = state.webRtc;
        if (mode === "pending" || mode === "late") {
          return await new Promise((resolve) => {
            state.gates.push({
              fail: () => resolve(false),
              succeed: () => resolve(result("webrtc", slot)),
              signal: abortSignal,
            });
            if (mode === "pending") {
              abortSignal.addEventListener("abort", () => resolve(false), { once: true });
            }
          });
        }
        if (mode === "throw") throw new Error("signaling failed");
        return mode === "ready" ? result("webrtc", slot) : false;
      },
      tryMountMse: async (slot, _startup, { entity }) => {
        state.calls.push([entity, "mse"]);
        return state.mse ? result("mse", slot) : false;
      },
    },
    resolveConnectionType: (entity) => entity === "camera.ha" ? "ha_direct" : "frigate_go2rtc",
    getPendingMountDestroyers: () => state.pending,
    setPendingMountDestroyers: (pending) => { state.pending = pending; },
    isMountTokenCurrent: (token) => token === state.token,
    adoptMountedAttempt: (_slot, winner) => {
      state.winner = winner.engine;
      state.adopted.push(winner.type);
    },
    waitForStreamStart: async () => state.stable,
    isCurrentWinnerEngine: (engine) => state.winner === engine,
    getPendingWebRtcTakeoverTimer: () => state.timer,
    setPendingWebRtcTakeoverTimer: (timer) => { state.timer = timer; },
    preferredWebRtcWaitMs: 0,
    mobileFallbackHedgeMs: 0,
    webRtcRetryBackoffMs: 0,
    getNowMs: () => state.now,
    ...options,
  });
  const slot = {
    appendChild() {},
    attachOrchestrator(orchestrator) { this.orchestrator = orchestrator; },
    clearOrchestrator(orchestrator) {
      if (this.orchestrator === orchestrator) this.orchestrator = null;
    },
  };
  const mount = async (entity = "camera.front", forcedType = null) => {
    state.token += 1;
    const mounted = await race.mountWithRace({
      slot, entity, forcedType, mountToken: state.token,
    });
    await delay(0);
    return mounted;
  };
  t.after(() => {
    race.cancelPendingWebRtcAttempts();
    if (state.timer) clearTimeout(state.timer);
    for (const gate of state.gates) gate.fail();
    globalThis.document = previousDocument;
  });
  const count = (type, entity = "camera.front") =>
    state.calls.filter((call) => call[0] === entity && call[1] === type).length;
  return { state, race, slot, mount, count };
};

for (const isMobile of [false, true]) {
  test(`Frigate WebRTC retries after 2 then 5 minutes without sliding the deadline (${isMobile ? "mobile" : "desktop"})`, async (t) => {
    const { state, mount, count } = createRetryHarness(t, { isMobile });
    assert.equal(await mount(), true);
    assert.equal(count("webrtc"), 1);
    assert.equal(state.adopted.at(-1), "mse");
    const firstFailureAt = state.now;
    for (const elapsed of [20001, 60000, 119999]) {
      state.now = firstFailureAt + elapsed;
      await mount();
      assert.equal(count("webrtc"), 1);
    }
    state.now = firstFailureAt + 120000;
    // Expiration alone must not start a probe or disturb the live MSE engine.
    const retained = state.winner;
    await delay(0);
    assert.equal(count("webrtc"), 1);
    assert.equal(retained.destroyed, false);
    await mount();
    assert.equal(count("webrtc"), 2);
    const secondFailureAt = state.now;
    for (const elapsed of [20001, 120000, 299999]) {
      state.now = secondFailureAt + elapsed;
      await mount();
      assert.equal(count("webrtc"), 2);
    }
    state.now = secondFailureAt + 300000;
    await mount();
    assert.equal(count("webrtc"), 3);
    // Repeated failures stay capped at five minutes, not ten or forever.
    state.now += 300000;
    state.webRtc = "pending";
    await mount();
    assert.equal(count("webrtc"), 4);
    const fallback = state.winner;
    state.gates.at(-1).succeed();
    await delay(0);
    assert.equal(state.adopted.at(-1), "webrtc");
    assert.equal(fallback.destroyed, true);
    assert.equal(state.timer, null);
    assert.deepEqual(state.pending, []);
    // Success clears both the cooldown and accumulated failures.
    state.webRtc = "failed";
    await mount();
    assert.equal(count("webrtc"), 5);
    await mount();
    assert.equal(count("webrtc"), 6);
    state.now += 119999;
    await mount();
    assert.equal(count("webrtc"), 6);
    state.now += 1;
    await mount();
    assert.equal(count("webrtc"), 7);
  });
}

test("a previously working WebRTC camera retries once before the 2-minute cooldown", async (t) => {
  const { state, mount, count } = createRetryHarness(t);
  state.webRtc = "ready";
  await mount();
  state.webRtc = "failed";
  await mount();
  state.webRtc = "pending";
  await mount();
  assert.equal(count("webrtc"), 3);
  const fallback = state.winner;
  state.gates.at(-1).succeed();
  await delay(0);
  assert.equal(state.adopted.at(-1), "webrtc");
  assert.equal(fallback.destroyed, true);
});

test("MSE failure and explicit WebRTC requests bypass suppression", async (t) => {
  const { state, mount, count } = createRetryHarness(t);
  await mount();
  state.mse = false;
  state.webRtc = "ready";
  assert.equal(await mount(), true);
  assert.equal(count("webrtc"), 2);
  assert.equal(state.adopted.at(-1), "webrtc");
  // Build a new cooldown, then exercise the explicit-transport escape.
  state.mse = true;
  state.webRtc = "failed";
  await mount();
  await mount();
  const before = count("webrtc");
  await mount();
  assert.equal(count("webrtc"), before);
  state.webRtc = "ready";
  await mount("camera.front", "webrtc");
  assert.equal(count("webrtc"), before + 1);
  assert.equal(state.adopted.at(-1), "webrtc");
});

test("an offline camera does not teach WebRTC suppression without working MSE", async (t) => {
  const { state, mount, count } = createRetryHarness(t);
  state.mse = false;
  assert.equal(await mount(), false);
  state.mse = true;
  state.webRtc = "ready";
  assert.equal(await mount(), true);
  assert.equal(count("webrtc"), 2);
});

for (const cancellation of ["camera switch", "pending destroyer", "stale token"]) {
  test(`${cancellation} does not count as a WebRTC failure`, async (t) => {
    const { state, mount, race, count } = createRetryHarness(t);
    state.webRtc = "pending";
    // Cancellation during pending takeover must not exhaust a camera's retries.
    for (let index = 0; index < 3; index += 1) {
      await mount();
      if (cancellation === "camera switch") race.cancelPendingWebRtcAttempts();
      if (cancellation === "pending destroyer") {
        state.pending.find((entry) => entry.type === "webrtc").destroy();
      }
      if (cancellation === "stale token") {
        state.token += 1;
        state.gates.at(-1).fail();
      }
      await delay(0);
    }
    state.webRtc = "ready";
    await mount();
    assert.equal(count("webrtc"), 4);
    assert.equal(state.adopted.at(-1), "webrtc");
  });
}

test("removing the layout before a winner does not teach WebRTC suppression", async (t) => {
  const { state, mount, slot, count } = createRetryHarness(t);
  state.webRtc = "pending";
  state.mse = false;
  const mounting = mount();
  await delay(0);
  await slot.orchestrator.stop();
  assert.equal(await mounting, false);
  state.mse = true;
  state.webRtc = "ready";
  await mount();
  assert.equal(count("webrtc"), 2);
  assert.equal(state.adopted.at(-1), "webrtc");
});

test("genuine takeover timeout counts once and rejects a late WebRTC success", async (t) => {
  const { state, mount, count } = createRetryHarness(t, { deferredWebRtcMaxHoldMs: 10 });
  state.webRtc = "late";
  await mount();
  await delay(25);
  assert.equal(state.gates[0].signal.aborted, true);
  state.gates[0].succeed();
  await delay(0);
  assert.equal(state.adopted.at(-1), "mse");
  await mount();
  assert.equal(count("webrtc"), 1);
  state.now += 120000;
  state.webRtc = "ready";
  await mount();
  assert.equal(count("webrtc"), 2);
  assert.equal(state.adopted.at(-1), "webrtc");
});

test("failed takeover readiness suppresses WebRTC but stale readiness does not", async (t) => {
  const { state, mount, count } = createRetryHarness(t);
  state.webRtc = "pending";
  state.stable = false;
  await mount();
  state.gates[0].succeed();
  await delay(0);
  await mount();
  assert.equal(count("webrtc"), 1);
  state.now += 120000;
  state.stable = true;
  await mount();
  state.token += 1;
  state.gates.at(-1).succeed();
  await delay(0);
  await mount();
  assert.equal(count("webrtc"), 3);
});

test("failure history is isolated by camera and owner and never affects HA Direct", async (t) => {
  const first = createRetryHarness(t);
  first.state.webRtc = "throw";
  await first.mount();
  await first.mount();
  assert.equal(first.count("webrtc"), 1);
  first.state.webRtc = "ready";
  await first.mount("camera.other");
  assert.equal(first.count("webrtc", "camera.other"), 1);
  const before = first.state.calls.length;
  assert.equal(await first.mount("camera.ha"), false);
  assert.equal(first.state.calls.length, before);
  await t.test("an independent owner has no inherited cooldown", async (child) => {
    const second = createRetryHarness(child);
    second.state.webRtc = "ready";
    await second.mount();
    assert.equal(second.count("webrtc"), 1);
    assert.equal(second.state.adopted.at(-1), "webrtc");
  });
});

test("go2rtc race mounter excludes HLS from automatic startup", () => {
  const raceMounter = createGo2RtcRaceMounter({
    mounter: {
      tryMountWebRtc: () => ({ ok: true }),
      tryMountMse: () => ({ ok: true }),
      tryMountHls: () => ({ ok: true }),
    },
    resolveConnectionType: () => "frigate_go2rtc",
    getPendingMountDestroyers: () => [],
    setPendingMountDestroyers: () => {},
    isMountTokenCurrent: () => true,
    adoptMountedAttempt: () => {},
    waitForStreamStart: async () => true,
    isCurrentWinnerEngine: () => true,
    getPendingWebRtcTakeoverTimer: () => null,
    setPendingWebRtcTakeoverTimer: () => {},
  });

  const attempts = raceMounter.buildAttempts("camera.front");
  assert.deepEqual(
    attempts.map((attempt) => attempt.type),
    ["webrtc", "mse"],
  );
});

test("go2rtc race mounter adopts the fallback winner and retains deferred webrtc", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ style: {}, remove() {} }),
  };
  let pendingDestroyers = [];
  let adopted = null;
  let pendingTimer = null;
  let webrtcCalls = 0;
  let mseCalls = 0;
  let winnerDestroyed = false;
  let currentWinnerEngine = null;
  const adoptionOptions = [];
  try {
    const raceMounter = createGo2RtcRaceMounter({
      mounter: {
        tryMountWebRtc: async (slot) => {
          webrtcCalls += 1;
          await delay(20);
          return {
            ok: true,
            type: "webrtc",
            slot,
            engine: { destroy() {} },
          };
        },
        tryMountMse: async (slot) => {
          mseCalls += 1;
          return {
            ok: true,
            type: "mse",
            slot,
            engine: {
              destroy() {
                winnerDestroyed = true;
              },
            },
          };
        },
        tryMountHls: async () => false,
      },
      resolveConnectionType: () => "frigate_go2rtc",
      getPendingMountDestroyers: () => pendingDestroyers,
      setPendingMountDestroyers: (next) => {
        pendingDestroyers = next;
      },
      isMountTokenCurrent: () => true,
      adoptMountedAttempt: (slot, winner, options = {}) => {
        adopted = { slot, winner };
        adoptionOptions.push(options);
        currentWinnerEngine = winner?.engine || null;
      },
      waitForStreamStart: async () => true,
      isCurrentWinnerEngine: (engine) => currentWinnerEngine === engine,
      getPendingWebRtcTakeoverTimer: () => pendingTimer,
      setPendingWebRtcTakeoverTimer: (timer) => {
        pendingTimer = timer;
      },
      preferredWebRtcWaitMs: 5,
    });

    const slot = {
      children: [],
      attachedOrchestrator: null,
      clearedOrchestrator: null,
      appendChild(child) {
        this.children.push(child);
      },
      attachOrchestrator(orchestrator) {
        this.attachedOrchestrator = orchestrator;
      },
      clearOrchestrator(orchestrator) {
        this.clearedOrchestrator = orchestrator;
      },
    };

    const result = await raceMounter.mountWithRace({
      slot,
      entity: "camera.front",
      mountToken: 7,
    });

    assert.equal(result, true);
    assert.equal(adopted?.winner?.type, "mse");
    assert.equal(adoptionOptions[0]?.preservePendingSlots, true);
    await delay(0);
    assert.deepEqual(
      pendingDestroyers.map((attempt) => attempt.type),
      ["webrtc"],
    );
    assert.ok(slot.attachedOrchestrator);
    await delay(80);

    assert.equal(slot.clearedOrchestrator, slot.attachedOrchestrator);

    assert.equal(adopted?.winner?.type, "webrtc");
    assert.equal(adoptionOptions[1]?.preservePendingSlots, undefined);
    assert.equal(winnerDestroyed, true);
    assert.equal(pendingTimer, null);
    assert.deepEqual(pendingDestroyers, []);
    const reusedHintResult = await raceMounter.mountWithRace({
      slot,
      entity: "camera.front",
      mountToken: 8,
    });

    assert.equal(reusedHintResult, true);
    assert.equal(adopted?.winner?.type, "webrtc");
    assert.equal(webrtcCalls, 2);
    assert.equal(mseCalls, 1);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("remembered MSE still plays when a fresh WebRTC attempt fails", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ style: {}, remove() {} }),
  };
  let webrtcCalls = 0;
  let mseCalls = 0;
  try {
    const raceMounter = createGo2RtcRaceMounter({
      mounter: {
        tryMountWebRtc: async (slot) => {
          webrtcCalls += 1;
          await delay(10);
          return { ok: false, type: "webrtc", slot, engine: { destroy() {} } };
        },
        tryMountMse: async (slot) => {
          mseCalls += 1;
          return { ok: true, type: "mse", slot, engine: { destroy() {} } };
        },
        tryMountHls: async () => false,
      },
      resolveConnectionType: () => "frigate_go2rtc",
      getPendingMountDestroyers: () => [],
      setPendingMountDestroyers: () => {},
      isMountTokenCurrent: () => true,
      adoptMountedAttempt: () => {},
      waitForStreamStart: async () => true,
      isCurrentWinnerEngine: () => true,
      getPendingWebRtcTakeoverTimer: () => null,
      setPendingWebRtcTakeoverTimer: () => {},
    });

    const slot = { appendChild() {} };

    await raceMounter.mountWithRace({
      slot,
      entity: "camera.front",
      forcedType: "mse",
      mountToken: 1,
    });
    await raceMounter.mountWithRace({
      slot,
      entity: "camera.front",
      mountToken: 2,
    });

    assert.equal(mseCalls, 2);
    assert.equal(webrtcCalls, 1);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("WebRTC succeeds even when remembered MSE fails", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ style: {}, remove() {} }),
  };
  let webrtcCalls = 0;
  let mseCalls = 0;
  let adoptedType = "";
  try {
    const raceMounter = createGo2RtcRaceMounter({
      mounter: {
        tryMountWebRtc: async (slot) => {
          webrtcCalls += 1;
          return { ok: true, type: "webrtc", slot, engine: { destroy() {} } };
        },
        tryMountMse: async (slot) => {
          mseCalls += 1;
          if (mseCalls <= 1) {
            return { ok: true, type: "mse", slot, engine: { destroy() {} } };
          }
          return false;
        },
        tryMountHls: async () => false,
      },
      resolveConnectionType: () => "frigate_go2rtc",
      getPendingMountDestroyers: () => [],
      setPendingMountDestroyers: () => {},
      isMountTokenCurrent: () => true,
      adoptMountedAttempt: (_slot, winner) => {
        adoptedType = winner?.type || "";
      },
      waitForStreamStart: async () => true,
      isCurrentWinnerEngine: () => true,
      getPendingWebRtcTakeoverTimer: () => null,
      setPendingWebRtcTakeoverTimer: () => {},
    });

    const slot = { appendChild() {} };

    await raceMounter.mountWithRace({
      slot,
      entity: "camera.back",
      forcedType: "mse",
      mountToken: 10,
    });
    const result = await raceMounter.mountWithRace({
      slot,
      entity: "camera.back",
      mountToken: 11,
    });

    assert.equal(result, true);
    assert.equal(adoptedType, "webrtc");
    assert.equal(mseCalls, 2);
    assert.equal(webrtcCalls, 1);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("go2rtc race mounter evicts oldest strategy hints when cache is full", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ style: {}, remove() {} }),
  };
  let webrtcCalls = 0;
  let mseCalls = 0;
  try {
    const raceMounter = createGo2RtcRaceMounter({
      mounter: {
        tryMountWebRtc: async (slot) => {
          webrtcCalls += 1;
          return { ok: true, type: "webrtc", slot, engine: { destroy() {} } };
        },
        tryMountMse: async (slot) => {
          mseCalls += 1;
          return { ok: true, type: "mse", slot, engine: { destroy() {} } };
        },
        tryMountHls: async () => false,
      },
      resolveConnectionType: () => "frigate_go2rtc",
      getPendingMountDestroyers: () => [],
      setPendingMountDestroyers: () => {},
      isMountTokenCurrent: () => true,
      adoptMountedAttempt: () => {},
      waitForStreamStart: async () => true,
      isCurrentWinnerEngine: () => true,
      getPendingWebRtcTakeoverTimer: () => null,
      setPendingWebRtcTakeoverTimer: () => {},
    });

    const slot = { appendChild() {} };

    for (let index = 0; index < 70; index += 1) {
      await raceMounter.mountWithRace({
        slot,
        entity: `camera.seed_${index}`,
        forcedType: "webrtc",
        mountToken: index + 1,
      });
    }

    await raceMounter.mountWithRace({
      slot,
      entity: "camera.seed_69",
      mountToken: 199,
    });
    assert.equal(webrtcCalls, 71);
    assert.equal(mseCalls, 0);

    await raceMounter.mountWithRace({
      slot,
      entity: "camera.seed_0",
      mountToken: 200,
    });

    assert.equal(webrtcCalls, 72);
    assert.equal(mseCalls, 1);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("a failed remembered WebRTC connection cannot lock later connections to MSE", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ style: {}, remove() {} }),
  };
  let nowMs = 1000;
  let webRtcAvailable = true;
  let webRtcGate = null;
  let pendingDestroyers = [];
  let pendingTimer = null;
  let currentWinnerEngine = null;
  let adoptedType = "";
  const calls = { webrtc: 0, mse: 0 };
  try {
    const raceMounter = createGo2RtcRaceMounter({
      mounter: {
        tryMountWebRtc: async (slot) => {
          calls.webrtc += 1;
          if (!webRtcAvailable) return false;
          if (webRtcGate) await webRtcGate;
          return { ok: true, type: "webrtc", slot, engine: { destroy() {} } };
        },
        tryMountMse: async (slot) => {
          calls.mse += 1;
          const engine = { destroyed: false, destroy() { this.destroyed = true; } };
          return { ok: true, type: "mse", slot, engine };
        },
      },
      resolveConnectionType: () => "frigate_go2rtc",
      getPendingMountDestroyers: () => pendingDestroyers,
      setPendingMountDestroyers: (next) => { pendingDestroyers = next; },
      isMountTokenCurrent: () => true,
      adoptMountedAttempt: (_slot, winner) => {
        currentWinnerEngine = winner.engine;
        adoptedType = winner.type;
      },
      waitForStreamStart: async () => true,
      isCurrentWinnerEngine: (engine) => currentWinnerEngine === engine,
      getPendingWebRtcTakeoverTimer: () => pendingTimer,
      setPendingWebRtcTakeoverTimer: (timer) => { pendingTimer = timer; },
      getNowMs: () => nowMs,
      preferredWebRtcWaitMs: 0,
    });
    const slot = { appendChild() {} };
    const mount = async (forcedType = null) => {
      assert.equal(await raceMounter.mountWithRace({
        slot, entity: "camera.front", mountToken: 1, forcedType,
      }), true);
      await delay(0);
    };

    await mount();
    assert.equal(adoptedType, "webrtc");
    assert.deepEqual(calls, { webrtc: 1, mse: 1 });

    webRtcAvailable = false;
    await mount();
    assert.equal(adoptedType, "mse");
    assert.deepEqual(calls, { webrtc: 2, mse: 2 });

    nowMs += 60 * 60 * 1000;
    await mount();
    assert.equal(adoptedType, "mse");
    assert.deepEqual(calls, { webrtc: 3, mse: 3 });
    assert.equal(pendingTimer, null);

    nowMs += 60 * 60 * 1000;
    webRtcAvailable = true;
    const gate = {};
    webRtcGate = new Promise((resolve) => { gate.release = resolve; });
    await mount();
    const fallbackEngine = currentWinnerEngine;
    assert.equal(adoptedType, "mse");
    assert.deepEqual(calls, { webrtc: 4, mse: 4 });
    gate.release();
    await delay(0);
    assert.equal(adoptedType, "webrtc");
    assert.equal(fallbackEngine.destroyed, true);
    assert.equal(pendingTimer, null);
    assert.deepEqual(pendingDestroyers, []);

    // Successful WebRTC still uses its single-transport fast path next time.
    await mount();
    assert.equal(adoptedType, "webrtc");
    assert.deepEqual(calls, { webrtc: 5, mse: 4 });

    // An explicitly forced MSE request must not create a WebRTC attempt.
    await mount("mse");
    assert.equal(adoptedType, "mse");
    assert.deepEqual(calls, { webrtc: 5, mse: 5 });
  } finally {
    if (pendingTimer) clearTimeout(pendingTimer);
    globalThis.document = previousDocument;
  }
});

test("go2rtc race mounter clears deferred webrtc after max hold window", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ style: {}, remove() {} }),
  };
  let pendingDestroyers = [];
  let adoptedType = "";
  try {
    const raceMounter = createGo2RtcRaceMounter({
      mounter: {
        tryMountWebRtc: async (slot) => {
          await delay(120);
          return {
            ok: false,
            type: "webrtc",
            slot,
            engine: { destroy() {} },
          };
        },
        tryMountMse: async (slot) => ({
          ok: true,
          type: "mse",
          slot,
          engine: { destroy() {} },
        }),
        tryMountHls: async () => false,
      },
      resolveConnectionType: () => "frigate_go2rtc",
      getPendingMountDestroyers: () => pendingDestroyers,
      setPendingMountDestroyers: (next) => {
        pendingDestroyers = next;
      },
      isMountTokenCurrent: () => true,
      adoptMountedAttempt: (_slot, winner) => {
        adoptedType = winner?.type || "";
      },
      waitForStreamStart: async () => true,
      isCurrentWinnerEngine: () => true,
      getPendingWebRtcTakeoverTimer: () => null,
      setPendingWebRtcTakeoverTimer: () => {},
      deferredWebRtcMaxHoldMs: 40,
      preferredWebRtcWaitMs: 5,
    });

    const slot = { appendChild() {} };
    const result = await raceMounter.mountWithRace({
      slot,
      entity: "camera.front",
      mountToken: 7,
    });

    assert.equal(result, true);
    assert.equal(adoptedType, "mse");
    await delay(0);
    assert.deepEqual(
      pendingDestroyers.map((attempt) => attempt.type),
      ["webrtc"],
    );

    await delay(90);
    assert.deepEqual(pendingDestroyers, []);
    assert.equal(adoptedType, "mse");
  } finally {
    globalThis.document = previousDocument;
  }
});

test("settling an old deferred attempt cannot clear a newer camera mount", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ style: {}, remove() {} }),
  };
  let pendingDestroyers = [];
  let pendingTimer = null;
  let currentWinnerEngine = null;
  try {
    const raceMounter = createGo2RtcRaceMounter({
      mounter: {
        tryMountWebRtc: async (_slot, _startup, options) => {
          await delay(options.entity === "camera.first" ? 35 : 100);
          return false;
        },
        tryMountMse: async (slot) => ({
          ok: true,
          type: "mse",
          slot,
          engine: { destroy() {} },
        }),
        tryMountHls: async () => false,
      },
      resolveConnectionType: () => "frigate_go2rtc",
      getPendingMountDestroyers: () => pendingDestroyers,
      setPendingMountDestroyers: (next) => {
        pendingDestroyers = next;
      },
      isMountTokenCurrent: () => true,
      adoptMountedAttempt: (_slot, winner) => {
        currentWinnerEngine = winner?.engine || null;
      },
      waitForStreamStart: async () => true,
      isCurrentWinnerEngine: (engine) => currentWinnerEngine === engine,
      getPendingWebRtcTakeoverTimer: () => pendingTimer,
      setPendingWebRtcTakeoverTimer: (timer) => {
        pendingTimer = timer;
      },
      preferredWebRtcWaitMs: 1,
      deferredWebRtcMaxHoldMs: 500,
    });
    const makeSlot = () => ({
      appendChild() {},
      attachOrchestrator() {},
      clearOrchestrator() {},
    });

    await raceMounter.mountWithRace({
      slot: makeSlot(),
      entity: "camera.first",
      mountToken: 1,
    });
    await raceMounter.mountWithRace({
      slot: makeSlot(),
      entity: "camera.second",
      mountToken: 2,
    });
    await delay(55);

    assert.deepEqual(
      pendingDestroyers.map(({ entity, type }) => ({ entity, type })),
      [{ entity: "camera.second", type: "webrtc" }],
    );
    assert.notEqual(pendingTimer, null);

    await delay(80);
    assert.deepEqual(pendingDestroyers, []);
  } finally {
    if (pendingTimer) clearTimeout(pendingTimer);
    globalThis.document = previousDocument;
  }
});

test("race mounter can abort deferred WebRTC after shared cleanup handles are lost", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ style: {}, remove() {} }),
  };
  let pendingDestroyers = [];
  let pendingTimer = null;
  let abortCalls = 0;
  let currentWinnerEngine = null;
  try {
    const raceMounter = createGo2RtcRaceMounter({
      mounter: {
        tryMountWebRtc: async (_slot, _startup, options) =>
          await new Promise((resolve) => {
            options.abortSignal.addEventListener(
              "abort",
              () => {
                abortCalls += 1;
                resolve(false);
              },
              { once: true },
            );
          }),
        tryMountMse: async (slot) => ({
          ok: true,
          type: "mse",
          slot,
          engine: { destroy() {} },
        }),
        tryMountHls: async () => false,
      },
      resolveConnectionType: () => "frigate_go2rtc",
      getPendingMountDestroyers: () => pendingDestroyers,
      setPendingMountDestroyers: (next) => {
        pendingDestroyers = next;
      },
      isMountTokenCurrent: () => true,
      adoptMountedAttempt: (_slot, winner) => {
        currentWinnerEngine = winner?.engine || null;
      },
      waitForStreamStart: async () => true,
      isCurrentWinnerEngine: (engine) => currentWinnerEngine === engine,
      getPendingWebRtcTakeoverTimer: () => pendingTimer,
      setPendingWebRtcTakeoverTimer: (timer) => {
        pendingTimer = timer;
      },
      preferredWebRtcWaitMs: 1,
      deferredWebRtcMaxHoldMs: 500,
    });

    const mounted = await raceMounter.mountWithRace({
      slot: {
        appendChild() {},
        attachOrchestrator() {},
        clearOrchestrator() {},
      },
      entity: "camera.front",
      mountToken: 1,
    });
    assert.equal(mounted, true);
    assert.equal(pendingDestroyers.some(({ type }) => type === "webrtc"), true);

    pendingDestroyers = [];
    raceMounter.cancelPendingWebRtcAttempts();
    await delay(0);

    assert.equal(abortCalls, 1);
    assert.equal(pendingTimer, null);
  } finally {
    if (pendingTimer) clearTimeout(pendingTimer);
    globalThis.document = previousDocument;
  }
});

test("race mounter delays a replacement WebRTC probe after a cancelled switch", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ style: {}, remove() {} }),
  };
  let pendingDestroyers = [];
  let pendingTimer = null;
  let currentWinnerEngine = null;
  let webrtcCalls = 0;
  try {
    const raceMounter = createGo2RtcRaceMounter({
      mounter: {
        tryMountWebRtc: async (_slot, _startup, options) => {
          webrtcCalls += 1;
          return await new Promise((resolve) => {
            options.abortSignal.addEventListener(
              "abort",
              () => resolve(false),
              { once: true },
            );
          });
        },
        tryMountMse: async (slot) => ({
          ok: true,
          type: "mse",
          slot,
          engine: { destroy() {} },
        }),
        tryMountHls: async () => false,
      },
      resolveConnectionType: () => "frigate_go2rtc",
      getPendingMountDestroyers: () => pendingDestroyers,
      setPendingMountDestroyers: (next) => {
        pendingDestroyers = next;
      },
      isMountTokenCurrent: () => true,
      adoptMountedAttempt: (_slot, winner) => {
        currentWinnerEngine = winner?.engine || null;
      },
      waitForStreamStart: async () => true,
      isCurrentWinnerEngine: (engine) => currentWinnerEngine === engine,
      getPendingWebRtcTakeoverTimer: () => pendingTimer,
      setPendingWebRtcTakeoverTimer: (timer) => {
        pendingTimer = timer;
      },
      preferredWebRtcWaitMs: 1,
      deferredWebRtcMaxHoldMs: 60,
      webRtcRetryBackoffMs: 40,
    });
    const createSlot = () => ({
      appendChild() {},
      attachOrchestrator() {},
      clearOrchestrator() {},
    });

    const firstMounted = await raceMounter.mountWithRace({
      slot: createSlot(),
      entity: "camera.first",
      mountToken: 1,
    });
    assert.equal(firstMounted, true);
    assert.equal(webrtcCalls, 1);

    raceMounter.cancelPendingWebRtcAttempts();
    await delay(0);

    const secondMounted = await raceMounter.mountWithRace({
      slot: createSlot(),
      entity: "camera.second",
      mountToken: 2,
    });
    assert.equal(secondMounted, true);
    assert.equal(webrtcCalls, 1);

    await delay(55);
    assert.equal(webrtcCalls, 2);
    raceMounter.cancelPendingWebRtcAttempts();
    await delay(0);
  } finally {
    if (pendingTimer) clearTimeout(pendingTimer);
    globalThis.document = previousDocument;
  }
});

test("forced WebRTC bypasses retry backoff after a genuine timeout", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ style: {}, remove() {} }),
  };
  let pendingDestroyers = [];
  let pendingTimer = null;
  let currentWinnerEngine = null;
  let webrtcCalls = 0;
  let raceMounter = null;
  try {
    raceMounter = createGo2RtcRaceMounter({
      mounter: {
        tryMountWebRtc: async (slot, _startup, options) => {
          webrtcCalls += 1;
          if (webrtcCalls > 1) {
            return {
              ok: true,
              type: "webrtc",
              slot,
              engine: { destroy() {} },
            };
          }
          return await new Promise((resolve) => {
            options.abortSignal.addEventListener(
              "abort",
              () => resolve(false),
              { once: true },
            );
          });
        },
        tryMountMse: async (slot) => ({
          ok: true,
          type: "mse",
          slot,
          engine: { destroy() {} },
        }),
        tryMountHls: async () => false,
      },
      resolveConnectionType: () => "frigate_go2rtc",
      getPendingMountDestroyers: () => pendingDestroyers,
      setPendingMountDestroyers: (next) => {
        pendingDestroyers = next;
      },
      isMountTokenCurrent: () => true,
      adoptMountedAttempt: (_slot, winner) => {
        currentWinnerEngine = winner?.engine || null;
      },
      waitForStreamStart: async () => true,
      isCurrentWinnerEngine: (engine) => currentWinnerEngine === engine,
      getPendingWebRtcTakeoverTimer: () => pendingTimer,
      setPendingWebRtcTakeoverTimer: (timer) => {
        pendingTimer = timer;
      },
      preferredWebRtcWaitMs: 1,
      deferredWebRtcMaxHoldMs: 10,
      webRtcRetryBackoffMs: 80,
    });
    const createSlot = () => ({
      appendChild() {},
      attachOrchestrator() {},
      clearOrchestrator() {},
    });

    const initialMounted = await raceMounter.mountWithRace({
      slot: createSlot(),
      entity: "camera.front",
      mountToken: 1,
    });
    assert.equal(initialMounted, true);
    assert.equal(webrtcCalls, 1);
    await delay(20);

    const forcedMount = raceMounter.mountWithRace({
      slot: createSlot(),
      entity: "camera.front",
      forcedType: "webrtc",
      mountToken: 2,
    });
    await delay(5);
    assert.equal(webrtcCalls, 2);
    assert.equal(await forcedMount, true);
  } finally {
    raceMounter?.cancelPendingWebRtcAttempts?.();
    if (pendingTimer) clearTimeout(pendingTimer);
    globalThis.document = previousDocument;
  }
});

test("mobile fast path does not start fallbacks when webrtc renders before the hedge", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ style: {}, remove() {} }),
  };
  let webrtcCalls = 0;
  let mseCalls = 0;
  let hlsCalls = 0;
  let adoptedType = "";
  try {
    const raceMounter = createGo2RtcRaceMounter({
      mounter: {
        tryMountWebRtc: async (slot) => {
          webrtcCalls += 1;
          return {
            ok: true,
            type: "webrtc",
            slot,
            engine: { destroy() {} },
          };
        },
        tryMountMse: async () => {
          mseCalls += 1;
          return false;
        },
        tryMountHls: async () => {
          hlsCalls += 1;
          return false;
        },
      },
      isMobile: true,
      supportsNativeHlsPlayback: () => false,
      resolveConnectionType: () => "frigate_go2rtc",
      getPendingMountDestroyers: () => [],
      setPendingMountDestroyers: () => {},
      isMountTokenCurrent: () => true,
      adoptMountedAttempt: (_slot, winner) => {
        adoptedType = winner?.type || "";
      },
      waitForStreamStart: async () => true,
      isCurrentWinnerEngine: () => true,
      getPendingWebRtcTakeoverTimer: () => null,
      setPendingWebRtcTakeoverTimer: () => {},
      mobileFallbackHedgeMs: 20,
    });

    const result = await raceMounter.mountWithRace({
      slot: { appendChild() {} },
      entity: "camera.mobile",
      mountToken: 1,
    });
    await delay(50);

    assert.equal(result, true);
    assert.equal(adoptedType, "webrtc");
    assert.equal(webrtcCalls, 1);
    assert.equal(mseCalls, 0);
    assert.equal(hlsCalls, 0);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("mobile hedges unreachable webrtc to MSE before the webrtc timeout", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ style: {}, remove() {} }),
  };
  let pendingDestroyers = [];
  let mseCalls = 0;
  let hlsCalls = 0;
  let adoptedType = "";
  try {
    const raceMounter = createGo2RtcRaceMounter({
      mounter: {
        tryMountWebRtc: async (slot) => {
          await delay(80);
          return { ok: false, type: "webrtc", slot, engine: { destroy() {} } };
        },
        tryMountMse: async (slot) => {
          mseCalls += 1;
          return { ok: true, type: "mse", slot, engine: { destroy() {} } };
        },
        tryMountHls: async () => {
          hlsCalls += 1;
          return false;
        },
      },
      isMobile: true,
      supportsNativeHlsPlayback: () => false,
      resolveConnectionType: () => "frigate_go2rtc",
      getPendingMountDestroyers: () => pendingDestroyers,
      setPendingMountDestroyers: (next) => {
        pendingDestroyers = next;
      },
      isMountTokenCurrent: () => true,
      adoptMountedAttempt: (_slot, winner) => {
        adoptedType = winner?.type || "";
      },
      waitForStreamStart: async () => true,
      isCurrentWinnerEngine: () => true,
      getPendingWebRtcTakeoverTimer: () => null,
      setPendingWebRtcTakeoverTimer: () => {},
      preferredWebRtcWaitMs: 0,
      mobileFallbackHedgeMs: 20,
      mobileDeferredWebRtcMaxHoldMs: 120,
    });

    const startedAt = Date.now();
    const result = await raceMounter.mountWithRace({
      slot: { appendChild() {} },
      entity: "camera.mobile",
      mountToken: 1,
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(result, true);
    assert.equal(adoptedType, "mse");
    assert.equal(mseCalls, 1);
    assert.equal(hlsCalls, 0);
    assert.ok(elapsedMs < 70);
    await delay(90);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("mobile does not start HLS even when native HLS is available", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ style: {}, remove() {} }),
  };
  let pendingDestroyers = [];
  let mseCalls = 0;
  let hlsCalls = 0;
  let adoptedType = "";
  try {
    const raceMounter = createGo2RtcRaceMounter({
      mounter: {
        tryMountWebRtc: async (slot) => {
          await delay(80);
          return { ok: false, type: "webrtc", slot, engine: { destroy() {} } };
        },
        tryMountMse: async (slot) => {
          mseCalls += 1;
          return { ok: true, type: "mse", slot, engine: { destroy() {} } };
        },
        tryMountHls: async (slot) => {
          hlsCalls += 1;
          return { ok: true, type: "hls", slot, engine: { destroy() {} } };
        },
      },
      isMobile: true,
      supportsNativeHlsPlayback: () => true,
      resolveConnectionType: () => "frigate_go2rtc",
      getPendingMountDestroyers: () => pendingDestroyers,
      setPendingMountDestroyers: (next) => {
        pendingDestroyers = next;
      },
      isMountTokenCurrent: () => true,
      adoptMountedAttempt: (_slot, winner) => {
        adoptedType = winner?.type || "";
      },
      waitForStreamStart: async () => true,
      isCurrentWinnerEngine: () => true,
      getPendingWebRtcTakeoverTimer: () => null,
      setPendingWebRtcTakeoverTimer: () => {},
      preferredWebRtcWaitMs: 0,
      mobileFallbackHedgeMs: 20,
      mobileDeferredWebRtcMaxHoldMs: 120,
    });

    const result = await raceMounter.mountWithRace({
      slot: { appendChild() {} },
      entity: "camera.mobile",
      mountToken: 1,
    });

    assert.equal(result, true);
    assert.equal(adoptedType, "mse");
    assert.equal(mseCalls, 1);
    assert.equal(hlsCalls, 0);
    await delay(90);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("mobile starts a remembered fallback immediately and upgrades to healthy webrtc", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ style: {}, remove() {} }),
  };
  let pendingDestroyers = [];
  let pendingTimer = null;
  let currentWinnerEngine = null;
  let mseCalls = 0;
  let webrtcCalls = 0;
  const adoptedTypes = [];
  try {
    const raceMounter = createGo2RtcRaceMounter({
      mounter: {
        tryMountWebRtc: async (slot) => {
          webrtcCalls += 1;
          await delay(10);
          return {
            ok: true,
            type: "webrtc",
            slot,
            engine: { destroy() {} },
          };
        },
        tryMountMse: async (slot) => {
          mseCalls += 1;
          return { ok: true, type: "mse", slot, engine: { destroy() {} } };
        },
        tryMountHls: async () => false,
      },
      isMobile: true,
      supportsNativeHlsPlayback: () => false,
      resolveConnectionType: () => "frigate_go2rtc",
      getPendingMountDestroyers: () => pendingDestroyers,
      setPendingMountDestroyers: (next) => {
        pendingDestroyers = next;
      },
      isMountTokenCurrent: () => true,
      adoptMountedAttempt: (_slot, winner) => {
        adoptedTypes.push(winner?.type || "");
        currentWinnerEngine = winner?.engine || null;
      },
      waitForStreamStart: async () => true,
      isCurrentWinnerEngine: (engine) => currentWinnerEngine === engine,
      getPendingWebRtcTakeoverTimer: () => pendingTimer,
      setPendingWebRtcTakeoverTimer: (timer) => {
        pendingTimer = timer;
      },
      mobileFallbackHedgeMs: 20,
      mobileDeferredWebRtcMaxHoldMs: 100,
    });
    const slot = { appendChild() {} };

    await raceMounter.mountWithRace({
      slot,
      entity: "camera.mobile",
      forcedType: "mse",
      mountToken: 1,
    });
    adoptedTypes.length = 0;

    const result = await raceMounter.mountWithRace({
      slot,
      entity: "camera.mobile",
      mountToken: 2,
    });

    assert.equal(result, true);
    assert.equal(adoptedTypes[0], "mse");
    assert.equal(mseCalls, 2);
    assert.equal(webrtcCalls, 1);
    await delay(70);
    assert.deepEqual(adoptedTypes, ["mse", "webrtc"]);
  } finally {
    globalThis.document = previousDocument;
  }
});
