import { requireAdmin } from "@/lib/auth/admin-server";
import { addProductReview } from "@/lib/products";

export async function POST(request, { params }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const body = await request.json();
  const result = await addProductReview(id, body);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  return Response.json({ ok: true, review: result.review, reviews: result.reviews });
}
