import { requireAdmin } from "@/lib/auth/admin-server";
import { createNewsletterCampaignDraft, getNewsletterCampaigns } from "@/lib/newsletter";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const campaigns = await getNewsletterCampaigns();
  return Response.json({ ok: true, campaigns });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const body = await request.json().catch(() => ({}));
  const result = await createNewsletterCampaignDraft(body);

  if (!result.ok) {
    return Response.json(result, { status: 400 });
  }

  return Response.json(result, { status: 201 });
}
