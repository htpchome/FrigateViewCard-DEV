import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveHaDirectMountUnavailableState,
  resolveHaDirectFailedState,
  resolveHaDirectReadyState,
  resolveHlsStartup,
  resolveMseStartup,
  resolveWebRtcStartup,
} from "../src/features/live/startup-policy.js";

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
