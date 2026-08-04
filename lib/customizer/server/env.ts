// Server environment validation (spec §47). Server-only.
//
// Required variables are reported *by name* when missing. Values are never
// read into a message, a log line or a response body.

export type EnvCheckResult = {
  ok: boolean;
  missing: string[];
};

const RENDER_WORKER_REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

function missingFrom(names: readonly string[]): string[] {
  return names.filter((name) => !String(process.env[name] || "").trim());
}

// The variables the render worker needs before it may touch a job.
export function checkRenderWorkerEnv(): EnvCheckResult {
  const missing = missingFrom(RENDER_WORKER_REQUIRED);
  // The worker must be callable only with a shared secret. Without one, an
  // unauthenticated scheduler route would be world-callable.
  if (!String(process.env.RENDER_WORKER_SECRET || "").trim() && !String(process.env.CRON_SECRET || "").trim()) {
    missing.push("RENDER_WORKER_SECRET or CRON_SECRET");
  }
  return { ok: missing.length === 0, missing };
}

// A public (NEXT_PUBLIC_*) copy of a server secret would ship the secret to
// every browser. Fail loudly if one is ever introduced.
export function assertNoPublicWorkerSecret(): void {
  const leaked = ["NEXT_PUBLIC_RENDER_WORKER_SECRET", "NEXT_PUBLIC_CRON_SECRET", "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY"].filter(
    (name) => String(process.env[name] || "").trim(),
  );
  if (leaked.length) {
    throw new Error(`Server secrets must never be exposed publicly. Remove: ${leaked.join(", ")}`);
  }
}
