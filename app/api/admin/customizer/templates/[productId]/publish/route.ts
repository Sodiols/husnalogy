import { requireAdmin } from "@/lib/auth/admin-server";
import { publishTemplateVersion } from "@/lib/customizer/versions";

// POST /api/admin/customizer/templates/[productId]/publish
// Publishes the current draft template as a new immutable version (spec §19).
export async function POST(request: Request, { params }: any) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { productId } = await params;
  const body = await request.json().catch(() => ({}));
  const notes = typeof body?.notes === "string" ? body.notes.slice(0, 2000) : "";

  try {
    const result = await publishTemplateVersion(productId, admin.admin?.id || null, notes);
    if (result.ok === false) {
      return Response.json({ ok: false, errors: result.errors, warnings: result.warnings }, { status: 422 });
    }
    // Audit log for template publishing (spec §33).
    console.info(
      `[customizer] Template published: product=${productId} version=${result.version.version} by=${admin.admin?.id || "unknown"}`,
    );
    return Response.json({
      ok: true,
      version: {
        id: result.version.id,
        version: result.version.version,
        createdAt: result.version.createdAt,
      },
      warnings: result.warnings,
    });
  } catch (error: any) {
    console.error("Template publish failed:", error);
    return Response.json({ ok: false, error: "Publishing failed. Please try again." }, { status: 500 });
  }
}
