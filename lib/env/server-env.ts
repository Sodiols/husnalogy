/**
 * Production environment validation.
 *
 * Runs once when the Node server boots (instrumentation.ts). A missing or
 * malformed required variable stops `npm start` with a message naming the
 * variable, instead of surfacing later as an obscure 500 on the first request
 * that happens to need it. Values are never printed — only variable names.
 *
 * Server-only: reads secrets. Never import this from a client component.
 */

export type EnvIssue = { variable: string; message: string };
export type EnvReport = { errors: EnvIssue[]; warnings: EnvIssue[] };

type Env = Record<string, string | undefined>;

const MIN_WORKER_SECRET_LENGTH = 32;

/** Server secrets that must never be copied into a NEXT_PUBLIC_ variable. */
const SERVER_SECRET_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "GOOGLE_FONTS_API_KEY",
  "CRON_SECRET",
  "RENDER_WORKER_SECRET",
  "UPSTASH_REDIS_REST_TOKEN",
  "OPENAI_API_KEY",
  "DELETE_ADMIN_PASSWORD",
];

const LOCAL_HOSTNAMES = new Set(["0.0.0.0", "localhost", "127.0.0.1", "::1", "[::1]"]);

function value(env: Env, name: string): string {
  return String(env[name] ?? "").trim();
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** The render worker secrets that are configured, in precedence order. */
export function getRenderWorkerSecrets(env: Env = process.env): string[] {
  return [value(env, "CRON_SECRET"), value(env, "RENDER_WORKER_SECRET")].filter(Boolean);
}

export function validateProductionEnv(env: Env = process.env): EnvReport {
  const errors: EnvIssue[] = [];
  const warnings: EnvIssue[] = [];
  const error = (variable: string, message: string) => errors.push({ variable, message });
  const warn = (variable: string, message: string) => warnings.push({ variable, message });

  // ---------------------------------------------------------------- Supabase
  const supabaseUrl = value(env, "NEXT_PUBLIC_SUPABASE_URL");
  const parsedSupabase = parseUrl(supabaseUrl);
  if (!supabaseUrl) error("NEXT_PUBLIC_SUPABASE_URL", "is required.");
  else if (!parsedSupabase || parsedSupabase.protocol !== "https:") {
    error("NEXT_PUBLIC_SUPABASE_URL", "must be an https:// URL such as https://<project-ref>.supabase.co.");
  }

  const publishableKey = value(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") || value(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!publishableKey) {
    error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "is required (NEXT_PUBLIC_SUPABASE_ANON_KEY is accepted as a legacy alias).");
  }

  const serviceRoleKey = value(env, "SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) error("SUPABASE_SERVICE_ROLE_KEY", "is required.");
  else if (serviceRoleKey === publishableKey) {
    error("SUPABASE_SERVICE_ROLE_KEY", "must be the service-role/secret key, not the publishable key.");
  } else if (serviceRoleKey.startsWith("sb_publishable_")) {
    error("SUPABASE_SERVICE_ROLE_KEY", "contains a publishable key; use the service-role or sb_secret_ key.");
  }
  if (publishableKey.startsWith("sb_secret_")) {
    error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "contains a SECRET key. It is shipped to every browser — use the publishable key.");
  }

  // ---------------------------------------------------------------- Site URL
  const siteUrl = value(env, "NEXT_PUBLIC_SITE_URL");
  const parsedSite = parseUrl(siteUrl);
  if (!siteUrl) error("NEXT_PUBLIC_SITE_URL", "is required (production value: https://husnalogy.com).");
  else if (!parsedSite) error("NEXT_PUBLIC_SITE_URL", "is not a valid URL.");
  else {
    if (parsedSite.protocol !== "https:") error("NEXT_PUBLIC_SITE_URL", "must use https:// in production.");
    if (LOCAL_HOSTNAMES.has(parsedSite.hostname)) {
      error("NEXT_PUBLIC_SITE_URL", "points at a local address; auth callbacks and canonical URLs would break.");
    }
    if (parsedSite.pathname !== "/" || parsedSite.search || parsedSite.hash) {
      warn("NEXT_PUBLIC_SITE_URL", "should be a bare origin; only the origin is used.");
    }
  }

  // ------------------------------------------------------------------- Fonts
  if (!value(env, "GOOGLE_FONTS_API_KEY")) {
    error("GOOGLE_FONTS_API_KEY", "is required for the customizer font catalog and print rendering.");
  }

  // ------------------------------------------------------------ Render worker
  const workerSecrets = getRenderWorkerSecrets(env);
  if (!workerSecrets.length) {
    error("CRON_SECRET", "is required so the Hostinger cron job can run the render worker.");
  }
  for (const name of ["CRON_SECRET", "RENDER_WORKER_SECRET"]) {
    const secret = value(env, name);
    if (secret && secret.length < MIN_WORKER_SECRET_LENGTH) {
      error(name, `must be at least ${MIN_WORKER_SECRET_LENGTH} characters (generate with: openssl rand -hex 32).`);
    }
  }

  // ------------------------------------------------------------ Rate limiting
  const upstashUrl = value(env, "UPSTASH_REDIS_REST_URL");
  const upstashToken = value(env, "UPSTASH_REDIS_REST_TOKEN");
  if (Boolean(upstashUrl) !== Boolean(upstashToken)) {
    warn("UPSTASH_REDIS_REST_URL", "and UPSTASH_REDIS_REST_TOKEN must be set together; using the in-memory limiter.");
  }

  // --------------------------------------------------------- Unsafe settings
  if (value(env, "ENABLE_CUSTOMIZER_E2E_FIXTURE") === "1") {
    warn("ENABLE_CUSTOMIZER_E2E_FIXTURE", "is enabled; the /__e2e test fixture pages are publicly reachable. Never set it on the live site.");
  }

  // A server secret must never be published through a NEXT_PUBLIC_ variable.
  const secretValues = new Set(SERVER_SECRET_NAMES.map((name) => value(env, name)).filter(Boolean));
  for (const [name, raw] of Object.entries(env)) {
    if (!name.startsWith("NEXT_PUBLIC_")) continue;
    if (/SERVICE_ROLE|SECRET|PASSWORD|PRIVATE/i.test(name)) {
      error(name, "looks like a server secret but has a NEXT_PUBLIC_ prefix, which ships it to every browser.");
    } else if (raw && secretValues.has(String(raw).trim())) {
      error(name, "holds the same value as a server secret; NEXT_PUBLIC_ values are public.");
    }
  }

  return { errors, warnings };
}

export function formatEnvReport(report: EnvReport): string {
  const lines: string[] = [];
  if (report.errors.length) {
    lines.push("Husnalogy cannot start: required production configuration is missing or invalid.");
    for (const issue of report.errors) lines.push(`  - ${issue.variable} ${issue.message}`);
    lines.push("See HOSTINGER_DEPLOYMENT.md and .env.example.");
  }
  return lines.join("\n");
}

/**
 * The environment as the running bundle actually sees it.
 *
 * NEXT_PUBLIC_ values are inlined at BUILD time wherever they are read with a
 * static `process.env.NEXT_PUBLIC_X` access, so a value changed in hPanel after
 * the build has no effect until the next build. These static reads are the
 * inlined values, and they take precedence over the runtime copy.
 */
function effectiveEnv(): Env {
  return {
    ...process.env,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

/**
 * Validate at boot. Throws in production when a required variable is missing;
 * warnings are logged and never block startup.
 */
export function assertProductionEnv(env: Env = effectiveEnv()): EnvReport {
  const report = validateProductionEnv(env);
  for (const issue of report.warnings) {
    console.warn(`[env] ${issue.variable} ${issue.message}`);
  }
  if (report.errors.length) throw new Error(formatEnvReport(report));
  return report;
}
