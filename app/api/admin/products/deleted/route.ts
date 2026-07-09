import { requireAdmin } from "@/lib/auth/admin-server";
import { getDeletedProducts } from "@/lib/products";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const products = await getDeletedProducts();
  return Response.json({ ok: true, products });
}
