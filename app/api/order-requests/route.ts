import { getSupabaseUserFromRequest } from "@/lib/auth/supabase-user";
import { createOrderRequest, getOrderRequestsForCustomer } from "@/lib/orders/index";
import { rateLimitDistributed, rejectLargeRequest } from "@/lib/security/rate-limit";
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

    const limited = await rateLimitDistributed(request, {
      name: "order-request",
      limit: 12,
      windowMs: 10 * 60 * 1000,
    });
    if (limited) return limited;

    const user = await getSupabaseUserFromRequest(request);
    if (!user?.uid) {
      return Response.json({ ok: false, error: "Authentication required." }, { status: 401 });
    }
    const trustedCustomerEmail = cleanString(user.email).toLowerCase();
    if (!trustedCustomerEmail) {
      return Response.json({ ok: false, error: "Your signed-in account needs an email address before checkout." }, { status: 400 });
    }
    const body = await request.json();

    const result = await createOrderRequest({
      ...body,
      customerId: user.uid,
      customerEmail: trustedCustomerEmail,
      customerName: body.customerName || user?.name || "",
      paymentMethod: "Cash on Delivery",
    });

    if (!result.ok) {
      return Response.json({ ok: false, errors: result.errors }, { status: 400 });
    }

    // 200 for an idempotent replay of a checkout this customer already
    // completed, 201 when the order was genuinely created just now.
    return Response.json(
      { ok: true, order: result.order, idempotent: Boolean((result as any).idempotent) },
      { status: (result as any).idempotent ? 200 : 201 },
    );
  } catch (error) {
    console.error("Order request failed:", error);
    return Response.json({ ok: false, error: "Could not submit your request." }, { status: 500 });
  }
}
