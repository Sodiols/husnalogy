import { requireAdmin } from "@/lib/auth/admin-server";
import { loadNormalizedMockupTemplate, saveNormalizedMockupTemplate } from "@/lib/customizer/mockup-store";
import { rejectLargeRequest } from "@/lib/security/rate-limit";

export async function GET(_request: Request, { params }: any) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const { productId } = await params;
  try {
    const mockup = await loadNormalizedMockupTemplate(String(productId), { includeDraft: true });
    return Response.json({ ok: true, mockup });
  } catch (error) {
    console.error("Load normalized mockup failed:", error);
    return Response.json({ ok: false, error: "Could not load the mockup configuration." }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: any) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const tooLarge = rejectLargeRequest(request, 512 * 1024);
  if (tooLarge) return tooLarge;
  const { productId } = await params;
  const body = await request.json().catch(() => null);
  if (!body?.mockup) return Response.json({ ok: false, error: "Mockup configuration is required." }, { status: 400 });
  try {
    const mockup = await saveNormalizedMockupTemplate(String(productId), body.mockup, false);
    console.info(`[customizer] Mockup draft saved: product=${productId} by=${admin.admin?.id || "unknown"}`);
    return Response.json({ ok: true, mockup });
  } catch (error: any) {
    const message = String(error?.message || "Could not save the mockup configuration.");
    return Response.json({ ok: false, error: message.slice(0, 300) }, { status: /required|invalid|perspective|corner/i.test(message) ? 422 : 500 });
  }
}
