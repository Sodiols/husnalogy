import { withAdminMutation } from "@/lib/security/admin-mutation";
import { requireAdmin } from "@/lib/auth/admin-server";
import { createCategory, getCategories } from "@/lib/categories";
import { readJsonObject } from "@/lib/http/read-body";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const categories = await getCategories(true);
  return Response.json({ ok: true, categories });
}

export const POST = withAdminMutation(async function POST(request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const bodyRead1 = await readJsonObject(request, 16 * 1024);
  if (bodyRead1.response) return bodyRead1.response;
  const body = bodyRead1.body;
  const result = await createCategory(body);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  return Response.json({ ok: true, category: result.category }, { status: 201 });
}, { maxBytes: 1024 * 1024 });
