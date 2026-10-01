import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/admin-server";
import { hasWorkerSecret } from "@/lib/security/worker-auth";
import { measureDatabaseClockOffset } from "@/lib/outbox/supabase-tasks";
import { logEvent } from "@/lib/observability/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SKEW_LIMIT_MS = 2_000;

/**
 * GET /api/admin/production/clock — clock diagnostics for leases, JWT
 * validation, signed URLs and cron timing. Worker secret or admin session.
 *
 * Reports this server's UTC time and timezone, its offset from the DATABASE
 * clock (best of 3 round trips; millisecond precision), its offset from the
 * Supabase gateway's HTTP Date header (1 s precision), and — for an admin
 * session — the iat/exp of that session's access token compared with both
 * clocks. The token itself is never returned or logged.
 */
export async function GET(request: Request) {
  const viaSecret = hasWorkerSecret(request);
  if (!viaSecret) {
    const admin = await requireAdmin();
    if (!admin.ok) return admin.response;
  }
  try {
    const supabase = createServiceRoleClient();
    const samples = [];
    for (let index = 0; index < 3; index++) samples.push(await measureDatabaseClockOffset(supabase));
    const database = samples.sort((a, b) => a.roundTripMs - b.roundTripMs)[0];

    let gatewayMinusServerMs: number | null = null;
    try {
      const base = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
      const t0 = Date.now();
      const response = await fetch(`${base}/auth/v1/health`, { signal: AbortSignal.timeout(5_000) });
      const t1 = Date.now();
      const date = Date.parse(response.headers.get("date") || "");
      if (Number.isFinite(date)) gatewayMinusServerMs = Math.round(date - (t0 + t1) / 2);
    } catch {
      gatewayMinusServerMs = null;
    }

    let session: Record<string, unknown> | null = null;
    if (!viaSecret) {
      const { data } = await (await createClient()).auth.getSession();
      const token = data.session?.access_token || "";
      const parts = token.split(".");
      if (parts.length === 3) {
        const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { iat?: number; exp?: number };
        const now = Date.now();
        const databaseNow = now - database.offsetMs;
        session = {
          iat: claims.iat ? new Date(claims.iat * 1000).toISOString() : null,
          exp: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
          iatAheadOfServerMs: claims.iat ? claims.iat * 1000 - now : null,
          iatAheadOfDatabaseMs: claims.iat ? Math.round(claims.iat * 1000 - databaseNow) : null,
        };
      }
    }

    const serverNow = new Date();
    const problems: string[] = [];
    if (Math.abs(database.offsetMs) > SKEW_LIMIT_MS) problems.push(`Server clock is ${database.offsetMs} ms ${database.offsetMs > 0 ? "ahead of" : "behind"} the database clock.`);
    if (gatewayMinusServerMs !== null && Math.abs(gatewayMinusServerMs) > SKEW_LIMIT_MS + 1_000) problems.push(`Supabase gateway Date differs from this server by ${gatewayMinusServerMs} ms.`);
    const body = {
      ok: problems.length === 0,
      problems,
      server: { now: serverNow.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, tzEnv: process.env.TZ || null, utcOffsetMinutes: -serverNow.getTimezoneOffset() },
      database: { now: database.databaseNow, offsetMs: database.offsetMs, roundTripMs: database.roundTripMs, samples: samples.length },
      gateway: { minusServerMs: gatewayMinusServerMs, precisionMs: 1_000 },
      session,
    };
    if (problems.length) logEvent("warn", "clock.skew_detected", { databaseOffsetMs: database.offsetMs, gatewayMinusServerMs });
    return Response.json(body, { status: problems.length ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logEvent("error", "clock.diagnostics_failed", { error });
    return Response.json({ ok: false, problems: ["Clock diagnostics could not be measured."] }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
