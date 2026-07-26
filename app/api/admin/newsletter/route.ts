import { requireAdmin } from "@/lib/auth/admin-server";
import { getSubscribers } from "@/lib/newsletter";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const subscribers = await getSubscribers();
  return Response.json({ ok: true, subscribers });
}
