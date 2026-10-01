#!/usr/bin/env node
// `npm run test:staging` — real Supabase staging integration suite. With
// STAGING_REQUIRED=1 a missing/invalid .env.staging FAILS the run instead of
// skipping it, so it can never be mistaken for a pass.
import { spawnSync } from "node:child_process";

const run = spawnSync("npx", ["vitest", "run", "lib/database/__tests__/supabase-staging.test.ts", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, STAGING_REQUIRED: "1" },
  shell: process.platform === "win32",
});
process.exit(run.status ?? 1);
