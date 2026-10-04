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
      if (url.pathname.startsWith("/src/") || url.pathname.startsWith("/tests/fixtures/")) {
        response.setHeader("content-type", "text/javascript");
        response.end(await readFile(`.${url.pathname}`));
      } else if (url.pathname === "/hls.mjs") {
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

for (const failure of ["expired master", "unparsed manifest"]) {
  for (const webRtc of [false, true]) {
    test(`HA Direct resumes ${failure} after background cleanup with ${webRtc ? "blocked WebRTC" : "HLS only"}`, async ({ page }) => {
      let generation = 0;
      let rejectManifest = false;
      const errors = [];
      const requests = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => requests.push(request.url()));
      await page.route("**/master.m3u8?**", (route) => {
        const url = new URL(route.request().url());
        const expired = Number(url.searchParams.get("generation")) !== generation;
        return route.fulfill({ status: expired ? 404 : 200, contentType: "application/vnd.apple.mpegurl",
          body: expired ? "Stream no longer exists" : '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=400000,CODECS="avc1.42e01e,mp4a.40.2"\n' +
            `/playlist.m3u8?${url.searchParams}\n` });
      });
      await page.route("**/playlist.m3u8?**", (route) => {
        if (!rejectManifest || new URL(route.request().url()).searchParams.get("entity") !== "camera.one") return route.continue();
        rejectManifest = false;
        return route.fulfill({ status: 200, body: "Upstream is restarting" });
      });
      await page.goto(baseUrl);
      await page.evaluate(async (webRtc) => {
        const { default: Hls } = await import("/hls.mjs");
        const { installHaHlsBackgroundFixture } = await import("/tests/fixtures/ha-hls-background.mjs");
        const audit = installHaHlsBackgroundFixture(Hls, { webRtc });
        const { createHaDirectCameraProvider } = await import("/src/integrations/home-assistant/camera-provider.js");
        const p = window.backgroundProbe = { audit, generation: 0, requests: [], entries: [], states: new Map() };
        p.setHidden = (hidden) => {
          Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
          document.dispatchEvent(new Event("visibilitychange"));
        };
        for (const entity_id of ["camera.one", "camera.two"]) {
          const entry = createHaDirectCameraProvider({ stateObj: { entity_id, attributes: {} },
            hass: { callWS: async (message) => {
              p.requests.push(message.entity_id);
              return { url: `/master.m3u8?entity=${message.entity_id}&generation=${p.generation}` };
            } }, onState: (state) => p.states.set(entity_id, state) });
          document.body.append(entry.provider);
          // An unselected camera is retained in a mounted, transparent slot.
          if (entity_id === "camera.two") entry.provider.style.opacity = "0";
          p.entries.push(entry);
        }
        p.players = p.entries.map((entry) => entry.provider.player);
      }, webRtc);
      const expectLive = async () => {
        // Consecutive synthetic returns can fall inside the five-second URL
        // retry bound; real long-background returns are over a minute apart.
        await expect.poll(() => page.evaluate(() => [...window.backgroundProbe.states.values()]
          .filter((state) => state.status === "ready" && state.streamType === "hls").length), { timeout: 12000 }).toBe(2);
        const times = await page.evaluate(() => window.backgroundProbe.players.map((player) => player.video.currentTime));
        await expect.poll(() => page.evaluate((times) => window.backgroundProbe.players.every((player, index) =>
          !player.video.paused && player.video.currentTime > times[index] + 0.2), times)).toBe(true);
      };
      await expectLive();
      // A short tab switch must not reset playback or ask HA for another URL.
      await page.evaluate(() => { const p = window.backgroundProbe; p.setHidden(true); p.setHidden(false); });
      await expectLive();
      expect(await page.evaluate(() => window.backgroundProbe.requests)).toEqual([]);
      for (const cycle of [1, 2]) {
        const previousRequests = await page.evaluate(() => window.backgroundProbe.requests.length);
        await page.evaluate(() => {
          const p = window.backgroundProbe;
          p.setHidden(true);
          // A network interruption while hidden must not race HA's own resume
          // fetch on return or create replacement streams in the background.
          p.players[0]._error = "Stream network error";
          p.players[0].dispatchEvent(new CustomEvent("streams", { bubbles: true, composed: true,
            detail: { hasVideo: false, hasAudio: false } }));
          for (const player of p.players) player.hiddenCleanup();
        });
        await expect.poll(() => page.evaluate(() => window.backgroundProbe.players.every((player) =>
          player.video.readyState === 0 && !player.video.hasAttribute("src")))).toBe(true);
        expect(await page.evaluate(() => window.backgroundProbe.requests.length)).toBe(previousRequests);
        if (failure === "expired master") generation += 1;
        else rejectManifest = true;
        await page.evaluate((generation) => {
          const p = window.backgroundProbe;
          p.generation = generation;
          p.setHidden(false);
        }, generation);
        await expectLive();
        expect(await page.evaluate(() => window.backgroundProbe.audit.starts)).toEqual(["camera.one", "camera.two"]);
        expect(await page.evaluate(() => window.backgroundProbe.audit.stops)).toEqual([]);
        expect(await page.evaluate(() => window.backgroundProbe.audit.engines.filter((engine) => engine.media).length)).toBe(2);
        expect(await page.evaluate(() => window.backgroundProbe.requests.length)).toBe(failure === "expired master" ? cycle * 2 : cycle);
        expect(await page.evaluate(() => window.backgroundProbe.audit.cleanups.filter((entity) => entity === "camera.two").length))
          .toBe(failure === "expired master" ? cycle * 2 : cycle);
      }
      expect(await page.evaluate(() => window.backgroundProbe.audit.engines.every((engine) => !engine.config.lowLatencyMode))).toBe(true);
      expect(requests.filter((url) => /_HLS_|partial|next-part/.test(url))).toEqual([]);
      expect(errors).toEqual([]);
      await page.evaluate(() => {
        for (const entry of window.backgroundProbe.entries) { entry.dispose(); entry.provider.remove(); }
      });
      expect(await page.evaluate(() => window.backgroundProbe.audit.engines.some((engine) => engine.media))).toBe(false);
    });
  }
}

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
