import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;

/**
 * End-to-end tests run against a production build (`next build && next start`).
 * Speech synthesis is faked in the browser (see e2e/fixtures.ts), so no audio
 * is produced and playback is deterministic. /api/extract is mocked per test.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    // Keep the speech/highlight timing stable regardless of animations.
    reducedMotion: "reduce",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "npm run build && npm run start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: "ignore",
    stderr: "pipe",
    env: { PORT: String(PORT) },
  },
});
