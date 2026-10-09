import { withAdminMutation } from "@/lib/security/admin-mutation";
import { requireAdmin } from "@/lib/auth/admin-server";
import { requireProductEditor } from "@/lib/auth/roles";
import { designerMayEdit } from "@/lib/products/workflow";
import { workflowStateOf } from "@/lib/auth/roles";
import { deleteProduct, updateProduct } from "@/lib/products";
import { readJsonObject } from "@/lib/http/read-body";
import { parseExpectedDraftRevision } from "@/lib/customizer/draft-revision";

export const PUT = withAdminMutation(async function PUT(request, { params }) {
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

  const bodyRead23 = await readJsonObject(request, 5 * 1024 * 1024);
  if (bodyRead23.response) return bodyRead23.response;
  const { expectedTemplateUpdatedAt, ...body } = bodyRead23.body;
  // The draft revision this editor last saw; a draft changed since is not
  // overwritten (409 conflict) — see saveCustomizerTemplate.
  const result = await updateProduct(id, body, {
    actor: session.actor,
    expectedTemplateUpdatedAt: parseExpectedDraftRevision(expectedTemplateUpdatedAt),
  });

  if (!result.ok) {
    if ((result as any).conflict) {
      return Response.json({ ok: false, conflict: true, errors: result.errors }, { status: 409 });
    }
    return Response.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  return Response.json({ ok: true, product: result.product });
}, { maxBytes: 5 * 1024 * 1024, studio: true });

// Archiving stays an administrator's decision (spec §4).
export const DELETE = withAdminMutation(async function DELETE(_request, { params }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const result = await deleteProduct(id);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 404 });
  }

  return Response.json({ ok: true });
}, { maxBytes: 1024 * 1024 });
