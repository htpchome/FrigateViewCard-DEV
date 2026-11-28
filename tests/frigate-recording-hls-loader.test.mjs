import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createSignedFrigateHlsLoader,
  resolveSignedFrigateHlsUrl,
  resolveUnsignedFrigateHlsPath,
} from "../src/integrations/frigate/recording-hls-loader.js";

test("Frigate recording HLS removes inherited signatures before signing", () => {
  assert.equal(
    resolveUnsignedFrigateHlsPath(
      "https://ha.example/api/frigate/frigate/vod/front/start/1/end/2/index-v1-a1.m3u8?authSig=master-token&_HLS_msn=4",
      "https://ha.example",
    ),
    "/api/frigate/frigate/vod/front/start/1/end/2/index-v1-a1.m3u8?_HLS_msn=4",
  );
  assert.equal(
    resolveUnsignedFrigateHlsPath(
      "https://other.example/api/frigate/frigate/vod/front/master.m3u8?authSig=token",
      "https://ha.example",
    ),
    "",
  );
  assert.equal(
    resolveSignedFrigateHlsUrl(
      "/api/frigate/frigate/vod/front/segment/4.m4s?authSig=segment-token",
      "https://ha.example/api/frigate/frigate/vod/front/segment/4.m4s?authSig=playlist-token",
      "https://ha.example",
    ),
    "https://ha.example/api/frigate/frigate/vod/front/segment/4.m4s?authSig=segment-token",
  );
});

test("Frigate recording HLS signs each child request and caches its exact path", async () => {
  const loads = [];
  const signs = [];
  class BaseLoader {
    load(context, config, callbacks) {
      loads.push({ context, config, callbacks });
    }
    abort() {}
    destroy() {}
  }
  const SignedLoader = createSignedFrigateHlsLoader(BaseLoader, {
    origin: "https://ha.example",
    signPath: async (path) => {
      signs.push(path);
      return `${path}${path.includes("?") ? "&" : "?"}authSig=exact-token`;
    },
  });
  const callbacks = { onSuccess() {}, onError() {} };
  const context = {
    url: "https://ha.example/api/frigate/frigate/vod/front/segment/4.m4s?authSig=playlist-token",
  };

  new SignedLoader({}).load(context, { timeout: 1000 }, callbacks);
  await Promise.resolve();
  new SignedLoader({}).load(context, { timeout: 1000 }, callbacks);
  await Promise.resolve();

  assert.deepEqual(signs, [
    "/api/frigate/frigate/vod/front/segment/4.m4s",
  ]);
  assert.equal(loads.length, 2);
  assert.equal(
    loads[0].context.url,
    "https://ha.example/api/frigate/frigate/vod/front/segment/4.m4s?authSig=exact-token",
  );
  assert.equal(loads[0].callbacks, callbacks);
});

test("aborted Frigate recording HLS signing never starts a stale request", async () => {
  let resolveSign;
  let loadCount = 0;
  class BaseLoader {
    load() {
      loadCount += 1;
    }
    abort() {}
    destroy() {}
  }
  const SignedLoader = createSignedFrigateHlsLoader(BaseLoader, {
    origin: "https://ha.example",
    signPath: () => new Promise((resolve) => {
      resolveSign = resolve;
    }),
  });
  const loader = new SignedLoader({});
  loader.load(
    {
      url: "https://ha.example/api/frigate/frigate/vod/front/master.m3u8",
    },
    {},
    {},
  );
  loader.abort();
  resolveSign("/api/frigate/frigate/vod/front/master.m3u8?authSig=late");
  await Promise.resolve();

  assert.equal(loadCount, 0);
});
