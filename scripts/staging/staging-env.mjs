/**
 * Staging environment loader and production guard for every staging tool
 * (migrations, verification, seeding, staging tests, staging Playwright).
 *
 * Reads ONLY `.env.staging` (git-ignored) — never `.env.local` — and refuses to
 * run unless:
 *   - the Supabase project ref is confirmed with STAGING_CONFIRM_PROJECT_REF;
 *   - the ref is not a known production project (PRODUCTION_PROJECT_REFS below
 *     plus HUSNALOGY_PRODUCTION_SUPABASE_REFS);
 *   - the ref differs from the project configured in `.env.local` (the app's
 *     own, possibly live, configuration).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Projects that hold real data. Staging tools never touch them. */
export const PRODUCTION_PROJECT_REFS = ["aehdzcpxdxpdjikdmdpf"];

export const REQUIRED_STAGING_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STAGING_DATABASE_URL",
  "STAGING_CONFIRM_PROJECT_REF",
];

export function parseEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    out[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

export function projectRefOf(url) {
  try {
    return new URL(String(url)).hostname.split(".")[0];
  } catch {
    return "";
  }
}

/**
 * Load and validate the staging environment. Returns { env, ref }. Throws a
 * clear error (never printing secret values) when anything is missing or the
 * target could be production.
 */
export function loadStagingEnv(root = process.cwd(), { require = REQUIRED_STAGING_VARS } = {}) {
  const file = join(root, ".env.staging");
  if (!existsSync(file)) {
    throw new Error("BLOCKED: .env.staging not found. Copy .env.staging.example to .env.staging and fill in a DEDICATED staging Supabase project.");
  }
  const env = { ...parseEnvFile(file) };
  const missing = require.filter((name) => !env[name]);
  if (missing.length) throw new Error(`BLOCKED: .env.staging is missing ${missing.join(", ")}.`);
  const ref = projectRefOf(env.NEXT_PUBLIC_SUPABASE_URL);
  const productionRefs = new Set([...PRODUCTION_PROJECT_REFS, ...String(process.env.HUSNALOGY_PRODUCTION_SUPABASE_REFS || "").split(",").map((value) => value.trim()).filter(Boolean)]);
  const localRef = projectRefOf(parseEnvFile(join(root, ".env.local")).NEXT_PUBLIC_SUPABASE_URL);
  if (!ref) throw new Error("NEXT_PUBLIC_SUPABASE_URL in .env.staging is not a valid URL.");
  if (productionRefs.has(ref)) throw new Error(`REFUSED: ${ref} is a production project. Staging tools never run against it.`);
  if (localRef && ref === localRef) throw new Error(`REFUSED: .env.staging points at the same project as .env.local (${ref}). Use a separate, disposable staging project.`);
  if (env.STAGING_CONFIRM_PROJECT_REF !== ref) throw new Error(`REFUSED: set STAGING_CONFIRM_PROJECT_REF=${ref} in .env.staging after verifying it is the disposable staging project.`);
  if (env.STAGING_DATABASE_URL && !String(env.STAGING_DATABASE_URL).includes(ref)) {
    throw new Error("REFUSED: STAGING_DATABASE_URL does not belong to the staging project ref (the connection string must contain it).");
  }
  return { env, ref };
}

/** The staging environment as process variables (process values never win). */
export function stagingProcessEnv(env, extra = {}) {
  return { ...process.env, ...env, ...extra };
}
