import { withAdminMutation } from "@/lib/security/admin-mutation";
import { getCurrentAdmin } from "@/lib/auth/admin-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { readJsonObject } from "@/lib/http/read-body";

/** Retry one logical snapshot job/dispatch. The scheduled worker executes it. */
export const POST = withAdminMutation(async function POST(request: Request) {
  const { body, response } = await readJsonObject(request, 4096);
  if (response) return response;
  const kind = body.jobId ? "render" : "snapshot";
  const id = String(body.jobId || body.snapshotId || "");
  if (!/^[a-f0-9-]{36}$/i.test(id)) return Response.json({ ok: false, error: "Provide jobId or snapshotId." }, { status: 400 });
  const admin = await getCurrentAdmin();
  if (!admin) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const { data, error } = await createServiceRoleClient().rpc("retry_production_work", { p_kind: kind, p_id: id, p_actor_id: admin.id, p_reason: String(body.reason || "Admin requested render recovery").slice(0, 500) });
  if (error) return Response.json({ ok: false, error: "Retry refused. Verify the production state and remediation requirements.", code: error.code }, { status: error.code === "42501" ? 403 : 409 });
  return Response.json(data);
}, { maxBytes: 4096 });
