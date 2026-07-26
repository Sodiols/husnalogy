import { requireAdmin } from "@/lib/auth/admin-server";
import { getCustomizerTemplateByProductId } from "@/lib/customizer/store";
import { listTemplateVersions } from "@/lib/customizer/versions";

// GET /api/admin/customizer/templates/[productId]/versions
// Version history for the product's template (spec §17, §19).
export async function GET(_request: Request, { params }: any) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { productId } = await params;
  try {
    const template = await getCustomizerTemplateByProductId(productId);
    if (!template) return Response.json({ ok: true, versions: [], currentPublishedVersion: null });
    const versions = await listTemplateVersions(template.id);
    return Response.json({
      ok: true,
      currentPublishedVersion: versions[0]?.displayVersion || null,
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        major: v.majorVersion,
        revision: v.minorRevision,
        display: v.displayVersion,
        notes: v.notes,
        publishedBy: v.publishedBy,
        createdAt: v.createdAt,
      })),
    });
  } catch (error) {
    console.error("List template versions failed:", error);
    return Response.json({ ok: false, error: "Could not load version history." }, { status: 500 });
  }
}
