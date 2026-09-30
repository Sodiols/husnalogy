import { withAdminMutation } from "@/lib/security/admin-mutation";
import { getCurrentAdmin } from "@/lib/auth/admin-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { readJsonObject } from "@/lib/http/read-body";

export const POST = withAdminMutation(async function POST(request: Request) {
  const { body, response } = await readJsonObject(request, 4096);
  if (response) return response;
  if (!["production", "render", "snapshot", "notification"].includes(String(body.kind)) || !/^[a-f0-9-]{36}$/i.test(String(body.id)) || typeof body.reason !== "string" || body.reason.trim().length < 3 || body.reason.length > 500) return Response.json({ ok: false, error: "Provide kind, id, and a retry reason (3–500 characters)." }, { status: 400 });
  const admin = await getCurrentAdmin();
  if (!admin) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const { data, error } = await createServiceRoleClient().rpc("retry_production_work", { p_kind: body.kind, p_id: body.id, p_actor_id: admin.id, p_reason: body.reason });
  if (error) return Response.json({ ok: false, error: "Retry refused. Busy, completed, manual, legacy or uncertain-delivery work requires review.", code: error.code }, { status: error.code === "42501" ? 403 : 409 });
  return Response.json(data);
}, { maxBytes: 4096 });
