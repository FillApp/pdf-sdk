import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PDF_SDK_VISUAL_PORT || 4567);

export default defineConfig({
  testDir: "./test/visual",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "dot" : "list",
  expect: {
    toHaveScreenshot: {
      // Baselines are the source of truth; accept small sub-pixel differences
      // that come from minor font hinting variation. Tighten if it causes
      // regressions to slip through.
      maxDiffPixelRatio: 0.002,
    },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "node test/visual/server.cjs",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
