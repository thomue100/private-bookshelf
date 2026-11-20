import { defineConfig } from "@playwright/test";

// Auswertung mit echten Fach-Fotos (npm run eval) – echtes Internet, eigener Ordner, läuft nicht bei npm test.
const executablePath = process.env.CHROME_PATH || undefined;
export default defineConfig({
  testDir: "./evalrun",
  timeout: 60 * 60_000,
  reporter: "list",
  use: {
    baseURL: "http://localhost:8765",
    viewport: { width: 1300, height: 950 },
    launchOptions: executablePath ? { executablePath, args: ["--no-sandbox"] } : {},
    serviceWorkers: "block",
  },
  webServer: { command: "node tests/server.mjs", url: "http://localhost:8765", reuseExistingServer: true },
});
