/**
 * End-to-end tests of the checkout pipeline: the production TypeScript code
 * (schema → pricing → customization binding → payload) driving the REAL
 * `create_checkout_order` transaction in a disposable Postgres, with fault
 * injection for the failure modes that matter in production.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { placeCheckoutOrder, type CheckoutDeps } from "@/lib/orders/checkout";
import { CURRENT_TERMS_VERSION } from "@/lib/orders/checkout-policy";
import { createTestDatabase, type TestDatabase } from "@/lib/testing/pglite-supabase";
import { BASIC_OPTIONS, IDS, USERS, count, seedCheckoutFixtures } from "@/lib/testing/checkout-fixtures";
import { createPgliteCheckoutDeps } from "@/lib/testing/pglite-checkout-deps";

const A = USERS.customerA;
const B = USERS.customerB;
let submission = 0;

const body = (overrides: Record<string, unknown> = {}) => ({
  checkoutSubmissionId: `pipeline-submission-${(submission += 1)}-${Date.now()}`,
  customerName: "Ayesha Rahman",
  customerPhone: "01712345678",
  deliveryMethod: "delivery",
  addressLine1: "House 12, Road 5, Zindabazar",
  city: "Sylhet",
  postalCode: "3100",
  acceptTerms: true,
  termsVersion: CURRENT_TERMS_VERSION,
  items: [{ productId: "product-active", quantity: 2, selectedOptions: { ...BASIC_OPTIONS, paper: "Premium" } }],
  ...overrides,
});

const designLine = (customizationId: string = IDS.customizationA, overrides: Record<string, unknown> = {}) => ({
  productId: "product-active",
  quantity: 2,
  selectedOptions: { ...BASIC_OPTIONS, paper: "Premium +$100.00" },
  customizationId,
  cartItemId: IDS.cartItemA,
  ...overrides,
});

describe("checkout pipeline against the real transaction", () => {
  let t: TestDatabase;
  let deps: CheckoutDeps;
  const place = (requestBody: unknown, user: { id: string; email: string } = A, overrideDeps: Partial<CheckoutDeps> = {}) =>
    placeCheckoutOrder({ user, body: requestBody, requestId: "test-request" }, { ...deps, ...overrideDeps });

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedCheckoutFixtures(t);
    await t.db.query(
      `insert into public.products (id, slug, title, status, visibility, price, data) values
        ('product-usd', 'usd-card', 'USD Card', 'active', 'public', 10, '{"currency":"USD","sizeOptions":[],"paperOptions":[],"envelopeOptions":[],"cornerOptions":[],"printingOptions":[]}'::jsonb)`,
    );
    await t.db.query(
      "insert into public.customer_uploads (user_id, bucket, path, file_name, mime_type, size_bytes) values ($1, 'customer-uploads', $2, 'mine.jpg', 'image/jpeg', 1234), ($3, 'customer-uploads', $4, 'theirs.jpg', 'image/jpeg', 99)",
      [A.id, `${A.id}/product/1/original.jpg`, B.id, `${B.id}/product/1/original.jpg`],
    );
  }, 120_000);
  afterAll(() => t?.close());
  beforeEach(() => {
    deps = createPgliteCheckoutDeps(t);
  });

  /* ------------------------------------------------------------- pricing -- */

  it("places a valid order priced entirely from server data", async () => {
    const outcome = await place(body());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.httpStatus).toBe(201);
      expect(outcome.order.total).toBe(400); // (100 sale price + 100 Premium) x 2
      expect(outcome.order.items[0]).toMatchObject({ productTitle: "Pearl Invitation", price: 200, finalPrice: 400, currency: "BDT" });
      expect(outcome.order.items[0].selectedOptions.paper).toBe("Premium");
      expect(outcome.order.paymentStatus).toBe("unpaid");
      expect(outcome.order.status).toBe("pending");
      expect(outcome.order.customerEmail).toBe(A.email);
      expect(outcome.order.customerPhone).toBe("+8801712345678");
    }
  });

  it("a forged '+$0' option label is charged the configured surcharge", async () => {
    const outcome = await place(body({ items: [{ productId: "product-active", quantity: 1, selectedOptions: { ...BASIC_OPTIONS, paper: "Premium +$0" } }] }));
    expect(outcome.ok && outcome.order.total).toBe(200);
  });

  it.each([
    ["subtotal", { subtotal: 1 }],
    ["total", { total: 1 }],
    ["deliveryCharge", { deliveryCharge: -100 }],
    ["currency", { currency: "USD" }],
    ["paymentStatus", { paymentStatus: "paid" }],
    ["status", { status: "delivered" }],
    ["customerId", { customerId: B.id }],
    ["customerEmail", { customerEmail: B.email }],
  ])("rejects a forged %s without creating anything", async (_field, extra) => {
    const before = await count(t, "select 1 from public.orders");
    const outcome = await place(body(extra));
    expect(outcome.ok).toBe(false);
    if (outcome.ok === false) expect(outcome.httpStatus).toBe(400);
    expect(await count(t, "select 1 from public.orders")).toBe(before);
  });

  it.each([
    ["unit price", { price: 0 }],
    ["title", { title: "Free" }],
    ["image", { image: "https://evil.example/x.png" }],
    ["sku", { sku: "FREE" }],
  ])("rejects a forged line %s", async (_label, extra) => {
    const outcome = await place(body({ items: [{ productId: "product-active", quantity: 1, selectedOptions: BASIC_OPTIONS, ...extra }] }));
    expect(outcome.ok).toBe(false);
  });

  it.each([
    ["draft", "product-draft"],
    ["hidden", "product-hidden"],
    ["sold out", "product-soldout"],
    ["non-existent", "product-does-not-exist"],
  ])("refuses a %s product", async (_label, productId) => {
    const outcome = await place(body({ items: [{ productId, quantity: 1, selectedOptions: BASIC_OPTIONS }] }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok === false) expect(outcome.httpStatus).toBe(422);
  });

  it("refuses unknown, hidden-group and foreign options", async () => {
    for (const options of [
      { ...BASIC_OPTIONS, paper: "Gold Leaf" },
      { ...BASIC_OPTIONS, discount: "100" },
      { ...BASIC_OPTIONS, envelope: "Other Product Envelope" },
    ]) {
      const outcome = await place(body({ items: [{ productId: "product-active", quantity: 1, selectedOptions: options }] }));
      expect(outcome.ok).toBe(false);
    }
  });

  it("refuses a product priced in another currency and never mixes currencies", async () => {
    const usdOnly = await place(body({ items: [{ productId: "product-usd", quantity: 1, selectedOptions: { format: "Instant Download" } }] }));
    expect(usdOnly.ok).toBe(false);
    const mixed = await place(
      body({ items: [{ productId: "product-active", quantity: 1, selectedOptions: BASIC_OPTIONS }, { productId: "product-usd", quantity: 1, selectedOptions: { format: "Instant Download" } }] }),
    );
    expect(mixed.ok).toBe(false);
  });

  it("uses the server delivery charge for pickup and delivery alike", async () => {
    const { addressLine1: _a, city: _c, postalCode: _p, ...pickup } = body({ deliveryMethod: "store" });
    const outcome = await place(pickup);
    expect(outcome.ok && outcome.order.deliveryCharge).toBe(0);
    expect(outcome.ok && outcome.order.deliveryMethod).toBe("store");
  });

  it("requires explicit acceptance of the current terms", async () => {
    expect((await place(body({ acceptTerms: false }))).ok).toBe(false);
    expect((await place(body({ termsVersion: "old" }))).ok).toBe(false);
  });

  it("fails closed with 503 when the catalogue cannot be loaded", async () => {
    const outcome = await place(body(), A, {
      loadProducts: async () => {
        throw new Error("database unavailable");
      },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok === false) expect(outcome.httpStatus).toBe(503);
  });

  /* -------------------------------------------------------- personalization -- */

  it("accepts the customer's own upload with its description from the database", async () => {
    const outcome = await place(
      body({
        items: [
          {
            productId: "product-active",
            quantity: 1,
            selectedOptions: BASIC_OPTIONS,
            personalization: { bride_name: "Ayesha" },
            uploads: { photo_upload: { path: `${A.id}/product/1/original.jpg` } },
          },
        ],
      }),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.order.items[0].customizationValues).toEqual({ bride_name: "Ayesha" });
      expect(outcome.order.items[0].uploadedFiles.photo_upload).toMatchObject({ name: "mine.jpg", mimeType: "image/jpeg", size: 1234 });
    }
  });

  it("rejects another customer's upload path and unknown personalization fields", async () => {
    const foreign = await place(
      body({ items: [{ productId: "product-active", quantity: 1, selectedOptions: BASIC_OPTIONS, uploads: { photo_upload: { path: `${B.id}/product/1/original.jpg` } } }] }),
    );
    expect(foreign.ok).toBe(false);
    const unknown = await place(body({ items: [{ productId: "product-active", quantity: 1, selectedOptions: BASIC_OPTIONS, personalization: { admin_note: "x" } }] }));
    expect(unknown.ok).toBe(false);
    const link = await place(body({ items: [{ productId: "product-active", quantity: 1, selectedOptions: BASIC_OPTIONS, personalization: { bride_name: "javascript:alert(1)" } }] }));
    expect(link.ok).toBe(false);
  });

  /* ----------------------------------------------------------- customizations -- */

  it("refuses another customer's design (same answer as a missing one)", async () => {
    const outcome = await place(body({ items: [designLine(IDS.customizationB, { cartItemId: undefined })] }));
    expect(outcome.ok === false && outcome.httpStatus).toBe(404);
  });

  it("refuses a design for product A submitted as product B", async () => {
    const outcome = await place(body({ items: [designLine(IDS.customizationDraftProduct, { cartItemId: undefined })] }));
    expect(outcome.ok === false && outcome.code).toBe("CUSTOMIZATION_PRODUCT_MISMATCH");
  });

  it("refuses a premium design submitted as a basic option", async () => {
    const outcome = await place(body({ items: [designLine(IDS.customizationA, { selectedOptions: { ...BASIC_OPTIONS, paper: "Signature Matte" } })] }));
    expect(outcome.ok === false && outcome.code).toBe("CUSTOMIZATION_OPTIONS_MISMATCH");
  });

  it("refuses a design whose template version does not belong to the product", async () => {
    await t.db.query("update public.product_customizations set template_version = 99 where id = $1", [IDS.customizationA2]);
    const outcome = await place(body({ items: [designLine(IDS.customizationA2, { cartItemId: undefined })] }));
    expect(outcome.ok === false && outcome.code).toBe("CUSTOMIZATION_TEMPLATE_VERSION_INVALID");
    await t.db.query("update public.product_customizations set template_version = 1 where id = $1", [IDS.customizationA2]);
  });

  it("refuses a deleted design", async () => {
    const outcome = await place(body({ items: [designLine("30000000-0000-4000-8000-00000000dead", { cartItemId: undefined })] }));
    expect(outcome.ok === false && outcome.httpStatus).toBe(404);
  });

  it("orders a valid design, freezes its snapshot, locks it, and clears the cart line", async () => {
    const outcome = await place(body({ items: [designLine()] }));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.cartCleared).toBe(true);
      expect(outcome.order.items[0].customizationId).toBe(IDS.customizationA);
      expect(await count(t, "select 1 from public.order_design_snapshots where order_id = $1", [outcome.order.id])).toBe(1);
      expect(await count(t, "select 1 from public.cart_items where id = $1", [IDS.cartItemA])).toBe(0);
    }
    const row = (await t.db.query<any>("select status from public.product_customizations where id = $1", [IDS.customizationA])).rows[0];
    expect(row.status).toBe("ordered");
  });

  it("refuses to order an already ordered design again", async () => {
    const outcome = await place(body({ items: [designLine(IDS.customizationA, { cartItemId: undefined })] }));
    expect(outcome.ok === false && outcome.code).toBe("CUSTOMIZATION_LOCKED");
  });

  it("refuses an ownerless legacy design", async () => {
    await t.db.query("alter table public.product_customizations drop constraint if exists product_customizations_owner_required");
    // New rows can no longer be ownerless (insert guard), so simulate a legacy
    // row the way it exists in old data.
    await t.db.query(
      "insert into public.product_customizations (id, user_id, product_id, template_id, template_version, status, selected_options) values ('30000000-0000-4000-8000-0000000000ff', $3, 'product-active', $1, 1, 'in_cart', $2::jsonb)",
      [IDS.templateActive, JSON.stringify(BASIC_OPTIONS), A.id],
    );
    await t.db.query("update public.product_customizations set user_id = null where id = '30000000-0000-4000-8000-0000000000ff'");
    const outcome = await place(body({ items: [designLine("30000000-0000-4000-8000-0000000000ff", { cartItemId: undefined, selectedOptions: BASIC_OPTIONS })] }));
    expect(outcome.ok === false && outcome.httpStatus).toBe(404);
  });

  /* -------------------------------------------------------------- idempotency -- */

  it("a retried submission returns the same order (200), never a second one", async () => {
    const request = body();
    const first = await place(request);
    const retry = await place(request);
    expect(first.ok && first.httpStatus).toBe(201);
    expect(retry.ok && retry.httpStatus).toBe(200);
    expect(retry.ok && retry.idempotent).toBe(true);
    expect(first.ok && retry.ok && retry.order.id).toBe(first.ok && first.order.id);
    expect(await count(t, "select 1 from public.orders where checkout_submission_id = $1", [request.checkoutSubmissionId])).toBe(1);
  });

  it("concurrent identical submissions (double click, two tabs) create exactly one order", async () => {
    const request = body();
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => place(request)));
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    const ids = new Set(outcomes.map((outcome) => (outcome.ok ? outcome.order.id : "")));
    expect(ids.size).toBe(1);
    expect(outcomes.filter((outcome) => outcome.ok && outcome.httpStatus === 201)).toHaveLength(1);
    expect(await count(t, "select 1 from public.orders where checkout_submission_id = $1", [request.checkoutSubmissionId])).toBe(1);
  });

  it("the same submission id with a different cart is a conflict that names the existing order", async () => {
    const request = body();
    const first = await place(request);
    const changed = await place({ ...request, items: [{ productId: "product-active", quantity: 5, selectedOptions: BASIC_OPTIONS }] });
    expect(changed.ok).toBe(false);
    if (changed.ok === false) {
      expect(changed.code).toBe("SUBMISSION_REUSED");
      expect(changed.orderId).toBe(first.ok && first.order.id);
    }
  });

  it("another customer presenting the same submission id gets their own order", async () => {
    const request = body();
    const a = await place(request, A);
    const b = await place(request, B);
    expect(a.ok && b.ok && a.order.id !== b.order.id).toBe(true);
  });

  /* ----------------------------------------------------------- failure modes -- */

  it("server committed but the database response was lost: the customer still gets the order", async () => {
    const request = body();
    const outcome = await place(request, A, {
      createOrder: async (payload) => {
        await deps.createOrder(payload);
        throw new Error("socket hang up");
      },
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.idempotent).toBe(true);
    // And a later browser retry is also idempotent.
    const retry = await place(request);
    expect(retry.ok && retry.httpStatus).toBe(200);
    expect(await count(t, "select 1 from public.orders where checkout_submission_id = $1", [request.checkoutSubmissionId])).toBe(1);
  });

  it("a failure inside the transaction leaves nothing behind, and the retry creates exactly one order", async () => {
    const request = body({ items: [designLine(IDS.customizationA2, { cartItemId: undefined })] });
    const failing = await place(request, A, {
      createOrder: (payload) => deps.createOrder({ ...payload, items: payload.items.map((item) => ({ ...item, quantity: 0, line_total: "0.00" })) }),
    });
    expect(failing.ok).toBe(false);
    expect(await count(t, "select 1 from public.orders where checkout_submission_id = $1", [request.checkoutSubmissionId])).toBe(0);
    const design = (await t.db.query<any>("select status, order_id from public.product_customizations where id = $1", [IDS.customizationA2])).rows[0];
    expect(design).toEqual({ status: "draft", order_id: null });

    const retry = await place(request);
    expect(retry.ok).toBe(true);
    expect(await count(t, "select 1 from public.orders where checkout_submission_id = $1", [request.checkoutSubmissionId])).toBe(1);
  });

  it("a partial order left by the OLD non-transactional code (rollback failed) is never reported as success", async () => {
    const request = body();
    await t.db.query(
      `insert into public.orders (id, customer_id, customer_name, customer_email, checkout_submission_id, checkout_state, request_hash, total, subtotal)
       values ('order-orphan-partial', $1, 'A', $2, $3, 'creating', null, 400, 400)`,
      [A.id, A.email, request.checkoutSubmissionId],
    );
    const retry = await place(request);
    expect(retry.ok).toBe(false);
    if (retry.ok === false) expect(retry.code).toBe("CHECKOUT_INCOMPLETE");
    expect(await count(t, "select 1 from public.orders where checkout_submission_id = $1", [request.checkoutSubmissionId])).toBe(1);
    // The partial order is not visible to the customer either.
    const visible = await t.asUser(A.id, A.email, (db) => db.query("select id from public.orders where id = 'order-orphan-partial'"));
    expect(visible.rows).toHaveLength(0);
  });

  it("a failed cart cleanup never turns a placed order into a failure", async () => {
    const outcome = await place(body({ items: [{ productId: "product-active", quantity: 1, selectedOptions: BASIC_OPTIONS, cartItemId: IDS.cartItemA2 }] }), A, {
      clearCartItems: async () => {
        throw new Error("network");
      },
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.cartCleared).toBe(false);
  });

  it("a failed production follow-up (render queue) never turns a placed order into a failure", async () => {
    const outcome = await place(body(), A, {
      afterOrderCreated: async () => {
        throw new Error("render queue down");
      },
    });
    expect(outcome.ok).toBe(true);
  });

  it("a product edited between pricing and commit aborts with PRICE_CHANGED", async () => {
    const outcome = await place(body(), A, {
      createOrder: async (payload) => {
        await t.db.query("update public.products set updated_at = now() + interval '1 second' where id = 'product-active'");
        return deps.createOrder(payload);
      },
    });
    expect(outcome.ok === false && outcome.code).toBe("PRICE_CHANGED");
  });

  it("unauthenticated or email-less users cannot check out", async () => {
    expect((await place(body(), { id: "", email: "" })).ok).toBe(false);
    expect((await place(body(), { id: A.id, email: "" })).ok).toBe(false);
  });
});
