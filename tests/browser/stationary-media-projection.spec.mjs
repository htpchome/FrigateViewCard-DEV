import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

let server;
let baseUrl;
test.beforeAll(async () => {
  // Synthetic media only: a real decoder/player, with no camera or HA secrets.
  const movie = execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
    "testsrc2=size=160x90:rate=15:duration=60", "-an", "-c:v", "libx264",
    "-pix_fmt", "yuv420p", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1",
  ], { maxBuffer: 8 * 1024 * 1024 });
  const moduleSource = await readFile("src/shared/media/stationary-projection.js");
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname.startsWith("/src/") || pathname.startsWith("/tests/fixtures/") || pathname.startsWith("/dist/")) {
      try {
        const source = await readFile(`.${pathname}`);
        response.writeHead(200, { "content-type": "text/javascript" });
        response.end(source);
      } catch (_) { response.writeHead(404); response.end(); }
    } else if (request.url === "/projection.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(moduleSource);
    } else if (pathname === "/media.mp4") {
      // WebKit requests byte ranges when starting/reopening native media.
      const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
      const partial = Boolean(range && (range[1] || range[2]));
      const start = partial ? (range[1] ? Number(range[1]) : Math.max(0, movie.length - Number(range[2]))) : 0;
      const end = partial && range[1] && range[2] ? Math.min(Number(range[2]), movie.length - 1) : movie.length - 1;
      if (start >= movie.length || start > end) {
        response.writeHead(416, { "content-range": `bytes */${movie.length}` });
        response.end();
        return;
      }
      response.writeHead(partial ? 206 : 200, {
        "content-type": "video/mp4", "accept-ranges": "bytes", "content-length": end - start + 1,
        ...(partial ? { "content-range": `bytes ${start}-${end}/${movie.length}` } : {}),
      });
      response.end(movie.subarray(start, end + 1));
    } else if (pathname === "/snapshot.svg") {
      response.writeHead(200, { "content-type": "image/svg+xml" });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="gray"/></svg>');
    } else {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><html><body></body></html>");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test("synthetic media serves valid byte ranges for native playback", async ({ request }) => {
  const response = await request.get(`${baseUrl}/media.mp4`);
  expect(response.status()).toBe(200);
  const movie = await response.body();
  for (const [range, start, end] of [
    ["bytes=0-1", 0, 1], ["bytes=100-", 100, movie.length - 1],
    ["bytes=-16", movie.length - 16, movie.length - 1],
    [`bytes=${movie.length - 4}-${movie.length + 10}`, movie.length - 4, movie.length - 1],
  ]) {
    const part = await request.get(`${baseUrl}/media.mp4`, { headers: { range } });
    expect(part.status()).toBe(206);
    expect(part.headers()["content-range"]).toBe(`bytes ${start}-${end}/${movie.length}`);
    expect(part.headers()["content-length"]).toBe(String(end - start + 1));
    expect(await part.body()).toEqual(movie.subarray(start, end + 1));
  }
  const invalid = await request.get(`${baseUrl}/media.mp4`, { headers: { range: `bytes=${movie.length}-` } });
  expect(invalid.status()).toBe(416);
  expect(invalid.headers()["content-range"]).toBe(`bytes */${movie.length}`);
});

const scenarios = [
  { name: "hls", transport: "hls", webRtc: false },
  { name: "webrtc", transport: "webrtc", webRtc: true },
  { name: "verified HLS with pending WebRTC-only ICE", transport: "hls", webRtc: "pending", supportedTypes: ["web_rtc"] },
  { name: "verified HLS with failed WebRTC-only ICE", transport: "hls", webRtc: false, supportedTypes: ["web_rtc"] },
  { name: "HLS with native ICE retry suppression", transport: "hls", webRtc: "ice-retry", supportedTypes: ["web_rtc"] },
];

const expectRetainedSessionVideoAdvancing = async (page, entity) => {
  const time = await page.evaluate((id) => window.sessionProbe.originalVideos.get(id).currentTime, entity);
  await expect.poll(() => page.evaluate((id) => {
    const p = window.sessionProbe;
    const record = p.session.get(id);
    const video = p.originalVideos.get(id);
    // Buffering clears the presentation reference, not the retained player.
    // Require the same video to return ready and advance; never accept a reload.
    return record.status === "ready" && record.video === video && video.isConnected
      ? video.currentTime : -1;
  }, entity)).toBeGreaterThan(time + 0.15);
};

for (const options of [
  { name: "HLS-only", webRtc: false, supportedTypes: ["hls"] },
  { name: "failed WebRTC", webRtc: false, supportedTypes: ["web_rtc"] },
  { name: "pending WebRTC takeover", webRtc: "pending", supportedTypes: ["web_rtc"] },
]) {
  test(`HA Direct recovers interrupted HLS in place with ${options.name}`, async ({ page }) => {
    await page.goto(baseUrl);
    await page.evaluate(async (scenario) => {
      const { installHaCameraLifecycleFixture } = await import("/tests/fixtures/ha-camera-lifecycle.mjs");
      const audit = installHaCameraLifecycleFixture(scenario);
      const { createHaDirectCameraProvider } = await import("/src/integrations/home-assistant/camera-provider.js");
      const states = [];
      const entries = ["camera.one", "camera.two"].map((entity_id) => {
        const result = createHaDirectCameraProvider({
          hass: { callWS: audit.callWS }, stateObj: { entity_id, attributes: {} },
          onState: (state) => states.push({ entity_id, ...state }),
        });
        document.body.append(result.provider);
        return result;
      });
      window.recoveryProbe = { entries, audit, states };
    }, options);
    await expect.poll(() => page.evaluate(() => window.recoveryProbe.audit.readyEntities.size)).toBe(2);
    await page.evaluate(() => {
      const p = window.recoveryProbe;
      p.players = p.entries.map(({ provider }) => provider.players.get("hls"));
      p.starts = [...p.audit.starts];
      p.states.length = 0;
      p.audit.interruptHls("camera.one");
    });
    await expect.poll(() => page.evaluate(() => window.recoveryProbe.states
      .filter((state) => state.entity_id === "camera.one").at(-1)?.status)).toBe("loading");
    expect(await page.evaluate(() => {
      const p = window.recoveryProbe;
      return p.entries[0].provider.players.get("hls") === p.players[0] && p.players[0].isConnected;
    })).toBe(true);
    expect(await page.evaluate(() => window.recoveryProbe.audit.stops.some((value) => value.startsWith("ha-hls")))).toBe(false);
    await page.evaluate(() => window.recoveryProbe.audit.recoverHls("camera.one"));
    await expect.poll(() => page.evaluate(() => window.recoveryProbe.states
      .filter((state) => state.entity_id === "camera.one").at(-1)?.status)).toBe("ready");
    const time = await page.evaluate(() => window.recoveryProbe.players[0].video.currentTime);
    await expect.poll(() => page.evaluate(() => window.recoveryProbe.players[0].video.currentTime)).toBeGreaterThan(time + 0.15);
    expect(await page.evaluate(() => window.recoveryProbe.entries[0].provider.hls.hasVideo)).toBe(false);
    expect(await page.evaluate(() => window.recoveryProbe.states.filter((state) => state.entity_id === "camera.two"))).toEqual([]);
    // The background camera gets one failure, then no more errors or user
    // navigation. A fresh HA URL must recover that same native player.
    await page.evaluate(() => window.recoveryProbe.audit.expireHls("camera.two"));
    await expect.poll(() => page.evaluate(() => window.recoveryProbe.audit.urlUpdates)).toEqual(["camera.two"]);
    await expect.poll(() => page.evaluate(() => window.recoveryProbe.states
      .filter((state) => state.entity_id === "camera.two").at(-1)?.status)).toBe("ready");
    expect(await page.evaluate(() => window.recoveryProbe.entries.every(({ provider }, index) =>
      provider.players.get("hls") === window.recoveryProbe.players[index]))).toBe(true);
    expect(await page.evaluate(() => window.recoveryProbe.audit.starts.filter((value) => value.startsWith("ha-hls")))).toEqual(
      await page.evaluate(() => window.recoveryProbe.starts.filter((value) => value.startsWith("ha-hls"))));
    if (options.webRtc === "pending") {
      await page.evaluate(() => { window.recoveryProbe.states.length = 0; window.recoveryProbe.audit.releaseWebRtc(); });
      await expect.poll(() => page.evaluate(() => window.recoveryProbe.states
        .filter((state) => state.entity_id === "camera.one").at(-1)?.streamType)).toBe("webrtc");
      expect(await page.evaluate(() => window.recoveryProbe.states.some((state) => state.status !== "ready"))).toBe(false);
    }
    expect(await page.evaluate(() => window.recoveryProbe.audit.providerDisconnects)).toBe(0);
    await page.evaluate(() => {
      for (const result of window.recoveryProbe.entries) { result.dispose(); result.provider.remove(); }
    });
  });
}

for (const webRtc of [false, true]) {
  test(`HA Direct restores ${webRtc ? "WebRTC" : "HLS"} readiness from progress without another playing event`, async ({ page }) => {
    await page.goto(baseUrl);
    await page.evaluate(async (useWebRtc) => {
      const { installHaCameraLifecycleFixture } = await import("/tests/fixtures/ha-camera-lifecycle.mjs");
      const { createHaDirectCameraProvider } = await import("/src/integrations/home-assistant/camera-provider.js");
      const audit = installHaCameraLifecycleFixture({ webRtc: useWebRtc });
      const states = [];
      const entry = createHaDirectCameraProvider({
        hass: { callWS: audit.callWS }, stateObj: { entity_id: "camera.one", attributes: {} },
        onState: (state) => states.push(state),
      });
      document.body.append(entry.provider);
      window.progressProbe = { audit, entry, states, playingSuppressed: 0 };
    }, webRtc);
    await expect.poll(() => page.evaluate(() => window.progressProbe.states.at(-1)?.streamType)).toBe(webRtc ? "webrtc" : "hls");
    const stoppedAt = await page.evaluate(() => {
      const p = window.progressProbe;
      p.video = p.states.at(-1).video;
      p.player = [...p.entry.provider.players.values()].find((player) => player.video === p.video);
      p.starts = [...p.audit.starts];
      p.video.addEventListener("playing", (event) => {
        p.playingSuppressed += 1;
        event.stopImmediatePropagation();
      }, { capture: true });
      p.video.pause();
      p.video.dispatchEvent(new Event("waiting"));
      p.video.dispatchEvent(new Event("timeupdate"));
      return p.video.currentTime;
    });
    expect(await page.evaluate(() => window.progressProbe.states.at(-1).status)).toBe("loading");
    await page.evaluate(async () => {
      const p = window.progressProbe;
      p.player._error = "Still recovering";
      await p.video.play();
    });
    await expect.poll(() => page.evaluate(() => window.progressProbe.video.currentTime)).toBeGreaterThan(stoppedAt + 0.15);
    expect(await page.evaluate(() => window.progressProbe.states.at(-1).status)).toBe("loading");
    await page.evaluate(() => { window.progressProbe.player._error = undefined; });
    await expect.poll(() => page.evaluate(() => window.progressProbe.states.at(-1).status)).toBe("ready");
    expect(await page.evaluate(() => window.progressProbe.playingSuppressed)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.progressProbe.states.at(-1).video === window.progressProbe.video)).toBe(true);
    expect(await page.evaluate(() => window.progressProbe.audit.starts)).toEqual(await page.evaluate(() => window.progressProbe.starts));
    expect(await page.evaluate(() => window.progressProbe.audit.providerDisconnects)).toBe(0);
    await page.evaluate(() => {
      window.progressProbe.entry.dispose();
      window.progressProbe.entry.provider.remove();
    });
  });
}

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) {
    const configurations = await page.evaluate(() => (window.bundleProbe || window.sessionProbe ||
      window.coldProbe || window.wideProbe || window.recoveryProbe || window.progressProbe)?.audit.hlsConfigurations || []);
    for (const configuration of configurations) expect(configuration.lowLatencyMode, configuration.entity).toBe(false);
    return;
  }
  const state = await page.evaluate(() => {
    const probe = window.bundleProbe || window.sessionProbe || window.coldProbe || window.wideProbe;
    if (!probe) return null;
    const session = probe.session || probe.card?._engine?.haDirectSession ||
      probe.anchor?.querySelector("ha-camera-stream")?.haDirectSession;
    return {
      starts: probe.audit.startReadiness,
      mediaEvents: probe.audit.mediaEvents,
      context: probe.view?.state.context,
      startsCount: probe.audit.starts, stops: probe.audit.stops,
      records: [...(session?.records.values() || [])].map((record) => ({
        entity: record.entity, status: record.status, type: record.streamType,
        players: [...record.provider.players.values()].map((player) => ({
          type: player.localName, hidden: player.classList.contains("hidden"),
          readyState: player.video.readyState, paused: player.video.paused,
          width: player.video.videoWidth, time: player.video.currentTime,
          error: player.video.error?.message,
        })),
      })),
    };
  });
  if (state) await testInfo.attach("camera-readiness", {
    body: JSON.stringify(state, null, 2), contentType: "application/json",
  });
  if (state) console.error("Synthetic camera readiness:", JSON.stringify(state));
});

for (const scenario of scenarios.flatMap((scenario) => ["hui-card", "div"].map((dashboardHost) => ({ ...scenario, dashboardHost })))) {
  const { transport } = scenario;
  test(`production bundle starts and retains the HA Direct ${scenario.name} session (${scenario.dashboardHost})`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(baseUrl);
    await page.evaluate(async (options) => {
      const { installHaCameraLifecycleFixture } = await import("/tests/fixtures/ha-camera-lifecycle.mjs");
      const audit = installHaCameraLifecycleFixture({ ...options, holdReadinessAudit: true });
      await import("/dist/frigate-view-card.js");
      // Exercise the shipped card's real composition/mounter/session, without
      // starting unrelated browse requests or dashboard observers in this fixture.
      customElements.define("bundle-session-card", class extends customElements.get("frigate-view-card") {
        connectedCallback() {}
        disconnectedCallback() {}
      });
      const anchor = document.createElement("home-assistant");
      anchor.attachShadow({ mode: "open" });
      document.body.append(anchor);
      const card = document.createElement("bundle-session-card");
      const config = { cameras: [
        { entity: "camera.one", connection_type: "ha_direct" },
        { entity: "camera.two", connection_type: "ha_direct" },
      ] };
      // Save must also work without a hui-card wrapper around the dashboard card.
      const shell = document.createElement(options.dashboardHost);
      shell.config = config;
      shell.append(card);
      card.setConfig(config);
      card._hass = { connection: {}, callWS: audit.callWS, states: Object.fromEntries(
        ["camera.one", "camera.two"].map((entity_id) => [entity_id, { entity_id, state: "idle", attributes: {} }]),
      ) };
      card._activeCamIdx = 0;
      card._started = true;
      anchor.shadowRoot.append(shell);
      card._renderShell();
      window.bundleProbe = { card, audit, anchor, shell };
      await card._haDirectMounter.tryMount(card.shadowRoot.querySelector("#engine"), null, { entity: "camera.one" });
    }, scenario);
    await expect.poll(() => page.evaluate(() => [...(window.bundleProbe.card._engine?.haDirectSession?.records.values() || [])]
      .filter((record) => record.status === "ready").length)).toBe(2);
    await expect.poll(() => page.evaluate(() => window.bundleProbe.card._activeStreamType)).toBe(transport);
    await page.evaluate(async () => {
      const { card } = window.bundleProbe;
      const session = card._engine.haDirectSession;
      window.bundleProbe.session = session;
      window.bundleProbe.first = card._engine;
      card._activeCamIdx = 1;
      await card._haDirectMounter.tryMount(card.shadowRoot.querySelector("#engine"), null, { entity: "camera.two" });
    });
    expect(await page.evaluate(() => window.bundleProbe.card._engine.haDirectEntity)).toBe("camera.two");
    await page.evaluate(async () => {
      const { card } = window.bundleProbe;
      card._activeCamIdx = 0;
      await card._haDirectMounter.tryMount(card.shadowRoot.querySelector("#engine"), null, { entity: "camera.one" });
    });
    expect(await page.evaluate(() => window.bundleProbe.card._engine === window.bundleProbe.first)).toBe(true);
    expect(await page.evaluate(() => window.bundleProbe.audit.providerDisconnects)).toBe(0);
    const secondStarts = await page.evaluate(() => window.bundleProbe.audit.startReadiness
      .filter((start) => start.entity === "camera.two"));
    expect(secondStarts.length).toBeGreaterThan(0);
    for (const start of secondStarts) {
      expect(start.ready, JSON.stringify(start)).toContain("camera.one");
      expect(start.eventReady).toEqual([]);
    }
    await page.evaluate(() => window.bundleProbe.audit.releaseReadinessAudit());
    expect(await page.evaluate(() => window.bundleProbe.audit.verifications))
      .toEqual(scenario.supportedTypes ? ["camera.one", "camera.two"] : []);
    if (scenario.webRtc === "pending") {
      const starts = await page.evaluate(() => window.bundleProbe.audit.starts);
      await page.evaluate(() => {
        const p = window.bundleProbe;
        p.hlsPlayers = [...p.session.records.values()].map((record) => record.provider.players.get("hls"));
      });
      await page.evaluate(() => window.bundleProbe.audit.releaseWebRtc());
      await expect.poll(() => page.evaluate(() => window.bundleProbe.card._activeStreamType)).toBe("webrtc");
      expect(await page.evaluate(() => window.bundleProbe.card._engine === window.bundleProbe.first)).toBe(true);
      expect(await page.evaluate(() => window.bundleProbe.audit.starts)).toEqual(starts);
      await expect.poll(() => page.evaluate(() => [...window.bundleProbe.session.records.values()]
        .every((record) => record.provider.players.size === 1 && record.provider.players.has("web_rtc")))).toBe(true);
      expect(await page.evaluate(() => window.bundleProbe.hlsPlayers.every((player) =>
        !player.isConnected && player.video.paused && !player.video.hasAttribute("src")))).toBe(true);
      expect(await page.evaluate(() => [...window.bundleProbe.audit.stops].sort())).toEqual([
        "ha-hls-player:camera.one", "ha-hls-player:camera.two",
      ]);
    }
    if (scenario.webRtc === "ice-retry") {
      const initialTime = Date.now();
      await page.clock.setFixedTime(initialTime);
      await page.evaluate(() => {
        const p = window.bundleProbe;
        p.hlsPlayers = [...p.session.records.values()].map((record) => record.provider.players.get("hls"));
        p.audit.failIce("camera.one");
      });
      await expect.poll(() => page.evaluate(() => window.bundleProbe.audit.closedPeers)).toEqual(["camera.one"]);
      expect(await page.evaluate(() => window.bundleProbe.session.get("camera.two").provider.players.has("web_rtc"))).toBe(true);
      await page.evaluate(() => window.bundleProbe.audit.failIce("camera.two"));
      await expect.poll(() => page.evaluate(() => window.bundleProbe.audit.closedPeers)).toHaveLength(2);
      const starts = await page.evaluate(() => window.bundleProbe.audit.starts);
      await page.clock.setFixedTime(initialTime + 120000);
      // Expiry and presentation refresh cannot create a background retry.
      await page.evaluate(() => window.bundleProbe.session.refresh());
      expect(await page.evaluate(() => window.bundleProbe.audit.starts)).toEqual(starts);
      await page.evaluate(async () => {
        const { card } = window.bundleProbe;
        card._activeCamIdx = 1;
        await card._haDirectMounter.tryMount(card.shadowRoot.querySelector("#engine"), null, { entity: "camera.two" });
      });
      await expect.poll(() => page.evaluate(() => window.bundleProbe.audit.rtcOffers)).toEqual([
        "camera.one", "camera.two", "camera.two",
      ]);
      await page.evaluate(() => window.bundleProbe.audit.failIce("camera.two"));
      await expect.poll(() => page.evaluate(() => window.bundleProbe.audit.closedPeers)).toHaveLength(3);
      await page.clock.setFixedTime(initialTime + 419999);
      await page.evaluate(() => {
        const p = window.bundleProbe;
        p.session.get("camera.two").onSelected();
      });
      expect(await page.evaluate(() => window.bundleProbe.audit.rtcOffers.length)).toBe(3);
      await page.clock.setFixedTime(initialTime + 420000);
      await page.evaluate(() => window.bundleProbe.session.get("camera.two").onSelected());
      await expect.poll(() => page.evaluate(() => window.bundleProbe.audit.rtcOffers.length)).toBe(4);
      // Leave failed candidates retired during all the editor handoff checks.
      await page.evaluate(() => window.bundleProbe.audit.failIce("camera.two"));
      await expect.poll(() => page.evaluate(() => window.bundleProbe.audit.closedPeers)).toHaveLength(4);
      await page.evaluate(async () => {
        const p = window.bundleProbe;
        p.card._activeCamIdx = 0;
        await p.card._haDirectMounter.tryMount(p.card.shadowRoot.querySelector("#engine"), null, { entity: "camera.one" });
      });
      await expect.poll(() => page.evaluate(() => window.bundleProbe.audit.rtcOffers.length)).toBe(5);
      await page.evaluate(() => window.bundleProbe.audit.failIce("camera.one"));
      await expect.poll(() => page.evaluate(() => window.bundleProbe.audit.closedPeers)).toHaveLength(5);
      await expect.poll(() => page.evaluate(() => {
        const p = window.bundleProbe;
        return [...p.session.records.values()].every((record, idx) =>
          record.provider.players.get("hls") === p.hlsPlayers[idx] && record.status === "ready");
      })).toBe(true);
      expect(await page.evaluate(() => window.bundleProbe.audit.stops.some((entry) => entry.startsWith("ha-hls")))).toBe(false);
    }
    if (scenario.webRtc === false) {
      await page.evaluate(() => {
        const p = window.bundleProbe;
        p.beforeOutage = [...p.session.records.values()].map((record) => ({
          provider: record.provider, player: record.provider.players.get("hls"),
        }));
        // One failed request per camera, including the unselected camera.
        // No refresh, view change, or continuing errors prompt recovery.
        p.audit.expireHls("camera.one");
        p.audit.expireHls("camera.two");
      });
      await expect.poll(() => page.evaluate(() => window.bundleProbe.audit.urlUpdates.length)).toBe(2);
      await expect.poll(() => page.evaluate(() => [...window.bundleProbe.session.records.values()]
        .every((record) => record.status === "ready" && record.streamType === "hls"))).toBe(true);
      expect(await page.evaluate(() => [...window.bundleProbe.session.records.values()]
        .every((record, index) => record.provider === window.bundleProbe.beforeOutage[index].provider &&
          record.provider.players.get("hls") === window.bundleProbe.beforeOutage[index].player))).toBe(true);
      expect(await page.evaluate(() => window.bundleProbe.audit.stops.some((value) => value.startsWith("ha-hls")))).toBe(false);
    }
    const startsBeforeSave = await page.evaluate(() => window.bundleProbe.audit.starts);
    // Exercise the real lazy editor bundle's Save notification against the
    // shipped runtime registry, including compact-vs-normalized config identity.
    await page.evaluate(async () => {
      const p = window.bundleProbe;
      await import("/dist/frigate-view-card-editor.js");
      customElements.define("bundle-session-editor", class extends customElements.get("frigate-view-card-editor") {
        connectedCallback() {}
        disconnectedCallback() {}
      });
      history.replaceState(null, "", "?edit=1");
      const dialog = document.createElement("hui-dialog-edit-card");
      dialog.attachShadow({ mode: "open" });
      dialog._cardConfig = p.shell.config;
      dialog._updateDirtyState = () => {};
      p.card.dispatchEvent(new CustomEvent("show-dialog", { bubbles: true, composed: true,
        detail: { dialogTag: "hui-dialog-edit-card", dialogParams: { cardConfig: p.shell.config } },
      }));
      p.anchor.shadowRoot.append(dialog);
      const save = document.createElement("button");
      save.slot = "primaryAction";
      save.textContent = "Save";
      dialog.shadowRoot.append(save);
      const editor = document.createElement("bundle-session-editor");
      dialog.shadowRoot.append(editor);
      editor.setConfig(p.shell.config);
      const previewShell = document.createElement("hui-card");
      previewShell.config = p.shell.config;
      const preview = document.createElement("bundle-session-card");
      preview.setConfig(previewShell.config);
      preview._hass = p.card._hass;
      preview._activeCamIdx = 0;
      preview._started = true;
      previewShell.append(preview);
      dialog.shadowRoot.append(previewShell);
      preview._renderShell();
      await preview._haDirectMounter.tryMount(preview.shadowRoot.querySelector("#engine"), null, { entity: "camera.one" });
      const title = editor.querySelector("#title");
      title.value = "Saved title";
      title.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      p.saveDirty = editor._hasConfigDraft;
      save.click();
      p.savedTitle = dialog._cardConfig.title;
      const shell = document.createElement(p.shell.localName);
      shell.config = dialog._cardConfig;
      const replacement = document.createElement("bundle-session-card");
      replacement.setConfig(shell.config);
      replacement._hass = p.card._hass;
      replacement._activeCamIdx = 0;
      replacement._started = true;
      shell.append(replacement);
      p.anchor.shadowRoot.append(shell);
      replacement._renderShell();
      await replacement._haDirectMounter.tryMount(replacement.shadowRoot.querySelector("#engine"), null, { entity: "camera.one" });
      p.replacement = replacement;
      dialog.remove();
      preview._haDirectMounter.dispose();
      p.shell.remove();
      p.card._haDirectMounter.dispose();
    });
    expect(await page.evaluate(() => window.bundleProbe.saveDirty)).toBe(true);
    expect(await page.evaluate(() => window.bundleProbe.savedTitle)).toBe("Saved title");
    expect(await page.evaluate(() => window.bundleProbe.replacement._engine === window.bundleProbe.first)).toBe(true);
    expect(await page.evaluate(() => window.bundleProbe.audit.starts)).toEqual(startsBeforeSave);
    expect(await page.evaluate(() => window.bundleProbe.audit.providerDisconnects)).toBe(0);
    const retainedTime = await page.evaluate(() => window.bundleProbe.session.get("camera.one").video.currentTime);
    await expect.poll(() => page.evaluate(() => window.bundleProbe.session.get("camera.one").video.currentTime)).toBeGreaterThan(retainedTime + 0.15);
    expect(errors).toEqual([]);
    await page.evaluate(() => {
      window.bundleProbe.replacement._haDirectMounter.dispose();
      window.bundleProbe.session.dispose();
    });
  });
}

for (const scenario of scenarios) {
  const { transport } = scenario;
  test(`HA Direct session retains ${scenario.name} through replaced card/editor clients`, async ({ page }) => {
    await page.goto(baseUrl);
    await page.evaluate(async (options) => {
      const { installHaCameraLifecycleFixture } = await import("/tests/fixtures/ha-camera-lifecycle.mjs");
      const audit = installHaCameraLifecycleFixture(options);
      const { createHaDirectProviderMounter } = await import("/src/features/live/ha-direct-provider-mounter.js");
      const anchor = document.createElement("home-assistant");
      anchor.attachShadow({ mode: "open" });
      document.body.append(anchor);
      const entities = ["camera.one", "camera.two", "camera.three"];
      const hass = { connection: {}, callWS: audit.callWS, states: Object.fromEntries(entities.map((entity_id) => [entity_id, { entity_id, attributes: {} }])) };
      const config = { cameras: entities };
      const views = [];
      const makeView = (context, selected = "camera.one", viewConfig = config) => {
        const outer = document.createElement("div");
        outer.attachShadow({ mode: "open" });
        anchor.shadowRoot.append(outer);
        const dialog = document.createElement(context === "config" ? "dialog" : "div");
        outer.shadowRoot.append(dialog);
        const card = document.createElement("div");
        card.attachShadow({ mode: "open" });
        dialog.append(card);
        card.shadowRoot.innerHTML = '<div style="position:relative;width:320px;height:180px"><slot name="fvc-ha-direct-provider-deck"></slot><div id="engine"></div></div>';
        const state = { selected, context, engine: null, ready: [], loading: true };
        const mounter = createHaDirectProviderMounter({
          scopeKey: card, getHass: () => hass, getStreamMuted: () => true,
          getSelectedEntity: () => state.selected, getPreloadEntities: () => entities,
          getContext: () => state.context, getIdentity: () => ({ config: viewConfig, signature: JSON.stringify(viewConfig) }),
          shouldPreload: () => card.isConnected,
          assignCommittedEngine: (engine) => { state.engine = engine; },
          onCommittedStream: (type) => { state.ready.push({ entity: state.engine.haDirectEntity, type }); },
          applyResolvedStreamUiState: (value) => { state.loading = value.loading; },
        });
        const view = { outer, dialog, card, state, mounter };
        views.push(view);
        if (context === "config") dialog.showModal();
        return view;
      };
      const mount = async (view) => view.mounter.tryMount(view.card.shadowRoot.querySelector("#engine"), null, { entity: view.state.selected });
      const view = makeView("dashboard");
      window.sessionProbe = { audit, makeView, mount, views, view, hass, anchor, config };
      await mount(view);
    }, scenario);
    await expect.poll(() => page.evaluate(() => window.sessionProbe.audit.readyEntities.size)).toBe(3);
    await expect.poll(() => page.evaluate(() => window.sessionProbe.view.state.ready.at(-1)?.type)).toBe(transport);
    await expect.poll(() => page.evaluate((type) => [...window.sessionProbe.view.state.engine.haDirectSession.records.values()]
      .every((record) => record.status === "ready" && record.streamType === type), transport)).toBe(true);
    const original = await page.evaluate(() => {
      const probe = window.sessionProbe;
      probe.session = probe.view.state.engine.haDirectSession;
      probe.originalProviders = [...probe.session.records.values()].map((record) => record.provider);
      probe.originalVideos = new Map([...probe.session.records.values()].map((record) => [
        record.entity, [...record.provider.players.values()].find((player) => !player.classList.contains("hidden")).video,
      ]));
      return probe.audit.starts;
    });
    // A still-connected dashboard card must get its exact presentation back
    // after the native editor closes, even after the editor selects a different camera.
    await page.evaluate(async () => {
      const p = window.sessionProbe;
      const editor = p.makeView("config", "camera.three");
      await p.mount(editor);
      p.editor = editor;
    });
    await expect.poll(() => page.evaluate(() => window.sessionProbe.editor.state.ready.at(-1)?.type)).toBe(transport);
    await page.evaluate(() => {
      const p = window.sessionProbe;
      p.editor.outer.remove();
      p.editor.mounter.disconnect();
      p.editor.mounter.dispose();
    });
    expect(await page.evaluate(() => window.sessionProbe.view.state.engine.haDirectEntity)).toBe("camera.one");
    for (const context of ["preconfig", "config", "preconfig", "dashboard"]) {
      await page.evaluate(async (nextContext) => {
        const probe = window.sessionProbe;
        const old = probe.view;
        old.outer.remove();
        old.mounter.disconnect();
        probe.view = probe.makeView(nextContext, "camera.two");
        await probe.mount(probe.view);
        old.mounter.dispose();
      }, context);
      await expect.poll(() => page.evaluate(() => window.sessionProbe.view.state.ready.at(-1)?.type)).toBe(transport);
      await expectRetainedSessionVideoAdvancing(page, "camera.two");
      expect(await page.evaluate(() => {
        const p = window.sessionProbe;
        return [...p.session.records.values()].every((record, index) => record.provider === p.originalProviders[index]);
      })).toBe(true);
      expect(await page.evaluate(() => window.sessionProbe.audit.providerDisconnects)).toBe(0);
      expect(await page.evaluate(() => window.sessionProbe.audit.starts)).toEqual(original);
      expect(await page.evaluate(() => window.sessionProbe.audit.verifications))
        .toEqual(scenario.supportedTypes ? ["camera.one", "camera.two", "camera.three"] : []);
      expect(await page.evaluate(() => window.sessionProbe.view.state.ready.at(-1).entity)).toBe("camera.two");
    }
    // Two independent visible cards with identical settings are not one owner.
    await page.evaluate(async () => {
      const p = window.sessionProbe;
      p.independent = p.makeView("dashboard", "camera.one", structuredClone(p.config));
      await p.mount(p.independent);
    });
    await expect.poll(() => page.evaluate(() => window.sessionProbe.independent.state.ready.at(-1)?.type)).toBe(transport);
    expect(await page.evaluate(() => {
      const p = window.sessionProbe;
      return p.independent.state.engine.haDirectSession !== p.session;
    })).toBe(true);
    // HA's edit-dialog event identifies which of the otherwise identical cards owns the preview.
    await page.evaluate(async () => {
      const p = window.sessionProbe;
      p.anchor.dispatchEvent(new CustomEvent("show-dialog", { detail: {
        dialogTag: "hui-dialog-edit-card", dialogParams: { cardConfig: p.config },
      } }));
      p.editor = p.makeView("config", "camera.two");
      await p.mount(p.editor);
    });
    expect(await page.evaluate(() => window.sessionProbe.editor.state.engine.haDirectSession === window.sessionProbe.session)).toBe(true);
    // Saving changes both the compact config object and its signature. HA may
    // attach its replacement before removing the old dashboard and preview.
    await page.evaluate(async () => {
      const p = window.sessionProbe;
      p.view.state.context = "preconfig";
      p.savedConfig = { ...p.config, title: "Saved title", display_footer: false };
      p.editor.card.dispatchEvent(new CustomEvent("frigate-view-card-config-commit", {
        detail: { previousConfig: p.config, config: p.savedConfig }, bubbles: true, composed: true,
      }));
      p.saved = p.makeView("preconfig", "camera.two", p.savedConfig);
      p.savedMount = await p.mount(p.saved);
    });
    expect(await page.evaluate(() => window.sessionProbe.savedMount.engine.haDirectSession === window.sessionProbe.session)).toBe(true);
    await page.evaluate(() => {
      const p = window.sessionProbe;
      p.editor.outer.remove();
      p.editor.mounter.dispose();
      p.view.outer.remove();
      p.view.mounter.dispose();
      p.view = p.saved;
    });
    await expect.poll(() => page.evaluate(() => window.sessionProbe.view.state.ready.at(-1)?.type)).toBe(transport);
    expect(await page.evaluate(() => window.sessionProbe.audit.providerDisconnects)).toBe(0);
    expect(await page.evaluate(() => {
      const p = window.sessionProbe;
      return [...p.session.records.values()].every((record, index) => record.provider === p.originalProviders[index]);
    })).toBe(true);
    // A failed retained camera cannot reset the other connections on editor exit.
    // The independent card warms sequentially too. Its first ready camera is
    // not a barrier for the other two: their initial starts are not reconnects.
    await expect.poll(() => page.evaluate((type) => {
      const session = window.sessionProbe.independent.state.engine.haDirectSession;
      return session.records.size === 3 && [...session.records.values()]
        .every((record) => record.status === "ready" && record.streamType === type);
    }, transport)).toBe(true);
    const startsBeforeFailure = await page.evaluate(() => window.sessionProbe.audit.starts);
    await page.evaluate(() => window.sessionProbe.audit.failCamera("camera.two"));
    await expect.poll(() => page.evaluate(() => window.sessionProbe.session.get("camera.two").status)).toBe("failed");
    await page.evaluate(() => window.sessionProbe.view.mounter.syncProviderStates());
    for (const entity of ["camera.one", "camera.three"]) {
      await expectRetainedSessionVideoAdvancing(page, entity);
    }
    // Losing HLS bypasses the failed camera's cooldown once. This fixture has
    // two independent sessions for camera.two; healthy siblings never restart.
    const startsAfterFailure = await page.evaluate(() => window.sessionProbe.audit.starts);
    expect(startsAfterFailure.slice(0, startsBeforeFailure.length)).toEqual(startsBeforeFailure);
    expect(startsAfterFailure.slice(startsBeforeFailure.length)).toEqual(scenario.webRtc === false
      ? ["ha-web-rtc-player:camera.two", "ha-web-rtc-player:camera.two"] : []);
    expect(await page.evaluate(() => window.sessionProbe.audit.providerDisconnects)).toBe(0);
    await page.evaluate(() => {
      const p = window.sessionProbe;
      p.editor.mounter.dispose();
      const independentSession = p.independent.state.engine.haDirectSession;
      p.independent.mounter.dispose();
      independentSession.dispose();
      window.sessionProbe.view.mounter.dispose();
      window.sessionProbe.session.dispose();
    });
  });
}
for (const webRtc of [true, "pending"]) {
  for (const selectedIndex of [0, 2]) {
    test(`Grid and Preview reuse every retained ${webRtc === true ? "WebRTC" : "HLS"} camera entering from ${selectedIndex + 1}`, async ({ page }) => {
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(baseUrl);
      await page.evaluate(async ({ webRtc, selectedIndex }) => {
        const { installHaCameraLifecycleFixture } = await import("/tests/fixtures/ha-camera-lifecycle.mjs");
        const audit = installHaCameraLifecycleFixture({ webRtc, supportedTypes: ["web_rtc"] });
        await import("/dist/frigate-view-card.js");
        customElements.define("tile-session-card", class extends customElements.get("frigate-view-card") {
          connectedCallback() {}
          disconnectedCallback() {}
        });
        const anchor = document.createElement("home-assistant");
        anchor.attachShadow({ mode: "open" });
        document.body.append(anchor);
        const card = document.createElement("tile-session-card");
        const entities = ["camera.one", "camera.two", "camera.three", "camera.four", "camera.five"];
        card.setConfig({
          cameras: entities.map((entity) => ({ entity, connection_type: "ha_direct" })),
          grid_mode_enabled: true, grid_live_view_enabled: true,
          preview_page_enabled: true, preview_page_live_cameras: true,
        });
        card._hass = { connection: {}, callWS: audit.callWS, states: Object.fromEntries(
          entities.map((entity_id) => [entity_id, { entity_id, state: "idle", attributes: {} }]),
        ) };
        card._streamFallbackUrl = async () => "";
        card._activeCamIdx = selectedIndex;
        card._started = true;
        anchor.shadowRoot.append(card);
        card._renderShell();
        await card._haDirectMounter.tryMount(card.shadowRoot.querySelector("#engine"), null, { entity: entities[selectedIndex] });
        window.tileProbe = { card, audit, entities, anchor, session: card._engine.haDirectSession };
        await card._gridFeatureController.prepare();
        await card._previewPageController.prepare();
      }, { webRtc, selectedIndex });
      await expect.poll(() => page.evaluate(() => [...window.tileProbe.session.records.values()]
        .filter((record) => record.status === "ready").length)).toBe(5);
      const starts = await page.evaluate(() => {
        const p = window.tileProbe;
        p.providers = [...p.session.records.values()].map((record) => record.provider);
        return p.audit.starts;
      });
      for (const gridStart of [0, 4, 0]) {
        await page.evaluate((start) => {
          const { card } = window.tileProbe;
          card._gridPageController.prepareLiveForGrid();
          card._viewMode = "grid";
          card._gridRotationStart = start;
          card._gridMediaController.mountGridEngine(card.shadowRoot.querySelector("#grid-engine"));
        }, gridStart);
        await expect.poll(() => page.evaluate(() => {
          const { card, session } = window.tileProbe;
          return [...card.shadowRoot.querySelectorAll('.live-grid[aria-hidden="false"] .live-grid-cell[data-grid-entity]')]
            .filter((cell) => {
              const provider = session.get(cell.dataset.gridEntity)?.provider;
              const bounds = provider?.getBoundingClientRect();
              const target = cell.getBoundingClientRect();
              return cell.querySelector(".preview-live-layer.is-ready") && bounds?.width > 0 &&
                Math.abs(bounds.left - target.left) < 3 && Math.abs(bounds.top - target.top) < 3 &&
                Math.abs(bounds.width - target.width) < 3;
            }).length;
        })).toBe(gridStart === 0 ? 4 : 1);
        expect(await page.evaluate(() => window.tileProbe.audit.starts)).toEqual(starts);
      }
      await page.evaluate(() => {
        const { card } = window.tileProbe;
        card._gridMediaController.teardownGridEngine();
        card._gridPageController.restoreLiveAfterGrid();
        card._viewMode = "single";
        card._pageId = "preview";
        card._renderShellPreserveLive();
        card._previewPageController.renderPreviewPage();
      });
      await expect.poll(() => page.evaluate(() => {
        const { card, session } = window.tileProbe;
        return [...card.shadowRoot.querySelectorAll(".preview-media-host[data-preview-media-entity]")]
          .filter((cell) => {
            const bounds = session.get(cell.dataset.previewMediaEntity)?.provider.getBoundingClientRect();
            const target = cell.getBoundingClientRect();
            return cell.querySelector(".preview-live-layer.is-ready") && bounds?.width > 0 &&
              Math.abs(bounds.left - target.left) < 3 && Math.abs(bounds.top - target.top) < 3 &&
              Math.abs(bounds.width - target.width) < 3;
          }).length;
      })).toBe(5);
      const time = await page.evaluate(() => window.tileProbe.session.get("camera.three").video.currentTime);
      await expect.poll(() => page.evaluate(() => window.tileProbe.session.get("camera.three").video.currentTime)).toBeGreaterThan(time + 0.15);
      await page.evaluate(async () => {
        const { card, entities } = window.tileProbe;
        card._previewPageController.stopPreviewMode();
        card._pageId = "single-view";
        card._renderShellPreserveLive();
        await card._haDirectMounter.tryMount(card.shadowRoot.querySelector("#engine"), null, { entity: entities[card._activeCamIdx] });
      });
      expect(await page.evaluate(() => window.tileProbe.audit.starts)).toEqual(starts);
      expect(await page.evaluate(() => window.tileProbe.audit.providerDisconnects)).toBe(0);
      expect(await page.evaluate(() => {
        const p = window.tileProbe;
        return [...p.session.records.values()].every((record, index) => record.provider === p.providers[index]);
      })).toBe(true);
      expect(errors).toEqual([]);
      await page.evaluate(() => {
        window.tileProbe.card._haDirectMounter.dispose();
        window.tileProbe.session.dispose();
      });
    });
  }
}

for (const webRtc of [true, "pending"]) {
  test(`Wide companions leave retained ${webRtc === true ? "WebRTC" : "HLS"} in the main view when selecting cameras`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(baseUrl);
    await page.evaluate(async (webRtc) => {
      const { installHaCameraLifecycleFixture } = await import("/tests/fixtures/ha-camera-lifecycle.mjs");
      const audit = installHaCameraLifecycleFixture({ webRtc, supportedTypes: ["web_rtc"] });
      await import("/dist/frigate-view-card.js");
      customElements.define("wide-session-card", class extends customElements.get("frigate-view-card") {
        connectedCallback() {}
        disconnectedCallback() {}
      });
      const anchor = document.createElement("home-assistant");
      anchor.attachShadow({ mode: "open" });
      document.body.append(anchor);
      const card = document.createElement("wide-session-card");
      const entities = ["camera.one", "camera.two", "camera.three"];
      card.setConfig({ cameras: entities.map((entity) => ({ entity, connection_type: "ha_direct" })),
        wide_view_page_enabled: true, wide_view_live_cameras: true,
        snapshot_update_seconds: 2, show_calendar_button: false,
      });
      card._hass = { connection: {}, callWS: audit.callWS, states: Object.fromEntries(
        entities.map((entity_id) => [entity_id, { entity_id, state: "idle", attributes: {} }]),
      ) };
      card._streamFallbackUrl = async (entity) => `/snapshot.svg?entity=${entity}`;
      card._activeCamIdx = 0;
      card._started = true;
      for (const entity of entities) card._camCache[entity] = { discovered: true, events: [], reviews: [], recordings: [], kept: [] };
      anchor.shadowRoot.append(card);
      card._renderShell();
      await card._haDirectMounter.tryMount(card.shadowRoot.querySelector("#engine"), null, { entity: entities[0] });
      window.wideProbe = { card, audit, entities, session: card._engine.haDirectSession };
    }, webRtc);
    await expect.poll(() => page.evaluate(() => [...window.wideProbe.session.records.values()]
      .filter((record) => record.status === "ready").length)).toBe(3);
    const starts = await page.evaluate(() => {
      const p = window.wideProbe;
      p.providers = p.entities.map((entity) => p.session.get(entity).provider);
      // Keep the async transition rooted while the browser driver awaits it.
      p.wideTransition = (async () => {
        await p.card._wideViewPageController.prepare();
        p.card._pageId = "wide-view";
        p.card._renderShellPreserveLive();
        return [...p.audit.starts];
      })();
      return p.wideTransition;
    });
    for (const selected of [0, 1, 2, 0]) {
      if (selected !== 0 || await page.evaluate(() => window.wideProbe.card._activeCamIdx !== 0)) {
        await page.evaluate(async (index) => {
          await window.wideProbe.card._switchCamera(index, { skipBrowseLoad: true });
        }, selected);
      }
      await expect.poll(() => page.evaluate((index) => {
        const { card, session, entities } = window.wideProbe;
        const mediaHosts = [...card.shadowRoot.querySelectorAll(".wide-companion-media-host")];
        if (mediaHosts.length !== 3) return false;
        return entities.every((entity, cameraIndex) => {
          const record = session.get(entity);
          const companion = mediaHosts.find((host) => host.dataset.wideCompanionMediaEntity === entity);
          const isSelected = cameraIndex === index;
          if (companion.dataset.wideCompanionUseLive !== (isSelected ? "0" : "1")) return false;
          if (isSelected && (!companion.querySelector("img") || companion.querySelector("slot"))) return false;
          const bounds = record.provider.getBoundingClientRect();
          const target = (isSelected ? card.shadowRoot.querySelector("#eng-wrap") : companion).getBoundingClientRect();
          return bounds.width > 0 && Math.abs(bounds.left - target.left) < 3 &&
            Math.abs(bounds.top - target.top) < 3 && Math.abs(bounds.width - target.width) < 3;
        }) && card._engine === session.get(entities[index]).provider;
      }, selected)).toBe(true);
      expect(await page.evaluate(() => window.wideProbe.card._activeStreamType)).toBe(webRtc === true ? "webrtc" : "hls");
      expect(await page.evaluate(() => window.wideProbe.audit.starts)).toEqual(starts);
      expect(await page.evaluate(() => window.wideProbe.audit.providerDisconnects)).toBe(0);
    }
    // The configured refresh timer must run even with live companions enabled.
    await expect.poll(() => page.evaluate(() => window.wideProbe.card.shadowRoot
      .querySelector('.wide-companion-media-host[data-wide-companion-use-live="0"] img')?.src.includes("fvc_snapshot=")))
      .toBe(true);
    const time = await page.evaluate(() => window.wideProbe.session.get("camera.one").video.currentTime);
    await expect.poll(() => page.evaluate(() => window.wideProbe.session.get("camera.one").video.currentTime)).toBeGreaterThan(time + 0.15);
    expect(await page.evaluate(() => {
      const p = window.wideProbe;
      return p.entities.every((entity, index) => p.session.get(entity).provider === p.providers[index]);
    })).toBe(true);
    expect(errors).toEqual([]);
    await page.evaluate(() => {
      const p = window.wideProbe;
      p.card._wideViewCompanionController.stop();
      p.card._haDirectMounter.dispose();
      p.session.dispose();
    });
  });
}

for (const initialPage of ["grid", "preview"]) {
  test(`cold ${initialPage} starts HA cameras sequentially without a main-view connection`, async ({ page }) => {
    await page.goto(baseUrl);
    await page.evaluate(async (initialPage) => {
      const { installHaCameraLifecycleFixture } = await import("/tests/fixtures/ha-camera-lifecycle.mjs");
      const audit = installHaCameraLifecycleFixture({ webRtc: "pending", supportedTypes: ["web_rtc"] });
      await import("/dist/frigate-view-card.js");
      customElements.define("cold-tile-card", class extends customElements.get("frigate-view-card") {
        connectedCallback() {}
        disconnectedCallback() {}
      });
      const anchor = document.createElement("home-assistant");
      anchor.attachShadow({ mode: "open" });
      document.body.append(anchor);
      const card = document.createElement("cold-tile-card");
      const entities = ["camera.one", "camera.two", "camera.three"];
      card.setConfig({ cameras: entities.map((entity) => ({ entity, connection_type: "ha_direct" })),
        grid_mode_enabled: true, grid_live_view_enabled: true,
        preview_page_enabled: true, preview_page_live_cameras: true,
      });
      card._hass = { connection: {}, callWS: audit.callWS, states: Object.fromEntries(
        entities.map((entity_id) => [entity_id, { entity_id, state: "idle", attributes: {} }]),
      ) };
      card._streamFallbackUrl = async () => "";
      card._started = true;
      anchor.shadowRoot.append(card);
      card._renderShell();
      window.coldProbe = { card, audit, anchor };
      if (initialPage === "grid") {
        await card._gridFeatureController.prepare();
        card._viewMode = "grid";
        card._gridMediaController.mountGridEngine(card.shadowRoot.querySelector("#grid-engine"));
      } else {
        await card._previewPageController.prepare();
        card._pageId = "preview";
        card._renderShellPreserveLive();
        card._previewPageController.renderPreviewPage();
      }
    }, initialPage);
    await expect.poll(() => page.evaluate(() => window.coldProbe.card.shadowRoot
      .querySelectorAll(".preview-live-layer.is-ready").length)).toBe(3);
    expect(await page.evaluate(() => {
      const starts = window.coldProbe.audit.startReadiness;
      return starts.filter((start) => start.entity === "camera.two").every((start) => start.ready.includes("camera.one")) &&
        starts.filter((start) => start.entity === "camera.three").every((start) => start.ready.includes("camera.two"));
    })).toBe(true);
    expect(await page.evaluate(() => window.coldProbe.audit.verifications)).toEqual(["camera.one", "camera.two", "camera.three"]);
    expect(await page.evaluate(() => window.coldProbe.audit.providerDisconnects)).toBe(0);
    await page.evaluate(() => {
      const { card, anchor } = window.coldProbe;
      const session = anchor.querySelector("ha-camera-stream").haDirectSession;
      card._haDirectMounter.dispose();
      session.dispose();
    });
  });
}

test.afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test("advancing video survives page, pre-editor and native-modal replacements without a disconnect", async ({ page }) => {
  let mediaRequests = 0;
  page.on("request", (request) => { if (request.url().endsWith("/media.mp4")) mediaRequests += 1; });
  await page.goto(baseUrl);
  await page.evaluate(async () => {
    const { createStationaryMediaProjection } = await import("/projection.js");
    const events = [];
    const host = (parent) => {
      const element = document.createElement("div");
      element.attachShadow({ mode: "open" });
      parent.append(element);
      return element;
    };
    const anchor = host(document.body);
    const projection = createStationaryMediaProjection({ anchor, name: "test-camera-session" });
    customElements.define("lifecycle-probe-player", class extends HTMLElement {
      connectedCallback() { events.push("connect"); }
      disconnectedCallback() { events.push("disconnect"); this.firstElementChild.pause(); }
    });
    const provider = document.createElement("lifecycle-probe-player");
    provider.style.cssText = "display:block;width:100%;height:100%";
    const video = document.createElement("video");
    video.style.cssText = "width:100%;height:100%;object-fit:cover";
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.src = "/media.mp4";
    provider.append(video);
    projection.deck.append(provider);
    const createView = ({ modal = false } = {}) => {
      const outer = host(anchor.shadowRoot);
      const dialog = document.createElement(modal ? "dialog" : "div");
      outer.shadowRoot.append(dialog);
      const card = host(dialog);
      card.shadowRoot.innerHTML = `<style>
        #stage {position:relative;width:320px;height:180px;overflow:hidden;border-radius:12px}
        button {position:absolute;right:0;top:0;z-index:5}
      </style><div id="stage"><slot name="live"></slot><button>Mute</button></div>`;
      card.shadowRoot.querySelector("button").onclick = () => { video.muted = !video.muted; events.push("control"); };
      projection.project(card.shadowRoot.querySelector("slot"));
      if (modal) dialog.showModal();
      return { outer, dialog, card };
    };
    window.probe = { anchor, projection, provider, video, events, createView, view: createView() };
    await video.play();
  });
  await expect.poll(() => page.evaluate(() => window.probe.video.currentTime)).toBeGreaterThan(0.15);
  const initialRequests = mediaRequests;
  for (const phase of ["mobile", "wide", "pre-editor", "editor", "leave-editor", "leave-pre-editor"]) {
    const time = await page.evaluate((phaseName) => {
      const probe = window.probe;
      const previous = probe.view;
      // Remove the old card first, as HA can do during preview replacement.
      previous.outer.remove();
      probe.view = probe.createView({ modal: phaseName === "editor" });
      return probe.video.currentTime;
    }, phase);
    await expect.poll(() => page.evaluate(() => window.probe.video.currentTime)).toBeGreaterThan(time + 0.15);
    const state = await page.evaluate(() => {
      const { provider, video, projection, events, view } = window.probe;
      const rect = video.getBoundingClientRect();
      return {
        sameParent: provider.parentElement === projection.deck,
        connected: provider.isConnected,
        events, width: rect.width, height: rect.height,
        stageWidth: view.card.shadowRoot.querySelector("#stage").getBoundingClientRect().width,
      };
    });
    expect(state.events).toEqual(["connect"]);
    expect(state.sameParent).toBe(true);
    expect(state.connected).toBe(true);
    expect(state.width).toBe(state.stageWidth);
    expect(state.height).toBe(180);
  }
  await page.evaluate(() => {
    const { view } = window.probe;
    // HA may rerender a relay host's light DOM without removing the card.
    view.card.querySelector("slot").remove();
  });
  await expect.poll(() => page.evaluate(() => window.probe.video.getBoundingClientRect().width)).toBe(320);
  expect(mediaRequests).toBe(initialRequests);
  await page.getByRole("button", { name: "Mute" }).click();
  expect(await page.evaluate(() => window.probe.events)).toEqual(["connect", "control"]);
  await page.evaluate(() => window.probe.projection.dispose());
  expect(await page.evaluate(() => window.probe.events)).toEqual(["connect", "control", "disconnect"]);
});
