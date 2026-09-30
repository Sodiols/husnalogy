import { withAdminMutation } from "@/lib/security/admin-mutation";
import { requireAdmin } from "@/lib/auth/admin-server";
import {
  createHeroCollection,
  deleteHeroCollection,
  getHeroCollections,
  updateHeroCollection,
} from "@/lib/hero-collections/store";
import { readJsonObject } from "@/lib/http/read-body";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const collections = await getHeroCollections();
  return Response.json({ ok: true, collections });
}

export const POST = withAdminMutation(async function POST(request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const bodyRead16 = await readJsonObject(request, 256 * 1024);
  if (bodyRead16.response) return bodyRead16.response;
  const body = bodyRead16.body;
  const result = await createHeroCollection(body);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  return Response.json({ ok: true, collection: result.collection }, { status: 201 });
}, { maxBytes: 1024 * 1024 });

export const PATCH = withAdminMutation(async function PATCH(request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const bodyRead17 = await readJsonObject(request, 256 * 1024);
  if (bodyRead17.response) return bodyRead17.response;
  const body = bodyRead17.body;
  const id = String(body.id || "").trim();

  if (!id) {
    return Response.json({ ok: false, errors: { collection: "Collection id is required." } }, { status: 400 });
  }

  const result = await updateHeroCollection(id, body);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  return Response.json({ ok: true, collection: result.collection });
}, { maxBytes: 1024 * 1024 });

export const DELETE = withAdminMutation(async function DELETE(request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const bodyRead18 = await readJsonObject(request, 256 * 1024);
  if (bodyRead18.response) return bodyRead18.response;
  const body = bodyRead18.body;
  const id = String(body.id || "").trim();

  if (!id) {
    return Response.json({ ok: false, errors: { collection: "Collection id is required." } }, { status: 400 });
  }

  const result = await deleteHeroCollection(id);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 404 });
  }

  return Response.json({ ok: true });
}, { maxBytes: 1024 * 1024 });
