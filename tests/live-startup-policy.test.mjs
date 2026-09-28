import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GO2RTC_STARTUP_MODES,
  buildHaDirectMountPlan,
  resolveHaDirectMountUnavailableState,
  resolveHaDirectFailedState,
  resolveHaDirectReadyState,
  resolveHaDirectStartup,
  resolveGo2RtcStartupMode,
  resolveHlsStartup,
  resolveMseStartup,
  resolveWebRtcStartup,
} from "../src/features/live/startup-policy.js";

test("go2rtc uses native HLS only for the Catalyst-shaped capability profile", () => {
  assert.equal(
    resolveGo2RtcStartupMode({
      isMacOS: true,
      supportsNativeHls: true,
      hasWebRtc: false,
      hasMediaSource: false,
    }),
    GO2RTC_STARTUP_MODES.nativeHlsOnly,
  );
});

test("go2rtc keeps the normal race outside the Catalyst-shaped capability profile", () => {
  const cases = [
    { isMacOS: false, supportsNativeHls: true },
    { isMacOS: true, supportsNativeHls: false },
    { isMacOS: true, supportsNativeHls: true, hasWebRtc: true },
    { isMacOS: true, supportsNativeHls: true, hasMediaSource: true },
  ];

  for (const capabilities of cases) {
    assert.equal(
      resolveGo2RtcStartupMode(capabilities),
      GO2RTC_STARTUP_MODES.race,
    );
  }
});

test("resolveHaDirectStartup applies defaults and keeps stream type", () => {
  const policy = resolveHaDirectStartup({ streamType: "webrtc" });

  assert.equal(policy.waitMs, 8000);
  assert.equal(policy.minCurrentTime, 0.05);
  assert.equal(policy.minDecodedFrames, 1);
  assert.equal(policy.requireReadyState, 0);
  assert.equal(policy.strict, false);
  assert.equal(policy.requirePresentedFrame, true);
  assert.equal(policy.streamType, "webrtc");
});

test("buildHaDirectMountPlan resolves stream type and wait options from startup policy", () => {
  assert.deepEqual(
    buildHaDirectMountPlan({
      startup: { streamType: "hls", strict: true, waitMs: 12 },
      preferredStreamType: "webrtc",
    }),
    {
      streamType: "hls",
      waitOptions: {
        minCurrentTime: 0.05,
        minDecodedFrames: 1,
        requireReadyState: 0,
        strict: true,
        requirePresentedFrame: true,
      },
      waitMs: 500,
    },
  );
  assert.deepEqual(
    buildHaDirectMountPlan({
      startup: {},
      preferredStreamType: "mse",
    }),
    {
      streamType: "mse",
      waitOptions: {
        minCurrentTime: 0.05,
        minDecodedFrames: 1,
        requireReadyState: 0,
        strict: false,
        requirePresentedFrame: true,
      },
      waitMs: 8000,
    },
  );
});

test("resolveMseStartup enforces wait floor and strict default", () => {
  const policy = resolveMseStartup({ waitMs: 10, strict: false });

  assert.equal(policy.waitMs, 500);
  assert.equal(policy.minCurrentTime, 0.2);
  assert.equal(policy.minDecodedFrames, 2);
  assert.equal(policy.requireReadyState, 3);
  assert.equal(policy.strict, false);
});

test("resolveWebRtcStartup applies browser-agnostic defaults", () => {
  const policy = resolveWebRtcStartup({});
  assert.equal(policy.minCurrentTime, 0.05);
  assert.equal(policy.minDecodedFrames, 1);
  assert.equal(policy.requireReadyState, 0);
  assert.equal(policy.strict, true);
});

test("resolveHlsStartup applies default wait and floor", () => {
  assert.equal(resolveHlsStartup({}).waitMs, 5000);
  assert.equal(resolveHlsStartup({ waitMs: 1 }).waitMs, 500);
});

test("resolveHaDirectMountUnavailableState clears loading and fallback", () => {
  assert.deepEqual(resolveHaDirectMountUnavailableState(), {
    loading: false,
    fallbackVisible: false,
    refreshFallbackImage: false,
  });
});

test("resolveHaDirectFailedState reveals the snapshot fallback", () => {
  assert.deepEqual(resolveHaDirectFailedState(), {
    loading: false,
    fallbackVisible: true,
    refreshFallbackImage: true,
  });
});

test("resolveHaDirectReadyState applies only for the current engine after a successful wait", () => {
  assert.deepEqual(
    resolveHaDirectReadyState({
      rotateOverlayActive: true,
      isCurrentEngine: true,
      waitSucceeded: true,
    }),
    {
      shouldApply: true,
      loading: false,
      fallbackVisible: false,
      refreshFallbackImage: false,
      enableNativeControls: true,
    },
  );
  assert.deepEqual(
    resolveHaDirectReadyState({
      rotateOverlayActive: true,
      isCurrentEngine: false,
      waitSucceeded: true,
    }),
    {
      shouldApply: false,
      loading: false,
      fallbackVisible: false,
      refreshFallbackImage: false,
      enableNativeControls: false,
    },
  );
});
