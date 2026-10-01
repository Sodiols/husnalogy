import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.E2E_BASE_URL;
// The staging runner (scripts/staging/run-e2e.mjs) uses its own port and a
// FRESH server, so it can never reuse a dev server configured for another
// Supabase project.
const port = Number(process.env.E2E_PORT || 3000);
const freshServer = process.env.E2E_FRESH_SERVER === "1";
const baseURL = externalBaseUrl || `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Focused Safari/WebKit coverage for the critical customer paths only —
    // the full suite stays on Chromium so CI time does not double. WebKit is
    // the closest available engine to iPhone/desktop Safari; a physical device
    // check remains a separate manual launch step.
    {
      name: "webkit",
      testMatch: /webkit-critical\.spec\.ts/,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-safari",
      testMatch: /webkit-critical\.spec\.ts/,
      use: { ...devices["iPhone 13"] },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        // E2E_SERVER_COMMAND runs e.g. a production build (`next start`) under
        // the Node version on PATH, for release validation.
        command: process.env.E2E_SERVER_COMMAND || (freshServer ? `node --max-http-header-size=65536 node_modules/next/dist/bin/next dev -H 127.0.0.1 -p ${port}` : "npm run dev"),
        url: baseURL,
        reuseExistingServer: !freshServer,
        timeout: 300_000,
      },
});
