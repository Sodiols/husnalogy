#!/usr/bin/env node
/**
 * Run the COMPLETE Playwright suite against the staging Supabase project.
 *
 *   npm run staging:migrate && npm run staging:seed && npm run test:e2e:staging
 *
 * - Loads ONLY .env.staging (production refs and the .env.local project are
 *   refused) and requires the seed manifest of THAT project.
 * - Without E2E_BASE_URL it starts a FRESH local Next.js server on port 3200
 *   with the staging variables (process variables override .env.local), so
 *   the browser, the API and the tests all talk to staging.
 * - Success requires tests to have actually EXECUTED: a run that collected or
 *   executed nothing, or reported collection errors, is a failure.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadStagingEnv, stagingProcessEnv } from "./staging-env.mjs";

const root = process.cwd();
const { env, ref } = loadStagingEnv(root, { require: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "STAGING_CONFIRM_PROJECT_REF", "CRON_SECRET", "GOOGLE_FONTS_API_KEY"] });
const manifestPath = join(root, ".customizer-e2e.json");
if (!existsSync(manifestPath)) throw new Error("BLOCKED: .customizer-e2e.json not found. Run `npm run staging:seed` first.");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.projectRef !== ref || manifest.target !== "staging") {
  throw new Error(`REFUSED: the seed manifest belongs to ${manifest.target}/${manifest.projectRef}, not staging/${ref}. Re-run npm run staging:seed.`);
}

const reportFile = join(root, "test-results", "staging-e2e-report.json");
const runEnv = stagingProcessEnv(env, {
  E2E_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
  E2E_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ...(env.E2E_BASE_URL ? {} : { E2E_PORT: "3200", E2E_FRESH_SERVER: "1" }),
  PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
  FORCE_COLOR: "0",
});
const args = ["playwright", "test", "--reporter=list,json", ...process.argv.slice(2)];
console.log(JSON.stringify({ project: ref, baseUrl: env.E2E_BASE_URL || "http://127.0.0.1:3200 (fresh local server with staging env)" }));
const run = spawnSync("npx", args, { stdio: "inherit", env: runEnv, shell: process.platform === "win32" });

if (!existsSync(reportFile)) throw new Error("FAILED: Playwright produced no JSON report (it did not run).");
const report = JSON.parse(readFileSync(reportFile, "utf8"));
const stats = report.stats || {};
const summary = {
  executed: (stats.expected || 0) + (stats.unexpected || 0) + (stats.flaky || 0),
  passed: stats.expected || 0,
  failed: stats.unexpected || 0,
  flaky: stats.flaky || 0,
  skipped: stats.skipped || 0,
  collectionErrors: (report.errors || []).length,
  exitCode: run.status,
};
console.log(JSON.stringify({ e2e: summary }));
if (summary.collectionErrors || summary.executed === 0 || summary.failed || run.status !== 0) {
  console.error("Staging E2E did NOT pass (collection errors, nothing executed, or failures).");
  process.exit(1);
}
