import { requireAdmin } from "@/lib/auth/admin-server";
import { deleteCategory, updateCategory } from "@/lib/categories";
import { readJsonObject } from "@/lib/http/read-body";

export async function PUT(request, { params }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const bodyRead2 = await readJsonObject(request, 16 * 1024);
  if (bodyRead2.response) return bodyRead2.response;
  const body = bodyRead2.body;
  const result = await updateCategory(id, body);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  return Response.json({ ok: true, category: result.category });
}

export async function DELETE(_request, { params }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const result = await deleteCategory(id);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 404 });
  }

  return Response.json({ ok: true });
}
