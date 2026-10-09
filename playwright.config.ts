import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.E2E_BASE_URL;

/**
 * LOCAL DETERMINISTIC MODE (the default for `npx playwright test`).
 *
 * Unless a run targets a real environment — a deployed site (E2E_BASE_URL) or
 * the staging runner (scripts/staging/run-e2e.mjs sets E2E_SUPABASE_URL) —
 * the app under test is pointed at a dead local Supabase address, NOT at the
 * project in .env.local. Nothing a test does can reach a real project:
 *
 *  - the browser's Supabase calls are answered in-page (e2e/customer-stub.ts);
 *  - the server's Supabase calls are answered by a local stand-in started in
 *    e2e/global-setup.ts (e2e/supabase-http-stub.ts), so server-rendered
 *    pages and site settings resolve deterministically instead of failing
 *    with ECONNREFUSED;
 *  - the dev server uses its own port and build folder, so it can run beside
 *    a developer's normal `npm run dev`.
 */
// E2E_STUB_SUPABASE_PORT lets a second stub-mode run (own E2E_PORT and
// NEXT_DIST_DIR) start its own stand-in beside one that is already running.
export const STUB_SUPABASE_URL = `http://127.0.0.1:${Number(process.env.E2E_STUB_SUPABASE_PORT) || 54399}`;
const localStubMode = !externalBaseUrl && !process.env.E2E_SUPABASE_URL;
if (localStubMode) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = STUB_SUPABASE_URL;
  process.env.NEXT_DIST_DIR ||= ".next/e2e-stub";
  process.env.E2E_FRESH_SERVER ||= "1";
  process.env.E2E_PORT ||= "3105";
}

// The staging runner uses its own port and a FRESH server, so it can never
// reuse a dev server configured for another Supabase project.
const port = Number(process.env.E2E_PORT || 3000);
// E2E_REUSE_SERVER=1 reuses an already running stub server on the same port
// (faster local iteration); it is never the default.
const freshServer = process.env.E2E_FRESH_SERVER === "1" && process.env.E2E_REUSE_SERVER !== "1";
const baseURL = externalBaseUrl || `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  globalSetup: localStubMode ? "./e2e/global-setup.ts" : undefined,
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
        command: process.env.E2E_SERVER_COMMAND || (process.env.E2E_FRESH_SERVER === "1" ? `node --max-http-header-size=65536 node_modules/next/dist/bin/next dev -H 127.0.0.1 -p ${port}` : "npm run dev"),
        // A readiness probe that touches no database: the server-side Supabase
        // stand-in (global setup) starts after the web server is up.
        url: `${baseURL}/api/health`,
        reuseExistingServer: !freshServer,
        timeout: 300_000,
      },
});
