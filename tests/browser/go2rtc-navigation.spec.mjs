import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

let server;
let baseUrl;
test.beforeAll(async () => {
  const movie = execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
    "testsrc2=size=160x90:rate=15:duration=30", "-an", "-c:v", "libx264",
    "-pix_fmt", "yuv420p", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1",
  ], { maxBuffer: 4 * 1024 * 1024 });
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname.startsWith("/dist/")) {
      try {
        const source = await readFile(`.${pathname}`);
        response.writeHead(200, { "content-type": "text/javascript" });
        response.end(source);
      } catch (_) { response.writeHead(404); response.end(); }
    } else if (pathname === "/media.mp4") {
      response.writeHead(200, { "content-type": "video/mp4", "content-length": movie.length });
      response.end(movie);
    } else {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><html><body></body></html>");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("Frigate stream host still stops its race on real removal", async ({ page }) => {
  await page.goto(baseUrl);
  const state = await page.evaluate(async () => {
    await import("/dist/frigate-view-card.js");
    const host = document.createElement("frigate-live-stream");
    document.body.append(host);
    let stops = 0;
    host.attachOrchestrator({ async stop() { stops += 1; } });
    host.remove();
    await Promise.resolve();
    return { stops, cleared: host._orchestrator === null };
  });
  expect(state).toEqual({ stops: 1, cleared: true });
});

for (const transport of ["webrtc", "mse"]) {
  test(`Frigate go2rtc ${transport} live presentation accepts wheel and click zoom`, async ({ page }) => {
    await page.goto(baseUrl);
    await page.evaluate(async (type) => {
      await import("/dist/frigate-view-card.js");
      customElements.define("go2rtc-zoom-card", class extends customElements.get("frigate-view-card") {
        connectedCallback() {}
        disconnectedCallback() {}
      });
      const card = document.createElement("go2rtc-zoom-card");
      card.style.cssText = "display:block;width:640px";
      card.setConfig({ cameras: [{ entity: "camera.front", connection_type: "frigate_go2rtc" }] });
      document.body.append(card);
      card._renderShell();
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.src = "/media.mp4";
      card.shadowRoot.querySelector("#engine").replaceChildren(video);
      await video.play();
      card._assignLiveEngine({ video, streamType: type });
      card._setActiveStreamType(type);
      card._setStreamLoading(false);
      card._setStreamFallbackVisible(false);
      window.zoomCard = card;
    }, transport);
    const point = await page.evaluate(() => {
      const bounds = window.zoomCard._liveVideoZoomController.host.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    });
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, -100);
    await expect.poll(() => page.evaluate(() => window.zoomCard._liveVideoZoomController.state.scale)).toBeGreaterThan(1);
    await page.evaluate(() => window.zoomCard._liveVideoZoomController.reset());
    await page.mouse.dblclick(point.x, point.y);
    await expect.poll(() => page.evaluate(() => window.zoomCard._liveVideoZoomController.state.scale)).toBe(2);
    await page.evaluate(() => window.zoomCard._liveMediaPresentationController.clearVideoZoom());
  });
}

for (const phase of ["both pending", "MSE ready before commit", "WebRTC takeover pending", "MSE only"]) {
  test(`Frigate go2rtc survives page navigation with ${phase}`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(baseUrl);
    if (phase === "MSE only") await page.clock.setFixedTime(new Date("2026-10-04T00:00:00Z"));
    await page.evaluate(async (phase) => {
      await import("/dist/frigate-view-card.js");
      customElements.define("go2rtc-navigation-card", class extends customElements.get("frigate-view-card") {
        connectedCallback() {}
        disconnectedCallback() {}
      });
      const card = document.createElement("go2rtc-navigation-card");
      card.setConfig({
        cameras: [{ entity: "camera.front", connection_type: "frigate_go2rtc" }],
        wide_view_page_enabled: true, wide_view_live_cameras: false,
        card_view_page_enabled: true,
      });
      document.body.append(card);
      await card._wideViewPageController.prepare();
      await card._cardViewPageController.prepareStyles();
      card._renderShell();
      const probe = { card, calls: [], aborted: [], destroyed: [], attempts: {}, phase };
      window.go2rtcProbe = probe;
      // Only network engines are replaced. The shipped mount controller, race,
      // stream host, layout handoff, adoption and frame checks are exercised.
      const start = async (type, slot, { abortSignal }) => {
        probe.calls.push(type);
        if (type === "webrtc" && phase === "MSE only") return false;
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.src = "/media.mp4";
        slot.append(video);
        const engine = { video, destroy() {
          if (engine.destroyed) return;
          engine.destroyed = true;
          probe.destroyed.push(type);
          video.pause();
          video.removeAttribute("src");
          video.load();
        } };
        const ready = new Promise((resolve) => {
          video.addEventListener("loadeddata", resolve, { once: true });
        });
        void video.play().catch(() => {});
        const gate = new Promise((resolve) => {
          probe.attempts[type] = { engine, ready, release: () => resolve(true) };
          abortSignal.addEventListener("abort", () => {
            probe.aborted.push(type);
            engine.destroy();
            resolve(false);
          }, { once: true });
        });
        if (!(await gate)) return false;
        await ready;
        return { ok: true, type, engine, slot };
      };
      card._go2rtcMounter.tryMountWebRtc = (slot, _startup, options) => start("webrtc", slot, options);
      card._go2rtcMounter.tryMountMse = (slot, _startup, options) => start("mse", slot, options);
      probe.mount = card._mountEngine();
      probe.host = card.shadowRoot.querySelector("#engine");
      probe.navigate = () => {
        probe.beforeNavigation = { pending: card._mountInProgress, type: card._activeStreamType };
        for (const pageId of ["wide-view", "single-view", "mobile-view", "wide-view"]) {
          card._pageId = pageId;
          card._renderShellPreserveLive();
        }
      };
    }, phase);
    await expect.poll(() => page.evaluate(() => window.go2rtcProbe.calls.length)).toBe(2);
    await page.evaluate(async () => {
      const p = window.go2rtcProbe;
      await Promise.all(Object.values(p.attempts).map((attempt) => attempt.ready));
      if (p.phase !== "both pending") {
        p.attempts.mse.release();
        // Drain the resolved strategy into the preferred-WebRTC wait without
        // relying on a wall-clock delay to hit that short window.
        for (let i = 0; i < 12; i += 1) await Promise.resolve();
      }
      if (p.phase === "both pending" || p.phase === "MSE ready before commit") p.navigate();
    });
    if (phase === "WebRTC takeover pending" || phase === "MSE only") {
      await expect.poll(() => page.evaluate(() => window.go2rtcProbe.card._activeStreamType)).toBe("mse");
      await page.evaluate(() => window.go2rtcProbe.navigate());
    }
    const before = await page.evaluate(() => window.go2rtcProbe.beforeNavigation);
    if (phase === "both pending" || phase === "MSE ready before commit") expect(before.pending).toBe(true);
    expect(await page.evaluate(() => window.go2rtcProbe.aborted)).toEqual([]);
    expect(await page.evaluate(() => window.go2rtcProbe.destroyed)).toEqual([]);
    expect(await page.evaluate(() => window.go2rtcProbe.host === window.go2rtcProbe.card.shadowRoot.querySelector("#engine"))).toBe(true);

    await page.evaluate(async () => {
      const p = window.go2rtcProbe;
      p.attempts.mse.release();
      p.attempts.webrtc?.release();
      await p.mount;
    });
    const expectedType = phase === "MSE only" ? "mse" : "webrtc";
    await expect.poll(() => page.evaluate(() => window.go2rtcProbe.card._activeStreamType)).toBe(expectedType);
    await page.evaluate(() => {
      const p = window.go2rtcProbe;
      for (const pageId of ["single-view", "card-view", "wide-view"]) {
        p.card._pageId = pageId;
        p.card._renderShellPreserveLive();
      }
      p.retainedEngine = p.card._engine;
    });
    const retainedTime = await page.evaluate(() => window.go2rtcProbe.retainedEngine.video.currentTime);
    await expect.poll(() => page.evaluate(() => window.go2rtcProbe.retainedEngine.video.currentTime)).toBeGreaterThan(retainedTime + 0.15);
    expect(await page.evaluate(() => window.go2rtcProbe.retainedEngine.video.isConnected)).toBe(true);
    expect(await page.evaluate(() => window.go2rtcProbe.retainedEngine.destroyed === true)).toBe(false);
    expect(await page.evaluate(() => window.go2rtcProbe.calls)).toEqual(["webrtc", "mse"]);
    if (phase === "MSE only") {
      // Expired grace connections reconnect with MSE only until a fresh
      // WebRTC check is due. Advance Date, not media or readiness timers.
      const reconnect = async () => {
        const previousMseCalls = await page.evaluate(() =>
          window.go2rtcProbe.calls.filter((type) => type === "mse").length);
        await page.evaluate(() => {
          const p = window.go2rtcProbe;
          p.card._cleanupEngine();
          p.mount = p.card._mountEngine();
        });
        await expect.poll(() => page.evaluate(() =>
          window.go2rtcProbe.calls.filter((type) => type === "mse").length)).toBe(previousMseCalls + 1);
        await page.evaluate(async () => {
          const p = window.go2rtcProbe;
          p.attempts.mse.release();
          await p.mount;
        });
        await expect.poll(() => page.evaluate(() => window.go2rtcProbe.card._activeStreamType)).toBe("mse");
      };
      const expectWebRtcCalls = async (count) => {
        expect(await page.evaluate(() =>
          window.go2rtcProbe.calls.filter((type) => type === "webrtc").length)).toBe(count);
      };
      await page.clock.setFixedTime(new Date("2026-10-04T00:00:21Z"));
      await reconnect();
      await expectWebRtcCalls(1);
      await page.clock.setFixedTime(new Date("2026-10-04T00:01:59.999Z"));
      await reconnect();
      await expectWebRtcCalls(1);
      await page.clock.setFixedTime(new Date("2026-10-04T00:02:00Z"));
      await reconnect();
      await expectWebRtcCalls(2);
      await page.clock.setFixedTime(new Date("2026-10-04T00:06:59.999Z"));
      await reconnect();
      await expectWebRtcCalls(2);
      await page.clock.setFixedTime(new Date("2026-10-04T00:07:00Z"));
      await reconnect();
      await expectWebRtcCalls(3);
      expect(errors).toEqual([]);
    }
    expect(errors).toEqual([]);
    await page.evaluate(() => {
      window.go2rtcProbe.card._cleanupEngine();
      window.go2rtcProbe.card.remove();
    });
  });
}
