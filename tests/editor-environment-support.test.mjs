import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compareVersions,
  isFrigateIntegrationLoaded,
  resolveFrigateIntegrationStatus,
  resolveHomeAssistantVersionNotice,
  resolveHomeAssistantVersionStatus,
} from "../src/editor/environment-support.js";

test("editor environment support compares numeric version components", () => {
  assert.equal(compareVersions("v5.15.6", "5.15.6"), 0);
  assert.equal(compareVersions("2026.8.10", "2026.9.0"), -1);
  assert.equal(compareVersions("2026.10.0", "2026.9.0"), 1);
  assert.equal(compareVersions("0.17.2-abc123", "0.17.2"), 0);
  assert.equal(compareVersions("unknown", "5.15.6"), null);
});

test("editor environment support only warns for old Home Assistant versions", () => {
  assert.equal(
    resolveHomeAssistantVersionNotice({
      currentVersion: "2026.8.4",
      recommendedVersion: "2026.9.0",
    }),
    "Home Assistant 2026.8.4 is below the recommended 2026.9.0.",
  );
  assert.equal(
    resolveHomeAssistantVersionNotice({
      currentVersion: "2026.9.0",
      recommendedVersion: "2026.9.0",
    }),
    "",
  );
  assert.equal(
    resolveHomeAssistantVersionNotice({
      currentVersion: "",
      recommendedVersion: "2026.9.0",
    }),
    "",
  );
});

test("editor environment support always describes a detected Home Assistant version", () => {
  assert.deepEqual(
    resolveHomeAssistantVersionStatus({
      currentVersion: "2026.9.0",
      recommendedVersion: "2026.9.0",
    }),
    {
      visible: true,
      status: "current",
      label: "Home Assistant 2026.9.0",
    },
  );
  assert.equal(
    resolveHomeAssistantVersionStatus({
      currentVersion: "2026.8.4",
      recommendedVersion: "2026.9.0",
    }).status,
    "warning",
  );
});

test("editor environment support reports Frigate integration presence", () => {
  assert.deepEqual(
    resolveFrigateIntegrationStatus({ installed: true }),
    {
      visible: true,
      status: "current",
      label: "Frigate integration is installed.",
    },
  );
  assert.deepEqual(
    resolveFrigateIntegrationStatus({ installed: false }),
    {
      visible: true,
      status: "error",
      label: "Frigate integration is not installed in Home Assistant.",
    },
  );
  assert.deepEqual(resolveFrigateIntegrationStatus(), {
    visible: false,
    status: "unavailable",
    label: "",
  });
});

test("editor environment support detects whether Frigate is loaded", () => {
  assert.equal(
    isFrigateIntegrationLoaded({ config: { components: ["frigate"] } }),
    true,
  );
  assert.equal(
    isFrigateIntegrationLoaded({ config: { components: new Set(["frigate"]) } }),
    true,
  );
  assert.equal(
    isFrigateIntegrationLoaded({ config: { components: ["stream"] } }),
    false,
  );
  assert.equal(isFrigateIntegrationLoaded({ config: {} }), null);
});
