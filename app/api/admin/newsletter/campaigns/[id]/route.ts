import { requireAdmin } from "@/lib/auth/admin-server";
import { updateNewsletterCampaign } from "@/lib/newsletter";
import { readJsonObject } from "@/lib/http/read-body";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const bodyRead20 = await readJsonObject(request, 256 * 1024);
  if (bodyRead20.response) return bodyRead20.response;
  const body = bodyRead20.body;
  const result = await updateNewsletterCampaign(id, body);

  return Response.json(result);
}
