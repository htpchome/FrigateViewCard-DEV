import assert from "node:assert/strict";
import { test } from "node:test";

import { VERSION } from "../src/constants.js";
import {
  ensureEditorPreviewDraftModule,
  LazyEditorPreviewDraftController,
} from "../src/features/editor-preview/draft.loader.js";

test("editor-preview draft loader resolves the versioned companion asset", async () => {
  let requestedUrl = "";
  const module = await ensureEditorPreviewDraftModule({
    baseUrl: "https://example.test/local/frigate-view-card.js",
    importModule: async (url) => {
      requestedUrl = url;
      return { loaded: true };
    },
  });

  assert.equal(module.loaded, true);
  const assetUrl = new URL(requestedUrl);
  assert.equal(
    assetUrl.pathname,
    "/local/frigate-view-card-editor-preview-draft.js",
  );
  assert.equal(assetUrl.searchParams.get("fvc-version"), VERSION);
});

test("editor-preview draft companion stays dormant without a draft", async () => {
  let loads = 0;
  const controller = new LazyEditorPreviewDraftController({}, {
    loadModule: async () => {
      loads += 1;
      return {};
    },
  });

  await Promise.resolve();
  assert.equal(loads, 0);
  controller.dispose();
});

test("first draft loads once and later drafts use the loaded controller", async () => {
  const host = {};
  const calls = [];
  let loads = 0;
  class EditorPreviewDraftController {
    constructor(receivedHost, options) {
      calls.push(["construct", receivedHost, options.resolveLandingPage("wide-view")]);
    }

    applyConfigDraft(options) {
      calls.push(["apply", options.id]);
      return options.id;
    }
  }
  const controller = new LazyEditorPreviewDraftController(host, {
    loadModule: async () => {
      loads += 1;
      return { EditorPreviewDraftController };
    },
    resolveLandingPage: () => "single-view",
  });

  assert.equal(await controller.applyConfigDraft({ id: "first" }), "first");
  assert.equal(controller.applyConfigDraft({ id: "second" }), "second");
  assert.equal(loads, 1);
  assert.deepEqual(calls, [
    ["construct", host, "single-view"],
    ["apply", "first"],
    ["apply", "second"],
  ]);
});

test("drafts received while loading replay in order", async () => {
  let finishLoad;
  const applied = [];
  class EditorPreviewDraftController {
    applyConfigDraft({ id }) {
      applied.push(id);
      return id;
    }
  }
  const controller = new LazyEditorPreviewDraftController({}, {
    loadModule: () =>
      new Promise((resolve) => {
        finishLoad = () => resolve({ EditorPreviewDraftController });
      }),
  });

  const first = controller.applyConfigDraft({ id: "first" });
  const second = controller.applyConfigDraft({ id: "second" });
  await Promise.resolve();
  await Promise.resolve();
  finishLoad();

  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
  assert.deepEqual(applied, ["first", "second"]);
});

test("dispose cancels a draft queued before the companion starts loading", async () => {
  let loads = 0;
  let applies = 0;
  class EditorPreviewDraftController {
    applyConfigDraft() {
      applies += 1;
    }
  }
  const controller = new LazyEditorPreviewDraftController({}, {
    loadModule: async () => {
      loads += 1;
      return { EditorPreviewDraftController };
    },
  });

  const pending = controller.applyConfigDraft();
  controller.dispose();

  assert.equal(await pending, null);
  assert.equal(loads, 0);
  assert.equal(applies, 0);
});
