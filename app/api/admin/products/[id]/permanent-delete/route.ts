import { requireAdmin } from "@/lib/auth/admin-server";
import { permanentlyDeleteProduct, verifyPermanentDeleteCredentials } from "@/lib/products";

export async function POST(request, { params }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  if (!process.env.DELETE_ADMIN_EMAIL || !process.env.DELETE_ADMIN_PASSWORD) {
    return Response.json(
      { ok: false, error: "Permanent delete environment values are missing." },
      { status: 500 }
    );
  }

  if (!verifyPermanentDeleteCredentials(body.email, body.password)) {
    return Response.json(
      { ok: false, error: "Invalid permanent delete permission." },
      { status: 401 }
    );
  }

  const result = await permanentlyDeleteProduct(id);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  return Response.json({ ok: true });
}
