import { requireAdmin } from "@/lib/auth/admin-server";
import {
  createHeroCollection,
  deleteHeroCollection,
  getHeroCollections,
  updateHeroCollection,
} from "@/lib/hero-collections/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const collections = await getHeroCollections();
  return Response.json({ ok: true, collections });
}

export async function POST(request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const body = await request.json().catch(() => ({}));
  const result = await createHeroCollection(body);

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

  const result = await updateHeroCollection(id, body);

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

  const result = await deleteHeroCollection(id);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 404 });
  }

  return Response.json({ ok: true });
}
