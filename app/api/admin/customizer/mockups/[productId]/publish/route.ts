import { requireAdmin } from "@/lib/auth/admin-server";
import { loadNormalizedMockupTemplate, saveNormalizedMockupTemplate } from "@/lib/customizer/mockup-store";

export async function POST(_request: Request, { params }: any) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const { productId } = await params;
  try {
    const draft = await loadNormalizedMockupTemplate(String(productId), { includeDraft: true });
    if (!draft) return Response.json({ ok: false, error: "Save a mockup draft before publishing." }, { status: 404 });
    const mockup = await saveNormalizedMockupTemplate(String(productId), draft, true);
    console.info(`[customizer] Mockup published: product=${productId} version=${mockup.version} by=${admin.admin?.id || "unknown"}`);
    return Response.json({ ok: true, mockup });
  } catch (error: any) {
    return Response.json({ ok: false, error: String(error?.message || "Could not publish the mockup.").slice(0, 300) }, { status: 422 });
  }
}
