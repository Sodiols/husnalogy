import { requireAdmin } from "@/lib/auth/admin-server";
import { addProductReview } from "@/lib/products";
import { readJsonObject } from "@/lib/http/read-body";

export async function POST(request, { params }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const bodyRead25 = await readJsonObject(request, 16 * 1024);
  if (bodyRead25.response) return bodyRead25.response;
  const body = bodyRead25.body;
  const result = await addProductReview(id, body);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  return Response.json({ ok: true, review: result.review, reviews: result.reviews });
}
