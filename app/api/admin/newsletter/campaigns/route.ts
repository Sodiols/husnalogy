import { withAdminMutation } from "@/lib/security/admin-mutation";
import { requireAdmin } from "@/lib/auth/admin-server";
import { createNewsletterCampaignDraft, getNewsletterCampaigns } from "@/lib/newsletter";
import { readJsonObject } from "@/lib/http/read-body";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const campaigns = await getNewsletterCampaigns();
  return Response.json({ ok: true, campaigns });
}

export const POST = withAdminMutation(async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const bodyRead19 = await readJsonObject(request, 256 * 1024);
  if (bodyRead19.response) return bodyRead19.response;
  const body = bodyRead19.body;
  const result = await createNewsletterCampaignDraft(body);

  if (!result.ok) {
    return Response.json(result, { status: 400 });
  }

  return Response.json(result, { status: 201 });
}, { maxBytes: 1024 * 1024 });
