import { requireAdmin } from "@/lib/auth/admin-server";
import { updateNewsletterCampaign } from "@/lib/newsletter";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const result = await updateNewsletterCampaign(id, body);

  return Response.json(result);
}
