import { withAdminMutation } from "@/lib/security/admin-mutation";
import { requireAdmin } from "@/lib/auth/admin-server";
import { publishTemplateVersion } from "@/lib/customizer/versions";
import type { CustomizerUpdateType } from "@/lib/customizer/public-version";
import { readJsonObject } from "@/lib/http/read-body";

// POST /api/admin/customizer/templates/[productId]/publish
// Publishes the current draft template as a new immutable version (spec §19).
export const POST = withAdminMutation(async function POST(request: Request, { params }: any) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { productId } = await params;
  const bodyRead15 = await readJsonObject(request, 16 * 1024);
  if (bodyRead15.response) return bodyRead15.response;
  const body = bodyRead15.body;
  const notes = typeof body?.notes === "string" ? body.notes.slice(0, 2000) : "";
  const updateType: CustomizerUpdateType = body?.updateType === "major" ? "major" : "minor";

  try {
    const result = await publishTemplateVersion(productId, admin.admin?.id || null, notes, updateType);
    if (result.ok === false) {
      return Response.json({ ok: false, errors: result.errors, warnings: result.warnings }, { status: 422 });
    }
    // Audit log for template publishing (spec §33).
    console.info(
      `[customizer] Template published: product=${productId} publicVersion=${result.version.displayVersion} snapshot=${result.version.version} by=${admin.admin?.id || "unknown"}`,
    );
    return Response.json({
      ok: true,
      version: {
        id: result.version.id,
        version: result.version.version,
        major: result.version.majorVersion,
        revision: result.version.minorRevision,
        display: result.version.displayVersion,
        createdAt: result.version.createdAt,
      },
      warnings: result.warnings,
    });
  } catch (error: any) {
    console.error("Template publish failed:", error);
    return Response.json({ ok: false, error: "Publishing failed. Please try again." }, { status: 500 });
  }
}, { maxBytes: 1024 * 1024 });
