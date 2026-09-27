import assert from "node:assert/strict";
import test from "node:test";

import { ensureCardViewPageStyles } from "../src/features/card-view/page-style.loader.js";

test("Card View styles load once and install for each card host", async () => {
  const importedUrls = [];
  const installedHosts = [];
  const hostA = { id: "a" };
  const hostB = { id: "b" };
  const options = {
    baseUrl: "https://example.test/local/frigate-view-card.js",
    importModule: async (url) => {
      importedUrls.push(url);
      return {
        installCardViewPageStyles: (host) => {
          installedHosts.push(host);
          return { host };
        },
      };
    },
  };

  const first = await ensureCardViewPageStyles(hostA, options);
  const second = await ensureCardViewPageStyles(hostB, options);

  assert.equal(importedUrls.length, 1);
  const assetUrl = new URL(importedUrls[0]);
  assert.equal(
    assetUrl.pathname,
    "/local/frigate-view-card-card-view.js",
  );
  assert.equal(assetUrl.searchParams.get("fvc-version"), "1.1.8-dev.31");
  assert.deepEqual(installedHosts, [hostA, hostB]);
  assert.equal(first.host, hostA);
  assert.equal(second.host, hostB);
});
