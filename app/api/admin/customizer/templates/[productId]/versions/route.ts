import { requireProductEditor } from "@/lib/auth/roles";
import { getCustomizerTemplateByProductId } from "@/lib/customizer/store";
import { listTemplateVersions } from "@/lib/customizer/versions";

// GET /api/admin/customizer/templates/[productId]/versions
// Version history for the product's template (spec §17, §19).
export async function GET(_request: Request, { params }: any) {
  const { productId } = await params;
  // Ownership is re-read from the database: a designer cannot reach another
  // designer's design by guessing a product id.
  const session = await requireProductEditor(productId);
  if (!session.ok) return session.response;
  const admin = { ok: true, admin: session.actor } as const;

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
