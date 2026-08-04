import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.E2E_BASE_URL;
const baseURL = externalBaseUrl || "http://127.0.0.1:3000";

// Browser coverage (spec §41). The customizer is a canvas + pointer-events
// heavy editor, so WebKit and a real mobile profile matter as much as Chrome.
//
// Tests that genuinely cannot run on a touch profile opt out with
// `test.skip(({ isMobile }) => isMobile, "<reason>")` inside the spec — never
// by removing them from the matrix here.
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
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    // Modern iPhone (WebKit) and Android (Chromium) profiles. Both report
    // isMobile/hasTouch so touch paths are exercised, not just a narrow window.
    { name: "iphone", use: { ...devices["iPhone 15"] } },
    { name: "android", use: { ...devices["Pixel 7"] } },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
