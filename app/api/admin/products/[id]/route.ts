import { requireAdmin } from "@/lib/auth/admin-server";
import { requireProductEditor } from "@/lib/auth/roles";
import { designerMayEdit } from "@/lib/products/workflow";
import { workflowStateOf } from "@/lib/auth/roles";
import { deleteProduct, updateProduct } from "@/lib/products";

export async function PUT(request, { params }) {
  const { id } = await params;
  // Ownership is re-read from the database here; the id in the URL is a
  // request, not a permission.
  const session = await requireProductEditor(id);
  if (!session.ok) return session.response;

  // A designer's hands come off once the product is with the admin. Admins keep
  // editing at every stage.
  if (session.actor.role !== "admin" && !designerMayEdit(workflowStateOf(session.product))) {
    return Response.json(
      { ok: false, error: "This product is under review and cannot be edited right now." },
      { status: 409 },
    );
  }

  const body = await request.json();
  const result = await updateProduct(id, body, { actor: session.actor });

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  return Response.json({ ok: true, product: result.product });
}

// Archiving stays an administrator's decision (spec §4).
export async function DELETE(_request, { params }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const result = await deleteProduct(id);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 404 });
  }

  return Response.json({ ok: true });
}
