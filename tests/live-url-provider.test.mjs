import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildGo2rtcWsPath,
  makeGo2rtcCacheKey,
} from "../src/integrations/frigate/url.js";
import {
  getFreshCachedValue,
  isM3u8Url,
  setCachedValue,
  toAbsoluteSignedUrl,
  toWebSocketUrl,
} from "../src/shared/media/url-utils.js";

test("makeGo2rtcCacheKey composes client and camera", () => {
  assert.equal(
    makeGo2rtcCacheKey({ clientId: "frigate", cam: "front" }),
    "frigate:front",
  );
});

test("buildGo2rtcWsPath URL-encodes client and camera", () => {
  const path = buildGo2rtcWsPath({ clientId: "frig ate", cam: "front/door" });
  assert.equal(path, "/api/frigate/frig%20ate/mse/api/ws?src=front%2Fdoor");
});

test("URL helpers convert signed and websocket URLs", () => {
  assert.equal(
    toAbsoluteSignedUrl({ signedPath: "/api/a", origin: "https://ha.local" }),
    "https://ha.local/api/a",
  );
  assert.equal(
    toAbsoluteSignedUrl({
      signedPath: "https://edge/a",
      origin: "https://ha.local",
    }),
    "https://edge/a",
  );
  assert.equal(toWebSocketUrl("https://ha.local/a"), "wss://ha.local/a");
});

test("isM3u8Url recognizes playlist URLs", () => {
  assert.equal(isM3u8Url("https://ha.local/a/master.m3u8"), true);
  assert.equal(isM3u8Url("https://ha.local/a/video.mp4"), false);
});

test("cache helpers read and write with expiry", () => {
  const map = new Map();
  setCachedValue({
    cacheMap: map,
    cacheKey: "k",
    url: "u",
    ttlMs: 1000,
    nowMs: 5000,
  });
  assert.equal(
    getFreshCachedValue({ cacheMap: map, cacheKey: "k", nowMs: 5500 }),
    "u",
  );
  assert.equal(
    getFreshCachedValue({ cacheMap: map, cacheKey: "k", nowMs: 7001 }),
    undefined,
  );
});
