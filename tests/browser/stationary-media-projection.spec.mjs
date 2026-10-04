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
    if (pathname.startsWith("/src/") || pathname.startsWith("/tests/fixtures/")) {
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
    } else {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><html><body></body></html>");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

for (const transport of ["hls", "webrtc"]) {
  test(`HA Direct session retains ${transport} through replaced card/editor clients`, async ({ page }) => {
    await page.goto(baseUrl);
    await page.evaluate(async (transportName) => {
      const { installHaCameraLifecycleFixture } = await import("/tests/fixtures/ha-camera-lifecycle.mjs");
      const audit = installHaCameraLifecycleFixture({ webRtc: transportName === "webrtc" });
      const { createHaDirectProviderMounter } = await import("/src/features/live/ha-direct-provider-mounter.js");
      const anchor = document.createElement("home-assistant");
      anchor.attachShadow({ mode: "open" });
      document.body.append(anchor);
      const entities = ["camera.one", "camera.two", "camera.three"];
      const hass = { connection: {}, states: Object.fromEntries(entities.map((entity_id) => [entity_id, { entity_id, attributes: {} }])) };
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
    }, transport);
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
