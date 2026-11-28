import { test } from "node:test";
import assert from "node:assert/strict";

import {
  openSignedFrigateRequest,
  resolveUnsignedFrigatePath,
  signHomeAssistantPath,
} from "../src/integrations/frigate/bootstrap.js";

test("signHomeAssistantPath requests an HA auth signature", async () => {
  const calls = [];
  const hass = {
    callWS: async (msg) => {
      calls.push(msg);
      return { path: `${msg.path}&authSig=abc` };
    },
  };

  const signed = await signHomeAssistantPath({
    hass,
    path: "/api/frigate/x?src=front",
  });

  assert.equal(signed, "/api/frigate/x?src=front&authSig=abc");
  assert.deepEqual(calls, [
    {
      type: "auth/sign_path",
      path: "/api/frigate/x?src=front",
      expires: 3600,
    },
  ]);
});

test("Frigate requests remove inherited signatures before signing", async () => {
  const calls = [];
  const xhr = {
    open: (...args) => calls.push(args),
  };

  assert.equal(
    resolveUnsignedFrigatePath({
      url: "https://ha.example/api/frigate/frigate/vod/front/index.m3u8?authSig=master&_HLS_msn=4",
      origin: "https://ha.example",
    }),
    "/api/frigate/frigate/vod/front/index.m3u8?_HLS_msn=4",
  );

  const opened = await openSignedFrigateRequest({
    xhr,
    url: "https://ha.example/api/frigate/frigate/vod/front/index.m3u8?authSig=master",
    origin: "https://ha.example",
    signPath: async (path) => `${path}?authSig=exact`,
  });

  assert.equal(opened, true);
  assert.deepEqual(calls, [
    [
      "GET",
      "https://ha.example/api/frigate/frigate/vod/front/index.m3u8?authSig=exact",
      true,
    ],
  ]);
});

test("Frigate request signing ignores non-proxy and cross-origin URLs", async () => {
  let opened = false;
  const xhr = {
    open: () => {
      opened = true;
    },
  };
  const options = {
    xhr,
    origin: "https://ha.example",
    signPath: async (path) => path,
  };

  assert.equal(
    await openSignedFrigateRequest({
      ...options,
      url: "https://other.example/api/frigate/frigate/vod/front/master.m3u8",
    }),
    false,
  );
  assert.equal(
    await openSignedFrigateRequest({
      ...options,
      url: "https://ha.example/local/video.m3u8",
    }),
    false,
  );
  assert.equal(opened, false);
});
