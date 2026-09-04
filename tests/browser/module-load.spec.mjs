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
        card_view_standalone: false,
        card_view_view_mode: "video-only",
      });
      card._pageId = "card-view";
      card._switchCamera = async (index) => {
        card.dataset.selectedCamera = String(index);
        card._activeCamIdx = index;
        card._mobileCamSwitcherOpen = false;
        card._renderCamSwitcher();
      };
      card._renderShell();
    });

    const card = page.locator("frigate-view-card");
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
});
