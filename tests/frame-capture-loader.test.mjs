import assert from "node:assert/strict";
import test from "node:test";
import { VERSION } from "../src/constants.js";
import { ensureDisplayedFrameCaptureModule } from "../src/card/frame-capture.loader.js";

test("displayed-frame capture loads from its versioned companion asset", async () => {
  const imports = [];
  const module = { createDisplayedFrameCaptureController: () => ({}) };
  const loaded = await ensureDisplayedFrameCaptureModule({
    baseUrl: "https://example.test/local/frigate-view-card.js",
    importModule: async (url) => {
      imports.push(url);
      return module;
    },
  });

  assert.equal(loaded, module);
  assert.deepEqual(imports, [
    `https://example.test/local/frigate-view-card-frame-capture.js?fvc-version=${VERSION}`,
  ]);
});
