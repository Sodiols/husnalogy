import { requireAdmin } from "@/lib/auth/admin-server";
import { importLegacyMockupsForProduct } from "@/lib/customizer/mockup-store";
import { rejectLargeRequest } from "@/lib/security/rate-limit";

export async function POST(request: Request, { params }: any) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const tooLarge = rejectLargeRequest(request, 512 * 1024);
  if (tooLarge) return tooLarge;
  const { productId } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const result = await importLegacyMockupsForProduct(String(productId), body.mockups);
    console.info(`[customizer] Legacy mockups imported: product=${productId} count=${result.imported} by=${admin.admin?.id || "unknown"}`);
    return Response.json({ ok: true, ...result });
  } catch (error: any) {
    return Response.json({ ok: false, error: String(error?.message || "Could not import legacy mockups.").slice(0, 300) }, { status: 422 });
  }
}
