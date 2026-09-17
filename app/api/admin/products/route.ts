import { requireAdmin } from "@/lib/auth/admin-server";
import { canCreateProduct, canViewProduct, requireCapability, requireDesignerOrAdmin } from "@/lib/auth/roles";
import { createProduct, getProducts, hydrateProductCustomizerAssets } from "@/lib/products";

export async function GET() {
  // Designers reach this too, but they see only their OWN work: the list is
  // filtered server side, so scoping cannot be lost by a client that forgets
  // to send a filter.
  const session = await requireDesignerOrAdmin();
  if (!session.ok) return session.response;

  const all = await getProducts();
  // `canViewProduct` returns true for every admin, so one filter covers both
  // roles and no route needs its own idea of what "admin" means.
  const products = all.filter((product: any) => canViewProduct(session.actor, product));
  // The design builder opens straight from this payload, so its templates need
  // freshly signed URLs for admin-uploaded assets. Hydrating the whole array in
  // one pass costs a single lookup for every referenced asset.
  return Response.json({ ok: true, products: await hydrateProductCustomizerAssets(products) });
}

export async function POST(request) {
  const session = await requireCapability(canCreateProduct, "You cannot create products.");
  if (!session.ok) return session.response;

  const body = await request.json();
  // The ACTOR decides ownership and workflow state, never the body.
  const result = await createProduct(body, { actor: session.actor });

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  return Response.json({ ok: true, product: result.product }, { status: 201 });
}
