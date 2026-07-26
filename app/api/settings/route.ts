import { getSettings, toPublicSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getSettings();
  return Response.json({ ok: true, settings: toPublicSettings(settings) });
}
