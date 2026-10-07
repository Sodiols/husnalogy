import { requireAdmin } from "@/lib/auth/admin-server";
import { rateLimitDiagnostics } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/production/client-ip — admin only. Shows the X-Forwarded-For
 * chain this deployment receives, the TRUSTED_PROXY_HOPS in force and the
 * client address the rate limiter derives from them, so the proxy topology can
 * be VERIFIED after deployment instead of assumed: open it from a browser and
 * `resolvedClientIp` must be your own public IP address.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  return Response.json({ ok: true, ...rateLimitDiagnostics(request) }, { headers: { "Cache-Control": "no-store" } });
}
