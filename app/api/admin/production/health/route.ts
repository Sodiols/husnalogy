import { requireAdmin } from "@/lib/auth/admin-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { hasWorkerSecret } from "@/lib/security/worker-auth";
import { logEvent } from "@/lib/observability/logger";
import { assessProductionHealth } from "@/lib/worker/health-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/production/health — worker and queue health for uptime
 * monitoring. Worker secret (for an external monitor) or admin session.
 *
 *   200 { status: "healthy" }                      everything ran
 *   200 { status: "degraded", warnings: [...] }    maintenance needs attention
 *   503 { status: "unhealthy", problems: [...] }   customer work is not being done
 *
 * Policy (critical vs maintenance subsystems): lib/worker/health-policy.ts.
 */
export async function GET(request: Request) {
  if (!hasWorkerSecret(request)) {
    const admin = await requireAdmin();
    if (!admin.ok) return admin.response;
  }
  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase.rpc("production_health");
    if (error) throw error;
    const health = (data || {}) as Record<string, unknown>;
    const assessment = assessProductionHealth(health);
    return Response.json(
      {
        ok: assessment.status === "healthy",
        status: assessment.status,
        problems: assessment.problems,
        warnings: assessment.warnings,
        subsystemIssues: assessment.subsystemIssues,
        health,
      },
      { status: assessment.httpStatus, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logEvent("error", "production.health_failed", { error });
    return Response.json({ ok: false, status: "unhealthy", problems: ["Health could not be read."], warnings: [] }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
