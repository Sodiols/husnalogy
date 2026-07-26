import { requireAdmin } from "@/lib/auth/admin-server";
import { createProduct, getProducts } from "@/lib/products";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const products = await getProducts();
  return Response.json({ ok: true, products });
}

export async function POST(request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const body = await request.json();
  const result = await createProduct(body);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  return Response.json({ ok: true, product: result.product }, { status: 201 });
}
