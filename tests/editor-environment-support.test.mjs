import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compareVersions,
  fetchFrigateIntegrationVersion,
  isFrigateIntegrationLoaded,
  resolveFrigateIntegrationVersionNotice,
  resolveHomeAssistantVersionNotice,
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

test("editor environment support warns for a missing or old Frigate integration", () => {
  assert.equal(
    resolveFrigateIntegrationVersionNotice({ installed: false }),
    "Frigate integration is not installed in Home Assistant.",
  );
  assert.equal(
    resolveFrigateIntegrationVersionNotice({
      installed: true,
      currentVersion: "5.14.0",
      recommendedVersion: "5.15.6",
    }),
    "Frigate integration 5.14.0 is below the recommended 5.15.6.",
  );
  assert.equal(
    resolveFrigateIntegrationVersionNotice({
      installed: true,
      currentVersion: "5.15.6",
      recommendedVersion: "5.15.6",
    }),
    "",
  );
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

test("editor environment support requests the Frigate integration manifest", async () => {
  const requests = [];
  const version = await fetchFrigateIntegrationVersion({
    callWS: async (request) => {
      requests.push(request);
      return { domain: "frigate", version: "5.15.6" };
    },
  });

  assert.equal(version, "5.15.6");
  assert.deepEqual(requests, [
    {
      type: "config/integration/get_manifest",
      integration: "frigate",
    },
  ]);
});

test("editor environment support rejects an integration manifest without a version", async () => {
  await assert.rejects(
    fetchFrigateIntegrationVersion({ callWS: async () => ({}) }),
    /version is unavailable/,
  );
});
