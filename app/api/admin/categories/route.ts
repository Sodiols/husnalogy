import { requireAdmin } from "@/lib/auth/admin-server";
import { createCategory, getCategories } from "@/lib/categories";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const categories = await getCategories(true);
  return Response.json({ ok: true, categories });
}

export async function POST(request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const body = await request.json();
  const result = await createCategory(body);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  return Response.json({ ok: true, category: result.category }, { status: 201 });
}
