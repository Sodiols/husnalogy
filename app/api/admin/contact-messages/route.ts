import { requireAdmin } from "@/lib/auth/admin-server";
import { getContactMessages } from "@/lib/messages";

export async function GET(request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { searchParams } = new URL(request.url);
  const messages = await getContactMessages({
    query: searchParams.get("q") || "",
    status: searchParams.get("status") || "",
  });

  return Response.json({ ok: true, messages });
}
