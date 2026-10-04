import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

let server;
let baseUrl;
let mediaDir;
test.beforeAll(async () => {
  mediaDir = await mkdtemp(join(tmpdir(), "fvc-standard-hls-"));
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
    "testsrc2=size=160x90:rate=15:duration=16", "-an", "-c:v", "libx264", "-profile:v", "baseline",
    "-level", "3.0", "-g", "30", "-keyint_min", "30", "-sc_threshold", "0", "-pix_fmt", "yuv420p",
    "-f", "hls", "-hls_time", "2", "-hls_list_size", "0", "-hls_segment_type", "fmp4",
    join(mediaDir, "playlist.m3u8")]);
  const complete = (await readFile(join(mediaDir, "playlist.m3u8"), "utf8")).replace("#EXT-X-ENDLIST\n", "");
  const playlist = complete.replace("#EXT-X-TARGETDURATION:2", ["#EXT-X-TARGETDURATION:2",
    "#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,CAN-SKIP-UNTIL=12,PART-HOLD-BACK=1",
    "#EXT-X-PART-INF:PART-TARGET=0.5"].join("\n")) +
    '#EXT-X-PART:DURATION=0.5,URI="partial.m4s"\n#EXT-X-PRELOAD-HINT:TYPE=PART,URI="next-part.m4s"\n';
  server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.searchParams.has("_HLS_msn") || url.searchParams.has("_HLS_part") || url.searchParams.has("_HLS_skip") ||
        url.pathname.includes("partial") || url.pathname.includes("next-part")) {
      response.writeHead(400);
      response.end();
      return;
    }
    try {
      if (url.pathname === "/hls.mjs") {
        response.setHeader("content-type", "text/javascript");
        response.end(await readFile("node_modules/hls.js/dist/hls.light.mjs"));
      } else if (url.pathname === "/policy.js") {
        response.setHeader("content-type", "text/javascript");
        response.end(await readFile("src/integrations/home-assistant/camera-hls-policy.js"));
      } else if (url.pathname === "/playlist.m3u8") {
        response.setHeader("content-type", "application/vnd.apple.mpegurl");
        response.end(playlist);
      } else if (/^\/(?:init\.mp4|playlist\d+\.m4s)$/.test(url.pathname)) {
        response.setHeader("content-type", "video/mp4");
        response.end(await readFile(join(mediaDir, url.pathname.slice(1))));
      } else {
        response.setHeader("content-type", "text/html");
        response.end("<!doctype html><html><body></body></html>");
      }
    } catch (_) { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (mediaDir) await rm(mediaDir, { recursive: true, force: true });
});

test("HA's Hls.js engine plays complete segments without LL requests, including URL recovery", async ({ page }) => {
  const requests = [];
  const errors = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 400) errors.push(String(response.status())); });
  await page.goto(baseUrl);
  await page.evaluate(async () => {
    const { default: Hls } = await import("/hls.mjs");
    const { configureStandardHaHlsPlayer } = await import("/policy.js");
    const video = document.createElement("video");
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    document.body.append(video);
    const player = {
      // HA's construction/load/error ownership boundary; actual Hls.js engine
      // and actual decoded fMP4 media, not a config-only mock.
      _renderHLSPolyfill(videoEl, Engine, url) {
        const hls = new Engine({ lowLatencyMode: true, backBufferLength: 60,
          fragLoadingTimeOut: 30000, manifestLoadingTimeOut: 30000, levelLoadingTimeOut: 30000 });
        this.engine = hls;
        hls.attachMedia(videoEl);
        hls.on(Engine.Events.MEDIA_ATTACHED, () => hls.loadSource(url));
      },
    };
    configureStandardHaHlsPlayer(player);
    window.hlsProbe = { player, video, Hls, defaults: Hls.DefaultConfig.lowLatencyMode };
    player._renderHLSPolyfill(video, Hls, "/playlist.m3u8?generation=1");
  });
  for (const generation of [1, 2]) {
    if (generation === 2) {
      await page.evaluate(() => {
        const { player, video, Hls } = window.hlsProbe;
        player.engine.destroy();
        player._renderHLSPolyfill(video, Hls, "/playlist.m3u8?generation=2");
      });
    }
    await expect.poll(() => page.evaluate(() => window.hlsProbe.video.readyState)).toBeGreaterThanOrEqual(2);
    const time = await page.evaluate(() => window.hlsProbe.video.currentTime);
    await expect.poll(() => page.evaluate(() => window.hlsProbe.video.currentTime)).toBeGreaterThan(time + 0.3);
    expect(await page.evaluate(() => window.hlsProbe.player.engine.config.lowLatencyMode)).toBe(false);
    expect(await page.evaluate(() => window.hlsProbe.Hls.DefaultConfig.lowLatencyMode)).toBe(true);
    expect(requests.some((url) => url.includes(`generation=${generation}`))).toBe(true);
  }
  expect(requests.some((url) => /playlist\d+\.m4s/.test(url))).toBe(true);
  expect(requests.filter((url) => /_HLS_|partial|next-part/.test(url))).toEqual([]);
  expect(errors).toEqual([]);
  await page.evaluate(() => window.hlsProbe.player.engine.destroy());
});
