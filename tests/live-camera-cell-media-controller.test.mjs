import assert from "node:assert/strict";
import test from "node:test";

import { CameraCellMediaController } from "../src/features/live/camera-cell-media.ctrl.js";

const createImagePair = ({ decode } = {}) => {
  let replacement = null;
  let replacedWith = null;
  const current = {
    isConnected: true,
    src: "https://ha.local/current.jpg",
    dataset: {},
    cloneNode: () => {
      replacement = {
        src: current.src,
        dataset: { ...current.dataset },
        loading: "lazy",
        decoding: "async",
        fetchPriority: "auto",
        complete: false,
        naturalWidth: 0,
        setAttribute() {},
        removeAttribute(name) {
          if (name === "src") this.src = "";
        },
        decode,
      };
      return replacement;
    },
    replaceWith: (next) => {
      replacedWith = next;
      current.isConnected = false;
    },
  };
  return {
    current,
    replacement: () => replacement,
    replacedWith: () => replacedWith,
  };
};

test("snapshot refresh keeps the current image until its replacement decodes", async () => {
  let finishDecode;
  const images = createImagePair({
    decode: async () =>
      await new Promise((resolve) => {
        finishDecode = resolve;
      }),
  });
  const controller = new CameraCellMediaController({});

  const refresh = controller._refreshSnapshotImageElement(
    images.current,
    "https://ha.local/next.jpg",
    123,
  );
  await Promise.resolve();

  assert.equal(images.current.src, "https://ha.local/current.jpg");
  assert.equal(images.replacedWith(), null);
  assert.equal(
    images.replacement().src,
    "https://ha.local/next.jpg?fvc_snapshot=123",
  );

  finishDecode();
  await refresh;

  assert.equal(images.replacedWith(), images.replacement());
  assert.equal(images.replacement().loading, "eager");
  assert.equal(images.replacement().fetchPriority, "high");
});

test("signed snapshot refresh swaps a decoded blob and then releases the old blob", async () => {
  const images = createImagePair({ decode: async () => {} });
  images.current.dataset.fvcBlobUrl = "blob:old";
  const controller = new CameraCellMediaController({});
  const originalFetch = globalThis.fetch;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  const revoked = [];
  let request = null;

  globalThis.fetch = async (...args) => {
    request = args;
    return {
      ok: true,
      blob: async () => ({ type: "image/jpeg" }),
    };
  };
  URL.createObjectURL = () => "blob:next";
  URL.revokeObjectURL = (url) => revoked.push(url);

  try {
    await controller._refreshSnapshotImageElement(
      images.current,
      "https://ha.local/api/camera_proxy/camera.front?authSig=abc",
      456,
    );
  } finally {
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  }

  assert.deepEqual(request, [
    "https://ha.local/api/camera_proxy/camera.front?authSig=abc",
    { cache: "no-store", credentials: "same-origin" },
  ]);
  assert.equal(images.current.src, "https://ha.local/current.jpg");
  assert.equal(images.replacement().src, "blob:next");
  assert.equal(images.replacement().dataset.fvcBlobUrl, "blob:next");
  assert.equal(images.replacedWith(), images.replacement());
  assert.deepEqual(revoked, ["blob:old"]);
});
