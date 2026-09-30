import { withAdminMutation } from "@/lib/security/admin-mutation";
import { getCurrentAdmin } from "@/lib/auth/admin-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { readJsonObject } from "@/lib/http/read-body";

export const POST = withAdminMutation(async function POST(request: Request) {
  const { body, response } = await readJsonObject(request, 4096);
  if (response) return response;
  if (typeof body.evidence !== "string" || body.evidence.trim().length < 10 || body.evidence.length > 1000 || !/^[a-f0-9-]{36}$/i.test(String(body.snapshotId))) return Response.json({ ok: false, error: "Provide snapshotId and the completed production reference (10–1000 characters)." }, { status: 400 });
  const admin = await getCurrentAdmin();
  if (!admin) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const { error } = await createServiceRoleClient().rpc("complete_manual_production", { p_snapshot_id: body.snapshotId, p_actor_id: admin.id, p_evidence: body.evidence });
  return Response.json(error ? { ok: false, error: "Manual completion refused." } : { ok: true }, { status: error ? 409 : 200 });
}, { maxBytes: 4096 });
