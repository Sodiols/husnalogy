import { requireAdmin } from "@/lib/auth/admin-server";
import { getRenderHealthSummary } from "@/lib/customizer/render-jobs";

// GET /api/admin/customizer/render/health — production readiness summary
// (spec §12). Focused on what blocks personalized orders shipping: queue
// depth, stuck jobs, and snapshots without usable production output.
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const health = await getRenderHealthSummary();
    return Response.json({ ok: true, health });
  } catch (error) {
    console.error("Render health summary failed:", error);
    return Response.json({ ok: false, error: "Could not load render health." }, { status: 500 });
  }
}
