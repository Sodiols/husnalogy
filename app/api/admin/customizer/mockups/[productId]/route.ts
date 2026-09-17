import { requireProductEditor } from "@/lib/auth/roles";
import { loadNormalizedMockupTemplate, saveNormalizedMockupTemplate } from "@/lib/customizer/mockup-store";
import { rejectLargeRequest } from "@/lib/security/rate-limit";

export async function GET(_request: Request, { params }: any) {
  const { productId } = await params;
  // Ownership is re-read from the database: a designer cannot reach another
  // designer's design by guessing a product id.
  const session = await requireProductEditor(productId);
  if (!session.ok) return session.response;
  const admin = { ok: true, admin: session.actor } as const;
  try {
    const mockup = await loadNormalizedMockupTemplate(String(productId), { includeDraft: true });
    return Response.json({ ok: true, mockup });
  } catch (error) {
    console.error("Load normalized mockup failed:", error);
    return Response.json({ ok: false, error: "Could not load the mockup configuration." }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: any) {
  const { productId } = await params;
  // Ownership is re-read from the database: a designer cannot reach another
  // designer's design by guessing a product id.
  const session = await requireProductEditor(productId);
  if (!session.ok) return session.response;
  const admin = { ok: true, admin: session.actor } as const;
  const tooLarge = rejectLargeRequest(request, 512 * 1024);
  if (tooLarge) return tooLarge;
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
