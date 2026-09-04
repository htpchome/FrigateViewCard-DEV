import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const bundlePaths = new Map([
  ["/frigate-view-card.js", "dist/frigate-view-card.js"],
  ["/frigate-view-card-editor.js", "dist/frigate-view-card-editor.js"],
  ["/frigate-view-card-hls-1.5.17.js", "dist/frigate-view-card-hls-1.5.17.js"],
]);

let server;
let baseUrl;

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end("<!doctype html><html><body></body></html>");
        return;
      }

      const bundlePath = bundlePaths.get(pathname);
      if (!bundlePath) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const source = await readFile(bundlePath);
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/javascript; charset=utf-8",
      });
      response.end(source);
    } catch (error) {
      response.writeHead(500);
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine the browser-test server address.");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("loads the runtime and editor modules", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(baseUrl);
  const registrations = await page.evaluate(async () => {
    await import("/frigate-view-card.js");
    await import("/frigate-view-card-editor.js");
    return {
      card: Boolean(customElements.get("frigate-view-card")),
      editor: Boolean(customElements.get("frigate-view-card-editor")),
    };
  });

  expect(registrations).toEqual({ card: true, editor: true });
  expect(pageErrors).toEqual([]);
});

test("loads the generated HLS browser bundle", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(baseUrl);
  await page.addScriptTag({ url: `${baseUrl}/frigate-view-card-hls-1.5.17.js` });

  expect(await page.evaluate(() => typeof window.Hls)).toBe("function");
  expect(pageErrors).toEqual([]);
});

test.describe("touch input", () => {
  test.use({
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) " +
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 " +
      "Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844 },
  });

  test("opens and selects from the Card View video-overlay camera picker", async ({
    page,
  }) => {
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(baseUrl);
    await page.evaluate(async () => {
      await import("/frigate-view-card.js");
      const card = document.createElement("frigate-view-card");
      document.body.style.margin = "0";
      document.body.append(card);
      card.setConfig({
        cameras: [
          { entity: "camera.front", name: "Front" },
          { entity: "camera.back", name: "Back" },
        ],
        card_view_page_enabled: true,
        mobile_page: "card-view",
        card_view_view_mode: "video-only",
      });
      card._pageNavigationController.prepareConfiguredLandingPageShell();
      card._switchCamera = async (index) => {
        card.dataset.selectedCamera = String(index);
        card._activeCamIdx = index;
        card._mobileCamSwitcherOpen = false;
        card._renderCamSwitcher();
      };
    });

    const card = page.locator("frigate-view-card");
    await expect(card.locator("#card")).toHaveClass(/card-view-active/);
    await expect(card.locator(".card-view-camera-row")).toHaveCSS(
      "overflow-x",
      "visible",
    );
    const trigger = card.locator("[data-mobile-cam-trigger]");
    await expect(trigger).toBeVisible();
    await trigger.tap();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    const secondCamera = card.locator('[data-mobile-camidx="1"]');
    await expect(secondCamera).toBeVisible();
    await secondCamera.tap();
    await expect(card).toHaveAttribute("data-selected-camera", "1");
    await expect(card.locator("[data-mobile-cam-trigger]")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(pageErrors).toEqual([]);
  });

  test("opens and selects from the routed Card View header camera picker", async ({
    page,
  }) => {
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(baseUrl);
    await page.evaluate(async () => {
      await import("/frigate-view-card.js");
      const card = document.createElement("frigate-view-card");
      document.body.style.margin = "0";
      document.body.append(card);
      card.setConfig({
        cameras: [
          { entity: "camera.front", name: "Front" },
          { entity: "camera.back", name: "Back" },
        ],
        card_view_page_enabled: true,
        mobile_page: "card-view",
        card_view_view_mode: "bottom-panel-open",
      });
      card._pageNavigationController.prepareConfiguredLandingPageShell();
      card._switchCamera = async (index) => {
        card.dataset.selectedCamera = String(index);
        card._activeCamIdx = index;
        card._mobileCamSwitcherOpen = false;
        card._renderCamSwitcher();
      };
    });

    const card = page.locator("frigate-view-card");
    await expect(card.locator("#card")).toHaveClass(/card-view-active/);
    await expect(card.locator(".card-view-camera-row")).toHaveCSS(
      "overflow-x",
      "visible",
    );
    const trigger = card.locator("[data-mobile-cam-trigger]");
    await expect(trigger).toBeVisible();
    await trigger.tap();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    await card.locator('[data-mobile-camidx="1"]').tap();
    await expect(card).toHaveAttribute("data-selected-camera", "1");
    await expect(card.locator("[data-mobile-cam-trigger]")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(pageErrors).toEqual([]);
  });

  test("does not let the Video Only camera row block grouped-camera controls", async ({
    page,
  }) => {
    await page.goto(baseUrl);
    const hitTarget = await page.evaluate(async () => {
      await import("/frigate-view-card.js");
      const card = document.createElement("frigate-view-card");
      document.body.style.margin = "0";
      document.body.append(card);
      card.setConfig({
        cameras: [
          {
            entity: "camera.front",
            name: "Front / Back",
            group: {
              secondary_entity: "camera.back",
              layout: "stacked",
            },
          },
        ],
        card_view_page_enabled: true,
        card_view_view_mode: "video-only",
      });
      card._pageId = "card-view";
      card._renderShell();

      const root = card.shadowRoot;
      const wrap = root.querySelector("#eng-wrap");
      const secondaryPane = root.querySelector(
        '.camera-group-live-pane[data-camera-group-member="B"]',
      );
      wrap.classList.remove("camera-group-mobile-member");
      wrap.classList.add("camera-group-live", "camera-group-live--stacked");
      secondaryPane.hidden = false;
      secondaryPane.classList.add("is-ready");
      card._cameraGroupLiveController.setActiveAudioMember = (member) => {
        card.dataset.selectedAudioMember = member;
      };
      card._cameraGroupLiveController.toggleFocusedMember = (member) => {
        card.dataset.focusedMember = member;
        return true;
      };

      return [
        '[data-camera-group-audio="A"]',
        '[data-camera-group-focus="A"]',
      ].map((selector) => {
        const button = root.querySelector(selector);
        const rect = button.getBoundingClientRect();
        const hit = root.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return hit?.closest?.(selector) === button;
      });
    });

    expect(hitTarget).toEqual([true, true]);
    const card = page.locator("frigate-view-card");
    await card.locator('[data-camera-group-audio="A"]').tap();
    await expect(card).toHaveAttribute("data-selected-audio-member", "A");
    await card.locator('[data-camera-group-focus="A"]').tap();
    await expect(card).toHaveAttribute("data-focused-member", "A");
  });

  test("keeps the Mobile View grouped-camera toggle on the touch surface", async ({
    page,
  }) => {
    await page.goto(baseUrl);
    const hitTarget = await page.evaluate(async () => {
      await import("/frigate-view-card.js");
      const card = document.createElement("frigate-view-card");
      document.body.style.margin = "0";
      document.body.append(card);
      card.setConfig({
        cameras: [
          {
            entity: "camera.front",
            name: "Front / Back",
            group: { secondary_entity: "camera.back" },
          },
        ],
        mobile_view_page_enabled: true,
      });
      card._pageId = "mobile-view";
      card._renderShell();

      const root = card.shadowRoot;
      const wrap = root.querySelector("#eng-wrap");
      wrap.classList.add("camera-group-mobile-member");
      card._cameraGroupLiveController.toggleMobileMember = () => {
        card.dataset.mobileGroupToggled = "true";
        return true;
      };
      const button = root.querySelector("[data-camera-group-mobile-toggle]");
      const rect = button.getBoundingClientRect();
      const hit = root.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return {
        visible: rect.width > 0 && rect.height > 0,
        hitToggle: Boolean(
          hit?.closest?.("[data-camera-group-mobile-toggle]"),
        ),
        hitClass: hit?.className || "",
      };
    });

    expect(hitTarget).toEqual({
      visible: true,
      hitToggle: true,
      hitClass: expect.any(String),
    });
    const card = page.locator("frigate-view-card");
    await card.locator("[data-camera-group-mobile-toggle]").tap();
    await expect(card).toHaveAttribute("data-mobile-group-toggled", "true");
  });

  test("keeps the normal Card View header in standalone Bottom Panel mode", async ({
    page,
  }) => {
    await page.goto(baseUrl);
    const state = await page.evaluate(async () => {
      await import("/frigate-view-card.js");
      const card = document.createElement("frigate-view-card");
      document.body.append(card);
      card.setConfig({
        cameras: [
          { entity: "camera.front", name: "Front" },
          { entity: "camera.back", name: "Back" },
        ],
        card_view_page_enabled: true,
        card_view_standalone: true,
        card_view_view_mode: "bottom-panel-open",
      });
      card._pageId = "card-view";
      card._renderShell();
      const cardRoot = card.shadowRoot.querySelector("#card");
      const cameraRow = card.shadowRoot.querySelector(
        ".card-view-camera-row",
      );
      return {
        standalone: cardRoot.classList.contains("card-view-standalone"),
        overlay: cardRoot.classList.contains(
          "card-view-overlay-presentation",
        ),
        videoOnly: cardRoot.classList.contains("card-view-video-panel-only"),
        cameraRowPosition: getComputedStyle(cameraRow).position,
        cameraStatusVisible: Boolean(
          cameraRow.querySelector(".mobile-cam-picker__status"),
        ),
      };
    });

    expect(state).toEqual({
      standalone: true,
      overlay: false,
      videoOnly: false,
      cameraRowPosition: "relative",
      cameraStatusVisible: true,
    });
  });
});
