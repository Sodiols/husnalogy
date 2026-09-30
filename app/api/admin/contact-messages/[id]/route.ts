import { withAdminMutation } from "@/lib/security/admin-mutation";
import { requireAdmin } from "@/lib/auth/admin-server";
import { deleteContactMessage, updateContactMessageStatus } from "@/lib/messages";
import { readJsonObject } from "@/lib/http/read-body";

export const PUT = withAdminMutation(async function PUT(request, { params }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const bodyRead6 = await readJsonObject(request, 16 * 1024);
  if (bodyRead6.response) return bodyRead6.response;
  const body = bodyRead6.body;
  const result = await updateContactMessageStatus(id, body.status);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  return Response.json({ ok: true, message: result.message });
}, { maxBytes: 1024 * 1024 });

export const DELETE = withAdminMutation(async function DELETE(_request, { params }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const result = await deleteContactMessage(id);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 404 });
  }

  return Response.json({ ok: true });
}, { maxBytes: 1024 * 1024 });
