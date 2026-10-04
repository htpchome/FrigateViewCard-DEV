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
      response.writeHead(200, { "content-type": "video/mp4", "content-length": movie.length });
      response.end(movie);
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

const scenarios = [
  { name: "hls", transport: "hls", webRtc: false },
  { name: "webrtc", transport: "webrtc", webRtc: true },
  { name: "verified HLS with pending WebRTC-only ICE", transport: "hls", webRtc: "pending", supportedTypes: ["web_rtc"] },
  { name: "verified HLS with failed WebRTC-only ICE", transport: "hls", webRtc: false, supportedTypes: ["web_rtc"] },
];

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const state = await page.evaluate(() => {
    const probe = window.bundleProbe;
    if (!probe) return null;
    return {
      starts: probe.audit.startReadiness,
      records: [...(probe.card._engine?.haDirectSession?.records.values() || [])].map((record) => ({
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

for (const scenario of scenarios) {
  const { transport } = scenario;
  test(`production bundle starts and retains the HA Direct ${scenario.name} session`, async ({ page }) => {
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
      card.setConfig({ cameras: [
        { entity: "camera.one", connection_type: "ha_direct" },
        { entity: "camera.two", connection_type: "ha_direct" },
      ] });
      card._hass = { connection: {}, callWS: audit.callWS, states: Object.fromEntries(
        ["camera.one", "camera.two"].map((entity_id) => [entity_id, { entity_id, state: "idle", attributes: {} }]),
      ) };
      card._activeCamIdx = 0;
      card._started = true;
      anchor.shadowRoot.append(card);
      card._renderShell();
      window.bundleProbe = { card, audit };
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
      await page.evaluate(() => window.bundleProbe.audit.releaseWebRtc());
      await expect.poll(() => page.evaluate(() => window.bundleProbe.card._activeStreamType)).toBe("webrtc");
      expect(await page.evaluate(() => window.bundleProbe.card._engine === window.bundleProbe.first)).toBe(true);
      expect(await page.evaluate(() => window.bundleProbe.audit.starts)).toEqual(starts);
      await expect.poll(() => page.evaluate(() => [...window.bundleProbe.session.records.values()]
        .every((record) => record.provider.players.size === 1 && record.provider.players.has("web_rtc")))).toBe(true);
    }
    expect(errors).toEqual([]);
    await page.evaluate(() => {
      window.bundleProbe.card._haDirectMounter.dispose();
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
    const original = await page.evaluate(() => {
      const probe = window.sessionProbe;
      probe.session = probe.view.state.engine.haDirectSession;
      probe.originalProviders = [...probe.session.records.values()].map((record) => record.provider);
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
      const time = await page.evaluate(() => window.sessionProbe.session.get("camera.two").video.currentTime);
      await expect.poll(() => page.evaluate(() => window.sessionProbe.session.get("camera.two").video.currentTime)).toBeGreaterThan(time + 0.15);
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
    const starts = await page.evaluate(async () => {
      const p = window.wideProbe;
      p.providers = p.entities.map((entity) => p.session.get(entity).provider);
      await p.card._wideViewPageController.prepare();
      p.card._pageId = "wide-view";
      p.card._renderShellPreserveLive();
      return [...p.audit.starts];
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
