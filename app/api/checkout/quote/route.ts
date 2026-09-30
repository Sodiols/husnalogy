import { getSupabaseUserFromRequest } from "@/lib/auth/supabase-user";
import { getProductRecordsForCheckout } from "@/lib/products";
import { parseQuoteRequest } from "@/lib/orders/checkout-schema";
import { CHECKOUT_LIMITS } from "@/lib/orders/checkout-policy";
import { buildQuote } from "@/lib/orders/quote";
import { rateLimitDistributed } from "@/lib/security/rate-limit";
import { rejectCrossSiteRequest } from "@/lib/security/same-origin";
import { bodyErrorResponse, readJsonBody } from "@/lib/http/read-body";
import { logEvent, requestIdFrom } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

// POST /api/checkout/quote — trusted prices for the checkout summary. Read
// only: it never creates, reserves or changes anything.
export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;

  const limited = await rateLimitDistributed(request, { name: "checkout-quote", limit: 120, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;

  const user = await getSupabaseUserFromRequest(request);
  if (!user?.uid) return Response.json({ ok: false, error: "Please sign in to check out." }, { status: 401, headers: HEADERS });

  let body: unknown;
  try {
    body = await readJsonBody(request, CHECKOUT_LIMITS.maxBodyBytes);
  } catch (error) {
    return bodyErrorResponse(error) || Response.json({ ok: false, error: "The request body is invalid." }, { status: 400, headers: HEADERS });
  }

  const parsed = parseQuoteRequest(body);
  if (parsed.ok === false) return Response.json({ ok: false, errors: parsed.errors }, { status: 400, headers: HEADERS });

  try {
    const products = await getProductRecordsForCheckout(parsed.items.map((item) => item.productId));
    return Response.json({ ok: true, quote: buildQuote(parsed.items, products, parsed.deliveryMethod) }, { headers: HEADERS });
  } catch (error) {
    logEvent("error", "checkout.quote_failed", { requestId, userId: user.uid, error });
    return Response.json({ ok: false, error: "We could not confirm current prices. Please try again." }, { status: 503, headers: HEADERS });
  }
}
