import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: true,
  reporter: "line",
  use: {
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /iphone-start-unmuted\.spec\.mjs/,
      use: { browserName: "chromium" },
    },
    {
      name: "firefox",
      testIgnore: /iphone-start-unmuted\.spec\.mjs/,
      use: { browserName: "firefox" },
    },
    {
      name: "webkit",
      testIgnore: /iphone-start-unmuted\.spec\.mjs/,
      use: { browserName: "webkit" },
    },
    {
      name: "iphone-webkit",
      testMatch: /iphone-start-unmuted\.spec\.mjs/,
      use: {
        ...devices["iPhone 15 Pro"],
        browserName: "webkit",
      },
    },
  ],
});
