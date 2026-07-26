import { requireAdmin } from "@/lib/auth/admin-server";
import { restoreProduct } from "@/lib/products";

export async function POST(_request, { params }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const result = await restoreProduct(id);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  return Response.json({ ok: true, product: result.product });
}
