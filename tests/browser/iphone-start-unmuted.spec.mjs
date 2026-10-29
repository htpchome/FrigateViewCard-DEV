import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

let baseUrl;
let server;

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/") {
      response.setHeader("content-type", "text/html");
      response.end("<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>");
      return;
    }
    const relative = normalize(pathname).replace(/^[/\\]+/, "");
    if (relative.startsWith("..")) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(join(process.cwd(), relative));
      response.setHeader(
        "content-type",
        extname(relative) === ".json" ? "application/json" : "text/javascript",
      );
      response.end(body);
    } catch (_) {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("iPhone WebKit gives the connected go2rtc candidate the first unmute/play action", async ({ page }) => {
  await page.goto(baseUrl);
  const state = await page.evaluate(async () => {
    const { LiveAudioController } = await import("/src/features/live/audio.ctrl.js");
    const video = document.createElement("video");
    Object.defineProperty(video, "readyState", { configurable: true, value: 2 });
    const playStates = [];
    video.play = () => {
      playStates.push(video.muted);
      return Promise.resolve();
    };
    video.muted = true;
    document.body.append(video);
    const engine = { type: "frigate_go2rtc", video };
    const host = {
      _activeCam: { entity: "camera.front", start_unmuted: true },
      _engine: null,
      _streamMuted: true,
      _findVideoDeep: () => video,
      _renderMuteButton() {},
    };
    const controller = new LiveAudioController(host);
    controller.prepareCameraStart(host._activeCam);
    const prepared = controller.prepareSelectedPlayback(video, {
      entity: "camera.front",
    });
    host._engine = engine;
    const applied = controller.applyCameraStartPreference();
    await Promise.resolve();
    return {
      applied,
      prepared,
      muted: video.muted,
      streamMuted: host._streamMuted,
      playStates,
      touchFallback: Boolean(controller._onDeferredStartUnmuteInteraction),
    };
  });
  expect(state).toEqual({
    applied: true,
    prepared: true,
    muted: false,
    streamMuted: false,
    playStates: [false],
    touchFallback: false,
  });
});

test("iPhone WebKit applies the same selected action to HA Direct", async ({ page }) => {
  await page.goto(baseUrl);
  const state = await page.evaluate(async () => {
    const { LiveAudioController } = await import("/src/features/live/audio.ctrl.js");
    const video = document.createElement("video");
    Object.defineProperty(video, "readyState", { configurable: true, value: 2 });
    const playStates = [];
    video.play = () => {
      playStates.push(video.muted);
      return Promise.resolve();
    };
    video.muted = true;
    const player = document.createElement("ha-web-rtc-player");
    player.muted = true;
    player.attachShadow({ mode: "open" }).append(video);
    const provider = document.createElement("div");
    provider.haDirectProvider = true;
    provider.muted = false;
    provider.attachShadow({ mode: "open" }).append(player);
    provider.fvcSetOutputMuted = (muted) => {
      video.muted = muted;
      return video;
    };
    const host = {
      _activeCam: { entity: "camera.front", start_unmuted: true },
      _engine: provider,
      _streamMuted: true,
      _findVideoDeep: () => video,
      _renderMuteButton() {},
    };
    const controller = new LiveAudioController(host);
    controller.prepareCameraStart(host._activeCam);
    const applied = controller.applyCameraStartPreference();
    await Promise.resolve();
    return {
      applied,
      muted: video.muted,
      playerMuted: player.muted,
      providerMuted: provider.muted,
      streamMuted: host._streamMuted,
      playStates,
    };
  });
  expect(state).toEqual({
    applied: true,
    muted: false,
    playerMuted: false,
    providerMuted: false,
    streamMuted: false,
    playStates: [false],
  });
});

test("iPhone WebKit repeats the selected action when go2rtc media loads", async ({ page }) => {
  await page.goto(baseUrl);
  const state = await page.evaluate(async () => {
    const { LiveAudioController } = await import("/src/features/live/audio.ctrl.js");
    const video = document.createElement("video");
    Object.defineProperty(video, "readyState", { configurable: true, value: 0 });
    const playStates = [];
    video.play = () => {
      playStates.push({ muted: video.muted, readyState: video.readyState });
      return Promise.resolve();
    };
    video.muted = true;
    const engine = { type: "frigate_go2rtc", video };
    const host = {
      _activeCam: { entity: "camera.front", start_unmuted: true },
      _engine: engine,
      _streamMuted: true,
      _findVideoDeep: () => video,
      _renderMuteButton() {},
    };
    const controller = new LiveAudioController(host);
    controller.prepareCameraStart(host._activeCam);
    controller.applyCameraStartPreference();
    Object.defineProperty(video, "readyState", { configurable: true, value: 2 });
    video.dispatchEvent(new Event("loadeddata"));
    await Promise.resolve();
    return { muted: video.muted, playStates };
  });
  expect(state).toEqual({
    muted: false,
    playStates: [
      { muted: false, readyState: 0 },
      { muted: false, readyState: 2 },
    ],
  });
});
