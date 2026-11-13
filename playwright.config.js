import { defineConfig } from "@playwright/test";

// CHROME_PATH erlaubt einen vorhandenen Chrome statt des von Playwright geladenen Chromium.
const executablePath = process.env.CHROME_PATH || undefined;

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:8765",
    viewport: { width: 1300, height: 950 },
    launchOptions: executablePath ? { executablePath, args: ["--no-sandbox"] } : {},
    trace: "retain-on-failure",
    serviceWorkers: "block", // Tests sollen immer die aktuellen Dateien sehen, nicht den Offline-Zwischenspeicher
  },
  webServer: {
    command: "node tests/server.mjs",
    url: "http://localhost:8765",
    reuseExistingServer: !process.env.CI,
  },
});
