import { withAdminMutation } from "@/lib/security/admin-mutation";
import { requireDesignerOrAdmin } from "@/lib/auth/roles";
import { requireAdmin } from "@/lib/auth/admin-server";
import { createProductCollection, deleteProductCollection, getProductCollections, updateProductCollection } from "@/lib/collections/store";
import { readJsonObject } from "@/lib/http/read-body";

export async function GET() {
  // Read-only for the product form's collection picker. Writes below stay admin-only.
  const session = await requireDesignerOrAdmin();
  if (!session.ok) return session.response;
  const admin = { ok: true, admin: session.actor } as const;

  const collections = await getProductCollections();
  return Response.json({ ok: true, collections });
}

export const POST = withAdminMutation(async function POST(request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const bodyRead3 = await readJsonObject(request, 64 * 1024);
  if (bodyRead3.response) return bodyRead3.response;
  const body = bodyRead3.body;
  const result = await createProductCollection(body);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  return Response.json({ ok: true, collection: result.collection }, { status: 201 });
}, { maxBytes: 1024 * 1024 });

export const PATCH = withAdminMutation(async function PATCH(request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const bodyRead4 = await readJsonObject(request, 64 * 1024);
  if (bodyRead4.response) return bodyRead4.response;
  const body = bodyRead4.body;
  const id = String(body.id || "").trim();

  if (!id) {
    return Response.json({ ok: false, errors: { collection: "Collection id is required." } }, { status: 400 });
  }

  const result = await updateProductCollection(id, body);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  return Response.json({ ok: true, collection: result.collection });
}, { maxBytes: 1024 * 1024 });

export const DELETE = withAdminMutation(async function DELETE(request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const bodyRead5 = await readJsonObject(request, 64 * 1024);
  if (bodyRead5.response) return bodyRead5.response;
  const body = bodyRead5.body;
  const id = String(body.id || "").trim();

  if (!id) {
    return Response.json({ ok: false, errors: { collection: "Collection id is required." } }, { status: 400 });
  }

  const result = await deleteProductCollection(id);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 404 });
  }

  return Response.json({ ok: true });
}, { maxBytes: 1024 * 1024 });
