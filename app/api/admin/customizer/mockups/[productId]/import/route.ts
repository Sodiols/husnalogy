import { requireProductEditor } from "@/lib/auth/roles";
import { importLegacyMockupsForProduct } from "@/lib/customizer/mockup-store";
import { rejectLargeRequest } from "@/lib/security/rate-limit";
import { readJsonObject } from "@/lib/http/read-body";

export async function POST(request: Request, { params }: any) {
  const { productId } = await params;
  // Ownership is re-read from the database: a designer cannot reach another
  // designer's design by guessing a product id.
  const session = await requireProductEditor(productId);
  if (!session.ok) return session.response;
  const admin = { ok: true, admin: session.actor } as const;
  const tooLarge = rejectLargeRequest(request, 512 * 1024);
  if (tooLarge) return tooLarge;
  const bodyRead12 = await readJsonObject(request, 512 * 1024);
  if (bodyRead12.response) return bodyRead12.response;
  const body = bodyRead12.body;
  try {
    const result = await importLegacyMockupsForProduct(String(productId), body.mockups);
    console.info(`[customizer] Legacy mockups imported: product=${productId} count=${result.imported} by=${admin.admin?.id || "unknown"}`);
    return Response.json({ ok: true, ...result });
  } catch (error: any) {
    return Response.json({ ok: false, error: String(error?.message || "Could not import legacy mockups.").slice(0, 300) }, { status: 422 });
  }
}
