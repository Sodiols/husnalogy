import { withAdminMutation } from "@/lib/security/admin-mutation";
import { requireAdmin } from "@/lib/auth/admin-server";
import { getSettings, toAdminSettings, updateSettings } from "@/lib/settings";
import { readJsonObject } from "@/lib/http/read-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const settings = await getSettings();
  return Response.json({ ok: true, settings: toAdminSettings(settings), admin: admin.admin });
}

export const PUT = withAdminMutation(async function PUT(request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const bodyRead28 = await readJsonObject(request, 256 * 1024);
  if (bodyRead28.response) return bodyRead28.response;
  const body = bodyRead28.body;
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "Invalid settings payload." }, { status: 400 });
  }

  const result = await updateSettings(body);
  if (!result.ok) {
    return Response.json({ ok: false, errors: (result as any).errors }, { status: 400 });
  }

  return Response.json({ ok: true, settings: toAdminSettings(result.settings) });
}, { maxBytes: 1024 * 1024 });
