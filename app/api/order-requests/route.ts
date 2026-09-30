import { getSupabaseUserFromRequest } from "@/lib/auth/supabase-user";
import { createOrderRequest, getOrderRequestsForCustomer } from "@/lib/orders/index";
import { CHECKOUT_LIMITS } from "@/lib/orders/checkout-policy";
import { rateLimitDistributed } from "@/lib/security/rate-limit";
import { rejectCrossSiteRequest } from "@/lib/security/same-origin";
import { bodyErrorResponse, readJsonBody } from "@/lib/http/read-body";
import { logEvent, requestIdFrom } from "@/lib/observability/logger";

// Customer order data is per-user: never cache it anywhere.
export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  try {
    const user = await getSupabaseUserFromRequest(request);
    if (!user?.uid) {
      return Response.json({ ok: false, error: "Authentication required." }, { status: 401, headers: PRIVATE_HEADERS });
    }
    const orders = await getOrderRequestsForCustomer({ customerId: user.uid });
    return Response.json({ ok: true, orders }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    logEvent("error", "orders.list_failed", { requestId, error });
    return Response.json({ ok: false, error: "Could not load your orders." }, { status: 500, headers: PRIVATE_HEADERS });
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  const headers = { ...PRIVATE_HEADERS, "X-Request-Id": requestId };

  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;

  // Per address first (cheap, before any auth lookup), then per account.
  const byAddress = await rateLimitDistributed(request, { name: "order-request-ip", limit: 30, windowMs: 10 * 60 * 1000 });
  if (byAddress) return byAddress;

  try {
    const user = await getSupabaseUserFromRequest(request);
    if (!user?.uid) {
      return Response.json({ ok: false, error: "Please sign in to place an order." }, { status: 401, headers });
    }
    const byAccount = await rateLimitDistributed(request, { name: "order-request-user", limit: 12, windowMs: 10 * 60 * 1000, identity: user.uid });
    if (byAccount) return byAccount;

    let body: unknown;
    try {
      body = await readJsonBody(request, CHECKOUT_LIMITS.maxBodyBytes);
    } catch (error) {
      logEvent("warn", "checkout.validation_failed", { requestId, userId: user.uid, stage: "body", reason: error instanceof Error ? error.name : "unknown" });
      const response = bodyErrorResponse(error);
      if (response) return response;
      throw error;
    }

    const outcome = await createOrderRequest({
      user: { id: user.uid, email: String(user.email || "").toLowerCase() },
      body,
      requestId,
    });

    if (outcome.ok === false) {
      return Response.json(
        { ok: false, code: outcome.code, errors: outcome.errors, ...(outcome.orderId ? { orderId: outcome.orderId } : {}), requestId },
        { status: outcome.httpStatus, headers },
      );
    }

    // 201 when the order was created now; 200 for an idempotent replay of a
    // checkout this customer already completed (retry, double click, lost
    // response). Either way the order is finalized.
    return Response.json(
      { ok: true, order: outcome.order, idempotent: outcome.idempotent, cartCleared: outcome.cartCleared, requestId },
      { status: outcome.httpStatus, headers },
    );
  } catch (error) {
    logEvent("error", "checkout.unexpected_error", { requestId, stage: "route", error });
    return Response.json(
      { ok: false, code: "UNEXPECTED_ERROR", errors: { order: "We could not confirm your order. Please try again — retrying will never create a duplicate order." }, requestId },
      { status: 500, headers },
    );
  }
}
