import { withAdminMutation } from "@/lib/security/admin-mutation";
import { getCurrentAdmin } from "@/lib/auth/admin-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { readJsonObject } from "@/lib/http/read-body";

/** Record an actual provider review before retrying an uncertain old delivery. */
export const POST = withAdminMutation(async function POST(request: Request) {
  const { body, response } = await readJsonObject(request, 4096);
  if (response) return response;
  if (typeof body.delivered !== "boolean" || typeof body.reason !== "string" || body.reason.trim().length < 10 || body.reason.length > 500 || !/^[a-f0-9-]{36}$/i.test(String(body.id)) || (body.delivered && !body.providerId)) return Response.json({ ok: false, error: "Provide task id, verified delivery outcome, provider reference if delivered, and review evidence." }, { status: 400 });
  const admin = await getCurrentAdmin();
  if (!admin) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const { error } = await createServiceRoleClient().rpc("resolve_notification_delivery", { p_id: body.id, p_actor_id: admin.id, p_delivered: body.delivered, p_provider_id: String(body.providerId || ""), p_reason: body.reason });
  return Response.json(error ? { ok: false, error: "Delivery review refused." } : { ok: true }, { status: error ? 409 : 200 });
}, { maxBytes: 4096 });
