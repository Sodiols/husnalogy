import { requireAdmin } from "@/lib/auth/admin-server";
import { getOrderRequests } from "@/lib/orders/index";

export async function GET(request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { searchParams } = new URL(request.url);
  const orders = await getOrderRequests({
    query: searchParams.get("q") || "",
    status: searchParams.get("status") || "",
  });

  return Response.json({ ok: true, orders });
}
