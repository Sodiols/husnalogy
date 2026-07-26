import { getSupabaseUserFromRequest } from "@/lib/auth/supabase-user";
import { createOrderRequest, getOrderRequestsForCustomer } from "@/lib/orders/index";
import { rateLimit, rejectLargeRequest } from "@/lib/security/rate-limit";
import { cleanString } from "@/lib/validation";

export async function GET(request) {
  try {
    const user = await getSupabaseUserFromRequest(request);

    if (!user?.uid && !user?.email) {
      return Response.json({ ok: false, error: "Authentication required." }, { status: 401 });
    }

    const orders = await getOrderRequestsForCustomer({
      customerId: user?.uid || "",
      email: user?.email || "",
    });

    return Response.json({ ok: true, orders });
  } catch (error) {
    console.error("Could not load customer orders:", error);
    return Response.json({ ok: false, error: "Could not load your orders." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const largeRequest = rejectLargeRequest(request, 256 * 1024);
    if (largeRequest) return largeRequest;

    const limited = rateLimit(request, {
      name: "order-request",
      limit: 12,
      windowMs: 10 * 60 * 1000,
    });
    if (limited) return limited;

    const body = await request.json();
    const user = await getSupabaseUserFromRequest(request);
    const trustedCustomerId = user?.uid || "";
    const trustedCustomerEmail = user?.email || cleanString(body.customerEmail).toLowerCase();

    const result = await createOrderRequest({
      ...body,
      customerId: trustedCustomerId,
      customerEmail: trustedCustomerEmail,
      customerName: body.customerName || user?.name || "",
    });

    if (!result.ok) {
      return Response.json({ ok: false, errors: result.errors }, { status: 400 });
    }

    return Response.json({ ok: true, order: result.order }, { status: 201 });
  } catch (error) {
    console.error("Order request failed:", error);
    return Response.json({ ok: false, error: "Could not submit your request." }, { status: 500 });
  }
}
