import { addProductReviewBySlug, getProductBySlug } from "@/lib/products";
import { getOrderRequests } from "@/lib/orders";
import { rateLimit, rejectLargeRequest } from "@/lib/security/rate-limit";
import { getSettings } from "@/lib/settings";
import { cleanString } from "@/lib/validation";
import { getSupabaseUserFromRequest } from "@/lib/auth/supabase-user";

// A customer can only review a product once their order for it has been delivered.
// "completed" is kept as a synonym for legacy orders that used it as the delivered/done state.
const REVIEW_ALLOWED_STATUSES = new Set([
  "delivered",
  "completed",
]);

function orderIncludesProduct(order, product) {
  if (!order || !product) return false;

  if (order.productSlug && order.productSlug === product.slug) return true;
  if (order.productId && String(order.productId) === String(product.id)) return true;

  return (order.items || []).some((item) => {
    return (
      item.productSlug === product.slug ||
      item.slug === product.slug ||
      String(item.productId || "") === String(product.id)
    );
  });
}

function orderBelongsToUser(order, user) {
  if (!order || !user) return false;

  const orderEmail = cleanString(order.customerEmail).toLowerCase();
  const userEmail = cleanString(user.email).toLowerCase();
  const orderCustomerId = cleanString(order.customerId);

  if (orderCustomerId && user.uid && orderCustomerId === user.uid) return true;
  if (orderEmail && userEmail && orderEmail === userEmail) return true;

  return false;
}

function orderCanReview(order) {
  return REVIEW_ALLOWED_STATUSES.has(String(order?.status || "").toLowerCase());
}

function reviewAlreadyExists(product, order, user) {
  const orderId = cleanString(order?.id);
  const email = cleanString(user?.email).toLowerCase();

  return (product.reviews || []).some((review) => {
    return review.orderId === orderId || (review.customerEmail && review.customerEmail === email && review.orderId === orderId);
  });
}

async function findEligibleReviewOrder(product, user, requestedOrderId = "") {
  const orders = await getOrderRequests();
  const targetOrderId = cleanString(requestedOrderId);

  return orders.find((order) => {
    if (targetOrderId && cleanString(order.id) !== targetOrderId) return false;

    return (
      orderBelongsToUser(order, user) &&
      orderCanReview(order) &&
      orderIncludesProduct(order, product) &&
      !reviewAlreadyExists(product, order, user)
    );
  });
}

export async function GET(request, { params }) {
  try {
    const { slug } = await params;
    const product = await getProductBySlug(slug, true);

    if (!product) {
      return Response.json({ ok: false, error: "Product not found." }, { status: 404 });
    }

    const settings = await getSettings();

    if (!settings.preferences.allowProductReviews) {
      return Response.json({
        ok: true,
        authenticated: false,
        eligible: false,
        reviewsEnabled: false,
        message: "Product reviews are currently disabled.",
      });
    }

    const user = await getSupabaseUserFromRequest(request);

    if (!user) {
      return Response.json({ ok: true, authenticated: false, eligible: false });
    }

    const order = await findEligibleReviewOrder(product, user);

    return Response.json({
      ok: true,
      authenticated: true,
      eligible: Boolean(order),
      reviewsEnabled: true,
      order: order
        ? {
            id: order.id,
            status: order.status,
          }
        : null,
      message: order
        ? "You can review this product."
        : "You can review this product once your order for it has been delivered.",
    });
  } catch (error) {
    console.error("Review eligibility check failed:", error);
    return Response.json({ ok: false, error: "Could not check review eligibility." }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const largeRequest = rejectLargeRequest(request, 12 * 1024);
    if (largeRequest) return largeRequest;

    const limited = rateLimit(request, {
      name: "product-review",
      limit: 8,
      windowMs: 10 * 60 * 1000,
    });
    if (limited) return limited;

    const { slug } = await params;
    const body = await request.json();
    const product = await getProductBySlug(slug, true);

    if (!product) {
      return Response.json({ ok: false, error: "Product not found." }, { status: 404 });
    }

    const settings = await getSettings();

    if (!settings.preferences.allowProductReviews) {
      return Response.json(
        { ok: false, error: "Product reviews are currently disabled." },
        { status: 403 }
      );
    }

    const user = await getSupabaseUserFromRequest(request);

    if (!user) {
      return Response.json(
        { ok: false, error: "Please sign in before leaving a review." },
        { status: 401 }
      );
    }

    const name = cleanString(body.name) || user.name || "Husnalogy customer";
    const text = cleanString(body.text);
    const rating = Number(body.rating || 5);

    const errors: any = {};
    if (!text) errors.text = "Review text is required.";
    if (!rating || rating < 1 || rating > 5) errors.rating = "Choose a rating from 1 to 5.";

    if (Object.keys(errors).length) {
      return Response.json({ ok: false, errors }, { status: 400 });
    }

    const matchingOrder = await findEligibleReviewOrder(product, user, body.orderId);

    if (!matchingOrder) {
      return Response.json(
        {
          ok: false,
          error: "You can review this product only after your order for it has been delivered.",
        },
        { status: 403 }
      );
    }

    const result = await addProductReviewBySlug(slug, {
      orderId: matchingOrder.id,
      customerId: user.uid,
      customerEmail: user.email,
      name,
      text,
      rating,
    });

    if (!result.ok) {
      return Response.json({ ok: false, errors: result.errors }, { status: 400 });
    }

    return Response.json({ ok: true, review: result.review, reviews: result.reviews }, { status: 201 });
  } catch (error) {
    console.error("Product review failed:", error);
    return Response.json({ ok: false, error: "Could not save your review." }, { status: 500 });
  }
}
