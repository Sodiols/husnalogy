import { requireAdmin } from "@/lib/auth/admin-server";
import { getSettings, toAdminSettings, updateSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const settings = await getSettings();
  return Response.json({ ok: true, settings: toAdminSettings(settings), admin: admin.admin });
}

export async function PUT(request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "Invalid settings payload." }, { status: 400 });
  }

  const result = await updateSettings(body);
  if (!result.ok) {
    return Response.json({ ok: false, errors: (result as any).errors }, { status: 400 });
  }

  return Response.json({ ok: true, settings: toAdminSettings(result.settings) });
}
