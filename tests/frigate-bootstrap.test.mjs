import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildGo2RtcHlsProbeResult,
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

test("buildGo2RtcHlsProbeResult returns cacheable URL when nested signing is not needed", async () => {
  const result = await buildGo2RtcHlsProbeResult({
    rawPath: "/api/frigate/a/go2rtc/api/stream.m3u8?src=front&mp4",
    signedPath: "/api/frigate/a/go2rtc/api/stream.m3u8?src=front&mp4",
    manifestUrl: "https://ha.local/stream.m3u8",
  });

  assert.deepEqual(result, {
    url: "https://ha.local/stream.m3u8",
    cacheable: true,
    destroy: null,
  });
});

test("buildGo2RtcHlsProbeResult rejects native HLS requiring signed child requests", async () => {
  const result = await buildGo2RtcHlsProbeResult({
    rawPath: "/api/frigate/a/go2rtc/api/stream.m3u8?src=front&mp4",
    signedPath:
      "/api/frigate/a/go2rtc/api/stream.m3u8?src=front&mp4&authSig=abc",
    manifestUrl: "https://ha.local/stream.m3u8?authSig=abc",
  });

  assert.equal(result, null);
});
