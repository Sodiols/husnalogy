import { withAdminMutation } from "@/lib/security/admin-mutation";
import { requireAdmin } from "@/lib/auth/admin-server";
import { deleteOrderRequest, updateOrderRequestDetails } from "@/lib/orders/index";
import { readJsonObject } from "@/lib/http/read-body";

export const PUT = withAdminMutation(async function PUT(request, { params }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const bodyRead21 = await readJsonObject(request, 8 * 1024);
  if (bodyRead21.response) return bodyRead21.response;
  const body = bodyRead21.body;
  const result = await updateOrderRequestDetails(id, body);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  return Response.json({ ok: true, order: result.order });
}, { maxBytes: 1024 * 1024 });

export const DELETE = withAdminMutation(async function DELETE(_request, { params }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const result = await deleteOrderRequest(id);

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 404 });
  }

  return Response.json({ ok: true });
}, { maxBytes: 1024 * 1024 });
