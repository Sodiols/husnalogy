import { requireAdmin } from "@/lib/auth/admin-server";
import { createProduct, getProducts, hydrateProductCustomizerAssets } from "@/lib/products";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const products = await getProducts();
  // The design builder opens straight from this payload, so its templates need
  // freshly signed URLs for admin-uploaded assets. Hydrating the whole array in
  // one pass costs a single lookup for every referenced asset.
  return Response.json({ ok: true, products: await hydrateProductCustomizerAssets(products) });
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
