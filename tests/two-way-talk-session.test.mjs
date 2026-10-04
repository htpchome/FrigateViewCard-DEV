import { test } from "node:test";
import assert from "node:assert/strict";

import {
  startGo2RtcTwoWayTalkSession,
  startHaDirectTwoWayTalkSession,
} from "../src/features/two-way-talk/session.js";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function withFakeMicrophone(run) {
  const previousNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const requests = [];
  let stopCalls = 0;
  const track = {
    enabled: true,
    stop() {
      stopCalls += 1;
    },
  };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia(options) {
          requests.push(options);
          return stream;
        },
      },
    },
  });

  try {
    return await run({ requests, stream, track, getStopCalls: () => stopCalls });
  } finally {
    if (previousNavigator) {
      Object.defineProperty(globalThis, "navigator", previousNavigator);
    } else {
      delete globalThis.navigator;
    }
  }
}

test("go2rtc two-way talk captures default browser audio and owns its mounted engine", async () => {
  await withFakeMicrophone(async ({ requests, stream, track, getStopCalls }) => {
    let destroyCalls = 0;
    let endedCalls = 0;
    let mountedOptions = null;
    const engine = {
      destroy() {
        destroyCalls += 1;
      },
    };

    const session = await startGo2RtcTwoWayTalkSession({
      mountMicrophoneStream: async (options) => {
        mountedOptions = options;
        return engine;
      },
      onEnded: () => {
        endedCalls += 1;
      },
    });

    assert.deepEqual(requests, [{ audio: true, video: false }]);
    assert.equal(mountedOptions.localStream, stream);
    assert.equal(typeof mountedOptions.onEnded, "function");
    assert.equal(session.type, "frigate_go2rtc");
    assert.equal(session.restoreLiveOnStop, false);
    assert.equal(session.engine, engine);
    assert.equal(session.microphoneMuted, false);

    assert.equal(session.setMicrophoneMuted(true), true);
    assert.equal(session.microphoneMuted, true);
    assert.equal(track.enabled, false);
    assert.equal(destroyCalls, 0);

    assert.equal(session.setMicrophoneMuted(false), false);
    assert.equal(session.microphoneMuted, false);
    assert.equal(track.enabled, true);
    assert.equal(destroyCalls, 0);

    await session.stop();
    await session.stop();

    assert.equal(destroyCalls, 1);
    assert.equal(getStopCalls(), 1);
    assert.equal(endedCalls, 1);
  });
});

test("ha-direct two-way talk remains an explicit mounted transport session", async () => {
  await withFakeMicrophone(async ({ stream }) => {
    const engine = { destroy() {} };
    const session = await startHaDirectTwoWayTalkSession({
      mountMicrophoneStream: async ({ localStream }) => {
        assert.equal(localStream, stream);
        return engine;
      },
    });

    assert.equal(session.type, "ha_direct");
    assert.equal(session.restoreLiveOnStop, false);
    assert.equal(session.engine, engine);
  });
});

test("failed two-way talk mounts release microphone capture", async () => {
  await withFakeMicrophone(async ({ getStopCalls }) => {
    await assert.rejects(
      startGo2RtcTwoWayTalkSession({
        mountMicrophoneStream: async () => null,
      }),
      /Unable to establish frigate_go2rtc two-way talk/,
    );
    assert.equal(getStopCalls(), 1);
  });
});

test("canceling two-way talk startup destroys the mounted engine and releases the microphone", async () => {
  await withFakeMicrophone(async ({ getStopCalls }) => {
    const abortController = new AbortController();
    let destroyCalls = 0;

    await assert.rejects(
      startGo2RtcTwoWayTalkSession({
        abortSignal: abortController.signal,
        mountMicrophoneStream: async ({ abortSignal }) => {
          assert.equal(abortSignal, abortController.signal);
          abortController.abort();
          return {
            destroy() {
              destroyCalls += 1;
            },
          };
        },
      }),
      (error) => error?.name === "AbortError",
    );

    assert.equal(destroyCalls, 1);
    assert.equal(getStopCalls(), 1);
  });
});

for (const first of ["microphone", "configuration"]) {
  test(`HA talk overlaps preparation, with ${first} completing first`, async () => {
    await withFakeMicrophone(async ({ stream, getStopCalls }) => {
      const microphone = deferred();
      const configuration = deferred();
      const started = [];
      const prepared = { entity: "camera.front" };
      let mounts = 0;
      navigator.mediaDevices.getUserMedia = () => {
        started.push("microphone");
        return microphone.promise;
      };
      const pending = startHaDirectTwoWayTalkSession({
        prepareConnection: () => {
          started.push("configuration");
          return configuration.promise;
        },
        mountMicrophoneStream: async ({ localStream, preparedConnection }) => {
          mounts += 1;
          assert.equal(localStream, stream);
          assert.equal(preparedConnection, prepared);
          return { destroy() {} };
        },
      });
      assert.deepEqual(started, ["microphone", "configuration"]);
      if (first === "microphone") microphone.resolve(stream);
      else configuration.resolve(prepared);
      await flush();
      assert.equal(mounts, 0);
      microphone.resolve(stream);
      configuration.resolve(prepared);
      const session = await pending;
      assert.equal(mounts, 1);
      assert.equal(getStopCalls(), 0);
      await session.stop();
      assert.equal(getStopCalls(), 1);
    });
  });
}

for (const reason of ["cancel", "config-failure", "config-throws"]) {
  for (const micReady of [false, true]) {
    test(`HA talk releases ${micReady ? "acquired" : "late"} microphone after ${reason}`, async () => {
      await withFakeMicrophone(async ({ stream, getStopCalls }) => {
        const microphone = deferred();
        const configuration = deferred();
        const abortController = new AbortController();
        let mounts = 0;
        navigator.mediaDevices.getUserMedia = () => microphone.promise;
        if (micReady) microphone.resolve(stream);
        const pending = startHaDirectTwoWayTalkSession({
          abortSignal: abortController.signal,
          prepareConnection: () => {
            if (reason === "config-throws") throw new Error("configuration failed");
            return configuration.promise;
          },
          mountMicrophoneStream: async () => { mounts += 1; return {}; },
        });
        const rejection = assert.rejects(pending, reason === "cancel" ? /canceled/ : /configuration failed/);
        await flush();
        if (reason === "cancel") abortController.abort();
        else if (reason === "config-failure") configuration.reject(new Error("configuration failed"));
        await rejection;
        assert.equal(getStopCalls(), micReady ? 1 : 0);
        microphone.resolve(stream);
        if (reason === "cancel") configuration.reject(new Error("late configuration failure"));
        await flush();
        assert.equal(mounts, 0);
        assert.equal(getStopCalls(), 1);
      });
    });
  }
}

test("HA microphone denial does not negotiate when the configuration arrives later", async () => {
  await withFakeMicrophone(async () => {
    const configuration = deferred();
    let mounts = 0;
    navigator.mediaDevices.getUserMedia = async () => { throw new Error("permission denied"); };
    await assert.rejects(startHaDirectTwoWayTalkSession({
      prepareConnection: () => configuration.promise,
      mountMicrophoneStream: async () => { mounts += 1; return {}; },
    }), /permission denied/);
    configuration.resolve({});
    await flush();
    assert.equal(mounts, 0);
  });
});

test("an already cancelled HA talk attempt requests neither microphone nor configuration", async () => {
  await withFakeMicrophone(async ({ requests }) => {
    const abortController = new AbortController();
    abortController.abort();
    let preparations = 0;
    await assert.rejects(startHaDirectTwoWayTalkSession({
      abortSignal: abortController.signal,
      prepareConnection: () => { preparations += 1; },
      mountMicrophoneStream: async () => ({}),
    }), /canceled/);
    assert.equal(preparations, 0);
    assert.equal(requests.length, 0);
  });
});
