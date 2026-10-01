#!/usr/bin/env node
// `npm run staging:seed` — seed the E2E accounts and fixtures into the STAGING
// project only (.env.staging; production refs and the .env.local project are
// refused by scripts/staging/staging-env.mjs).
process.env.CUSTOMIZER_SEED_TARGET = "staging";
await import("../seed-customizer-test.mjs");
