import { requireAdmin } from "@/lib/auth/admin-server";
import { deleteProductReview } from "@/lib/products";

export async function DELETE(_request, { params }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id, reviewId } = await params;
  const result = await deleteProductReview(id, reviewId);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 404 });
  }

  return Response.json({ ok: true, reviews: result.reviews });
}
