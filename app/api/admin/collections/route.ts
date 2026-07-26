import { requireAdmin } from "@/lib/auth/admin-server";
import { createProductCollection, deleteProductCollection, getProductCollections, updateProductCollection } from "@/lib/collections/store";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const collections = await getProductCollections();
  return Response.json({ ok: true, collections });
}

export async function POST(request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const body = await request.json().catch(() => ({}));
  const result = await createProductCollection(body);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  return Response.json({ ok: true, collection: result.collection }, { status: 201 });
}

export async function PATCH(request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "").trim();

  if (!id) {
    return Response.json({ ok: false, errors: { collection: "Collection id is required." } }, { status: 400 });
  }

  const result = await updateProductCollection(id, body);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  return Response.json({ ok: true, collection: result.collection });
}

export async function DELETE(request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "").trim();

  if (!id) {
    return Response.json({ ok: false, errors: { collection: "Collection id is required." } }, { status: 400 });
  }

  const result = await deleteProductCollection(id);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 404 });
  }

  return Response.json({ ok: true });
}
