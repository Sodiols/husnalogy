/**
 * End-to-end tests of the checkout pipeline: the production TypeScript code
 * (schema → pricing → customization binding → real snapshot composer →
 * payload) driving the REAL `create_checkout_order` transaction and the REAL
 * outbox lease functions in a disposable Postgres, with fault injection.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { placeCheckoutOrder, type CheckoutDeps } from "@/lib/orders/checkout";
import { CURRENT_TERMS_VERSION } from "@/lib/orders/checkout-policy";
import { parseQuoteRequest } from "@/lib/orders/checkout-schema";
import { buildQuote } from "@/lib/orders/quote";
import { processTasks } from "@/lib/outbox/processor";
import { makeNotificationRunner } from "@/lib/notifications/notification-runner";
import type { EmailTransport } from "@/lib/notifications/email-provider";
import { createTestDatabase, type TestDatabase } from "@/lib/testing/pglite-supabase";
import { BASIC_OPTIONS, IDS, USERS, addCartLine, count, seedCheckoutFixtures } from "@/lib/testing/checkout-fixtures";
import { createPgliteCheckoutDeps, loadOrderView, type PgliteDepsOptions } from "@/lib/testing/pglite-checkout-deps";
import { fakeRenderRunner, notificationStore, productionStore } from "@/lib/testing/pglite-outbox";

const A = USERS.customerA;
const B = USERS.customerB;
let submission = 0;

type LineSpec = {
  productId?: string;
  quantity?: number;
  selectedOptions?: Record<string, unknown>;
  customizationId?: string;
  personalization?: Record<string, unknown>;
  uploads?: Record<string, { path: string }>;
  cartItemId?: string | null;
  [extra: string]: unknown;
};

function recordingTransport(fail: () => boolean = () => false) {
  const sent: Array<{ to: string; subject: string; key: string; text: string }> = [];
  const transport: EmailTransport = {
    async send(message, key) {
      if (fail()) throw new Error("provider 503");
      sent.push({ to: message.to, subject: message.subject, key, text: message.text });
      return { id: `msg-${sent.length}` };
    },
  };
  return { transport, sent };
}

describe("checkout pipeline against the real transaction", () => {
  let t: TestDatabase;
  const place = (requestBody: unknown, user: { id: string; email: string } = A, overrideDeps: Partial<CheckoutDeps> = {}, options: PgliteDepsOptions = {}) =>
    placeCheckoutOrder({ user, body: requestBody, requestId: "test-request" }, { ...createPgliteCheckoutDeps(t, options), ...overrideDeps });

  /** A request whose lines each consume a fresh server-side cart line. */
  const body = async (lines: LineSpec[] = [{}], overrides: Record<string, unknown> = {}, owner: { id: string } = A) => {
    const items = [];
    for (const line of lines) {
      const { cartItemId, ...rest } = line;
      const productId = rest.productId || "product-active";
      const quantity = rest.quantity ?? 1;
      const id = cartItemId === null ? undefined : cartItemId || (await addCartLine(t, { user: owner, productId, quantity, customizationId: rest.customizationId || null }));
      items.push({ productId, quantity, selectedOptions: { ...BASIC_OPTIONS, paper: "Premium" }, ...rest, ...(id ? { cartItemId: id } : {}) });
    }
    return {
      checkoutSubmissionId: `pipeline-submission-${(submission += 1)}-${Date.now()}`,
      customerName: "Ayesha Rahman",
      customerPhone: "01712345678",
      deliveryMethod: "delivery",
      addressLine1: "House 12, Road 5, Zindabazar",
      city: "Sylhet",
      postalCode: "3100",
      acceptTerms: true,
      termsVersion: CURRENT_TERMS_VERSION,
      items,
      ...overrides,
    };
  };
  const design = (customizationId: string, extra: LineSpec = {}): LineSpec => ({
    customizationId,
    quantity: 2,
    selectedOptions: { ...BASIC_OPTIONS, paper: "Premium +$100.00" },
    ...extra,
  });

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

  /* ------------------------------------------------------------- pricing -- */

  it("places a valid order priced entirely from server data and consumes the cart line", async () => {
    const request = await body([{ quantity: 2 }]);
    const outcome = await place(request);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.httpStatus).toBe(201);
      expect(outcome.order.total).toBe(400); // (100 sale + 100 Premium) x 2
      expect(outcome.order.items[0]).toMatchObject({ productTitle: "Pearl Invitation", price: 200, finalPrice: 400, currency: "BDT" });
      expect(outcome.order.items[0].selectedOptions.paper).toBe("Premium");
      expect(outcome.order.paymentStatus).toBe("unpaid");
      expect(outcome.order.status).toBe("pending");
      expect(outcome.order.customerEmail).toBe(A.email);
      expect(outcome.order.customerPhone).toBe("+8801712345678");
      expect(outcome.cartCleared).toBe(true);
    }
    const cartItemId = request.items[0].cartItemId;
    expect(await count(t, "select 1 from public.cart_items where id = $1", [cartItemId])).toBe(0);
    expect(await count(t, "select 1 from public.checkout_cart_claims where cart_item_id = $1", [cartItemId])).toBe(1);
  });

  it("a forged '+$0' option label is charged the configured surcharge", async () => {
    const outcome = await place(await body([{ selectedOptions: { ...BASIC_OPTIONS, paper: "Premium +$0" } }]));
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
    const outcome = await place(await body([{}], extra));
    expect(outcome.ok === false && outcome.httpStatus).toBe(400);
    expect(await count(t, "select 1 from public.orders")).toBe(before);
  });

  it.each([
    ["unit price", { price: 0 }],
    ["title", { title: "Free" }],
    ["image", { image: "https://evil.example/x.png" }],
    ["sku", { sku: "FREE" }],
  ])("rejects a forged line %s", async (_label, extra) => {
    expect((await place(await body([{ ...extra }]))).ok).toBe(false);
  });

  it("requires every order line to come from the customer's server-side cart", async () => {
    const outcome = await place(await body([{ cartItemId: null }]));
    expect(outcome.ok === false && outcome.httpStatus).toBe(400);
  });

  it("refuses another customer's cart line, and a cart line whose contents differ", async () => {
    const foreignLine = await addCartLine(t, { user: B, quantity: 1 });
    const foreign = await place(await body([{ cartItemId: foreignLine }]));
    expect(foreign.ok === false && foreign.code).toBe("CART_ITEM_NOT_FOUND");
    expect(await count(t, "select 1 from public.cart_items where id = $1", [foreignLine])).toBe(1);

    const line = await addCartLine(t, { quantity: 1 });
    const changed = await place(await body([{ cartItemId: line, quantity: 5 }]));
    expect(changed.ok === false && changed.code).toBe("CART_CHANGED");
  });

  it.each([
    ["draft", "product-draft"],
    ["hidden", "product-hidden"],
    ["sold out", "product-soldout"],
    ["non-existent", "product-does-not-exist"],
  ])("refuses a %s product", async (_label, productId) => {
    const outcome = await place(await body([{ productId, selectedOptions: BASIC_OPTIONS, cartItemId: "8f14e45f-ceea-4f67-9b1a-2a3c4d5e6f71" }]));
    expect(outcome.ok === false && outcome.httpStatus).toBe(422);
  });

  it("refuses unknown and foreign options", async () => {
    for (const options of [{ ...BASIC_OPTIONS, paper: "Gold Leaf" }, { ...BASIC_OPTIONS, discount: "100" }, { ...BASIC_OPTIONS, envelope: "Other Product Envelope" }]) {
      expect((await place(await body([{ selectedOptions: options }]))).ok).toBe(false);
    }
  });

  it("refuses a product priced in another currency and never mixes currencies", async () => {
    expect((await place(await body([{ productId: "product-usd", selectedOptions: { format: "Instant Download" } }]))).ok).toBe(false);
    const mixed = await place(await body([{ selectedOptions: BASIC_OPTIONS }, { productId: "product-usd", selectedOptions: { format: "Instant Download" } }]));
    expect(mixed.ok).toBe(false);
  });

  it("requires explicit acceptance of the current terms", async () => {
    expect((await place(await body([{}], { acceptTerms: false }))).ok).toBe(false);
    expect((await place(await body([{}], { termsVersion: "old" }))).ok).toBe(false);
  });

  it("fails closed with 503 when the catalogue cannot be loaded", async () => {
    const outcome = await place(await body(), A, {
      loadProducts: async () => {
        throw new Error("database unavailable");
      },
    });
    expect(outcome.ok === false && outcome.httpStatus).toBe(503);
  });

  /* ------------------------------------------------------- delivery & quote -- */

  it.each(["delivery", "store"] as const)("the %s quote equals the final checkout amount", async (deliveryMethod) => {
    const lines: LineSpec[] = [{ quantity: 3 }, { selectedOptions: BASIC_OPTIONS, quantity: 2 }];
    const request = await body(lines, deliveryMethod === "store" ? { deliveryMethod, addressLine1: undefined, city: undefined, postalCode: undefined } : { deliveryMethod });
    const quoteRequest = parseQuoteRequest({ deliveryMethod, items: request.items.map(({ cartItemId: _id, ...item }) => item) });
    expect(quoteRequest.ok).toBe(true);
    if (!("items" in quoteRequest)) return;
    const deps = createPgliteCheckoutDeps(t);
    const quote = buildQuote(quoteRequest.items, await deps.loadProducts(["product-active"]), quoteRequest.deliveryMethod);
    const outcome = await place(JSON.parse(JSON.stringify(request)));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(quote.total).toBe(outcome.order.total);
      expect(quote.deliveryCharge).toBe(outcome.order.deliveryCharge);
      expect(outcome.order.deliveryMethod).toBe(deliveryMethod);
    }
  });

  it("the quote refuses an unsupported delivery method and any client delivery price", () => {
    expect(parseQuoteRequest({ deliveryMethod: "drone", items: [{ productId: "product-active", quantity: 1 }] }).ok).toBe(false);
    expect(parseQuoteRequest({ items: [{ productId: "product-active", quantity: 1 }] }).ok).toBe(false);
    expect(parseQuoteRequest({ deliveryMethod: "delivery", deliveryCharge: 0, items: [{ productId: "product-active", quantity: 1 }] }).ok).toBe(false);
  });

  /* -------------------------------------------------------- personalization -- */

  it("accepts the customer's own upload with its description from the database", async () => {
    const outcome = await place(
      await body([{ selectedOptions: BASIC_OPTIONS, personalization: { bride_name: "Ayesha" }, uploads: { photo_upload: { path: `${A.id}/product/1/original.jpg` } } }]),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.order.items[0].customizationValues).toEqual({ bride_name: "Ayesha" });
      expect(outcome.order.items[0].uploadedFiles.photo_upload).toMatchObject({ name: "mine.jpg", bucket: "order-production", mimeType: "image/png", checksum: expect.stringMatching(/^[a-f0-9]{64}$/), size: expect.any(Number), path: expect.stringContaining(`orders/${outcome.order.id}/assets/`) });
    }
  });

  it("rejects another customer's upload path, unknown fields and links", async () => {
    expect((await place(await body([{ selectedOptions: BASIC_OPTIONS, uploads: { photo_upload: { path: `${B.id}/product/1/original.jpg` } } }]))).ok).toBe(false);
    expect((await place(await body([{ selectedOptions: BASIC_OPTIONS, personalization: { admin_note: "x" } }]))).ok).toBe(false);
    expect((await place(await body([{ selectedOptions: BASIC_OPTIONS, personalization: { bride_name: "javascript:alert(1)" } }]))).ok).toBe(false);
  });

  /* ----------------------------------------------------------- customizations -- */

  it("refuses another customer's design (same answer as a missing one)", async () => {
    const outcome = await place(await body([design(IDS.customizationB)]));
    expect(outcome.ok === false && outcome.httpStatus).toBe(404);
  });

  it("refuses a design for product A submitted as product B", async () => {
    const outcome = await place(await body([design(IDS.customizationDraftProduct)]));
    expect(outcome.ok === false && outcome.code).toBe("CUSTOMIZATION_PRODUCT_MISMATCH");
  });

  it("refuses a premium design submitted as a basic option", async () => {
    const outcome = await place(await body([design(IDS.customizationA2, { selectedOptions: { ...BASIC_OPTIONS, paper: "Signature Matte" } })]));
    expect(outcome.ok === false && outcome.code).toBe("CUSTOMIZATION_OPTIONS_MISMATCH");
  });

  it("refuses a design whose template version does not belong to the product", async () => {
    await t.db.query("update public.product_customizations set template_version = 99 where id = $1", [IDS.customizationA2]);
    const outcome = await place(await body([design(IDS.customizationA2)]));
    expect(outcome.ok === false && outcome.code).toBe("CUSTOMIZATION_TEMPLATE_VERSION_INVALID");
    await t.db.query("update public.product_customizations set template_version = 1 where id = $1", [IDS.customizationA2]);
  });

  it("refuses a deleted design", async () => {
    const outcome = await place(await body([design("30000000-0000-4000-8000-00000000dead")]));
    expect(outcome.ok === false && outcome.httpStatus).toBe(404);
  });

  it("ORDER INTEGRITY: one personalized order links order, item, snapshot, design, template, tasks exactly", async () => {
    const { transport, sent } = recordingTransport();
    const request = await body([design(IDS.customizationA, { cartItemId: IDS.cartItemA })]);
    const outcome = await place(request, A, {}, { transport });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const orderId = outcome.order.id;

    const order = (await t.db.query<any>("select * from public.orders where id = $1", [orderId])).rows[0];
    expect(order.checkout_state).toBe("finalized");
    const item = (await t.db.query<any>("select * from public.order_items where order_id = $1", [orderId])).rows[0];
    expect(item).toMatchObject({ line_number: 1, product_id: "product-active", product_title: "Pearl Invitation", product_slug: "pearl-invitation", customization_id: IDS.customizationA, currency: "BDT" });
    expect(Number(item.unit_price)).toBe(200);
    expect(Number(item.line_total)).toBe(400);

    const snapshot = (await t.db.query<any>("select * from public.order_design_snapshots where order_id = $1", [orderId])).rows[0];
    expect(snapshot).toMatchObject({ order_item_id: item.id, customization_id: IDS.customizationA, template_id: IDS.templateActive, template_version: 1, template_version_id: IDS.versionActive });
    expect(snapshot.snapshot.orderLineNumber).toBe(1);
    expect(snapshot.snapshot.values).toEqual({ names: "A & B" });

    const tasks = (await t.db.query<any>("select * from public.production_tasks where order_id = $1", [orderId])).rows;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ order_item_id: item.id, snapshot_id: snapshot.id, customization_id: IDS.customizationA, status: "completed" });
    expect(await count(t, "select 1 from public.customizer_render_jobs where order_id = $1", [orderId])).toBe(1);
    expect((await t.db.query<any>("select render_status from public.order_design_snapshots where id = $1", [snapshot.id])).rows[0].render_status).toBe("queued");

    const notifications = (await t.db.query<any>("select kind, status from public.notification_tasks where order_id = $1 order by kind", [orderId])).rows;
    expect(notifications).toEqual([
      { kind: "order_confirmation_customer", status: "sent" },
      { kind: "order_notification_admin", status: "sent" },
    ]);
    expect(sent.map((mail) => mail.to).sort()).toEqual([A.email, "orders@husnalogy.test"].sort());
    expect(sent.find((mail) => mail.to === A.email)?.text).toContain(orderId);

    const design_ = (await t.db.query<any>("select status, order_id, cart_item_id from public.product_customizations where id = $1", [IDS.customizationA])).rows[0];
    expect(design_).toEqual({ status: "ordered", order_id: orderId, cart_item_id: null });
    expect(await count(t, "select 1 from public.cart_items where id = $1", [IDS.cartItemA])).toBe(0);
  });

  it("TWO PERSONALIZED ITEMS: each snapshot links to its own order item (real snapshot builder)", async () => {
    const request = await body([
      design(IDS.customizationA2, { quantity: 3 }),
      design(IDS.customizationA3, { productId: "product-second", quantity: 1 }),
    ]);
    const outcome = await place(request);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const rows = (
      await t.db.query<any>(
        `select i.line_number, i.id as item_id, i.customization_id as item_design, i.product_id as item_product,
                s.id as snapshot_id, s.order_item_id, s.customization_id as snap_design, s.product_id as snap_product,
                s.template_version_id, (s.snapshot->>'orderLineNumber')::int as snap_line, pt.order_item_id as task_item, pt.snapshot_id as task_snapshot
           from public.order_items i
           join public.order_design_snapshots s on s.order_item_id = i.id
           join public.production_tasks pt on pt.snapshot_id = s.id
          where i.order_id = $1 order by i.line_number`,
        [outcome.order.id],
      )
    ).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ line_number: 1, item_design: IDS.customizationA2, snap_design: IDS.customizationA2, snap_product: "product-active", template_version_id: IDS.versionActive, snap_line: 1 });
    expect(rows[1]).toMatchObject({ line_number: 2, item_design: IDS.customizationA3, snap_design: IDS.customizationA3, snap_product: "product-second", template_version_id: IDS.versionSecond, snap_line: 2 });
    for (const row of rows) {
      expect(row.order_item_id).toBe(row.item_id);
      expect(row.task_item).toBe(row.item_id);
      expect(row.task_snapshot).toBe(row.snapshot_id);
    }
    expect(rows[0].snapshot_id).not.toBe(rows[1].snapshot_id);
    expect(await count(t, "select 1 from public.order_design_snapshots where order_id = $1 and order_item_id is null", [outcome.order.id])).toBe(0);
  });

  it("refuses to order an already ordered design again", async () => {
    const outcome = await place(await body([design(IDS.customizationA)]));
    expect(outcome.ok === false && outcome.code).toBe("CUSTOMIZATION_LOCKED");
  });

  it("refuses an ownerless legacy design", async () => {
    await t.db.query("alter table public.product_customizations drop constraint if exists product_customizations_owner_required");
    await t.db.query(
      "insert into public.product_customizations (id, user_id, product_id, template_id, template_version, status, selected_options) values ('30000000-0000-4000-8000-0000000000ff', $3, 'product-active', $1, 1, 'in_cart', $2::jsonb)",
      [IDS.templateActive, JSON.stringify(BASIC_OPTIONS), A.id],
    );
    await t.db.query("update public.product_customizations set user_id = null where id = '30000000-0000-4000-8000-0000000000ff'");
    const outcome = await place(await body([design("30000000-0000-4000-8000-0000000000ff", { selectedOptions: BASIC_OPTIONS })]));
    expect(outcome.ok === false && outcome.httpStatus).toBe(404);
  });

  /* ------------------------------------------------------- duplicate orders -- */

  it("a retried submission returns the same order (200), never a second one, and no second email", async () => {
    const { transport, sent } = recordingTransport();
    const request = await body();
    const first = await place(request, A, {}, { transport });
    const retry = await place(request, A, {}, { transport });
    expect(first.ok && first.httpStatus).toBe(201);
    expect(retry.ok && retry.httpStatus).toBe(200);
    expect(retry.ok && first.ok && retry.order.id).toBe(first.ok && first.order.id);
    expect(await count(t, "select 1 from public.orders where checkout_submission_id = $1", [request.checkoutSubmissionId])).toBe(1);
    if (first.ok) expect(await count(t, "select 1 from public.notification_tasks where order_id = $1", [first.order.id])).toBe(2);
    expect(sent).toHaveLength(2);
  });

  it("TWO TABS / DEVICES: same cart, DIFFERENT submission ids, simultaneous → exactly one order", async () => {
    const shared = await body([{ quantity: 2 }, { selectedOptions: BASIC_OPTIONS, quantity: 1 }]);
    const tabA = { ...shared, checkoutSubmissionId: `tab-a-${Date.now()}-aaaaaaaaaa` };
    const tabB = { ...shared, checkoutSubmissionId: `tab-b-${Date.now()}-bbbbbbbbbb` };
    const deviceC = { ...shared, checkoutSubmissionId: `device-c-${Date.now()}-cccccccc` };
    const outcomes = await Promise.all([place(tabA), place(tabB), place(deviceC)]);

    const created = outcomes.filter((outcome) => outcome.ok);
    const refused = outcomes.filter((outcome) => !outcome.ok);
    expect(created).toHaveLength(1);
    expect(refused).toHaveLength(2);
    const orderId = created[0].ok ? created[0].order.id : "";
    for (const outcome of refused) {
      expect(outcome.ok === false && outcome.code).toBe("CART_ALREADY_ORDERED");
      expect(outcome.ok === false && outcome.orderId).toBe(orderId);
    }
    const cartIds = shared.items.map((item) => item.cartItemId);
    expect(await count(t, "select 1 from public.checkout_cart_claims where cart_item_id = any($1::uuid[])", [cartIds])).toBe(2);
    expect(await count(t, "select distinct order_id from public.checkout_cart_claims where cart_item_id = any($1::uuid[])", [cartIds])).toBe(1);
    expect(await count(t, "select 1 from public.orders where checkout_submission_id in ($1, $2, $3)", [tabA.checkoutSubmissionId, tabB.checkoutSubmissionId, deviceC.checkoutSubmissionId])).toBe(1);
    expect(await count(t, "select 1 from public.notification_tasks where order_id = $1", [orderId])).toBe(2);
  });

  it("a NEW cart for the same product later is a new legitimate order", async () => {
    const first = await place(await body([{ quantity: 1 }]));
    const later = await place(await body([{ quantity: 1 }]));
    expect(first.ok && later.ok).toBe(true);
    expect(first.ok && later.ok && first.order.id !== later.order.id).toBe(true);
  });

  it("the same submission id with a different cart is a conflict that names the existing order", async () => {
    const request = await body();
    const first = await place(request);
    const changed = await place({ ...request, items: [{ ...request.items[0], quantity: 5 }] });
    expect(changed.ok === false && changed.code).toBe("SUBMISSION_REUSED");
    expect(changed.ok === false && changed.orderId).toBe(first.ok && first.order.id);
  });

  it("another customer presenting the same submission id gets their own order", async () => {
    const requestA = await body();
    const requestB = { ...(await body([{}], {}, B)), checkoutSubmissionId: requestA.checkoutSubmissionId };
    const a = await place(requestA, A);
    const b = await place(requestB, B);
    expect(a.ok && b.ok && a.order.id !== b.order.id).toBe(true);
  });

  /* ----------------------------------------------------------- failure modes -- */

  it("server committed but the database response was lost: the customer still gets the order", async () => {
    const request = await body();
    const deps = createPgliteCheckoutDeps(t);
    const outcome = await place(request, A, {
      createOrder: async (payload) => {
        await deps.createOrder(payload);
        throw new Error("socket hang up");
      },
    });
    expect(outcome.ok && outcome.idempotent).toBe(true);
    const retry = await place(request);
    expect(retry.ok && retry.httpStatus).toBe(200);
    expect(await count(t, "select 1 from public.orders where checkout_submission_id = $1", [request.checkoutSubmissionId])).toBe(1);
  });

  it("a failure inside the transaction leaves nothing behind, and the retry creates exactly one order", async () => {
    const request = await body([design("30000000-0000-4000-8000-0000000000a4")]);
    await t.db.query(
      "insert into public.product_customizations (id, user_id, product_id, template_id, template_version, status, selected_options) values ('30000000-0000-4000-8000-0000000000a4', $1, 'product-active', $2, 1, 'draft', $3::jsonb)",
      [A.id, IDS.templateActive, JSON.stringify({ ...BASIC_OPTIONS, paper: "Premium" })],
    );
    const deps = createPgliteCheckoutDeps(t);
    const failing = await place(request, A, {
      createOrder: (payload) => deps.createOrder({ ...payload, items: payload.items.map((item) => ({ ...item, quantity: 0, line_total: "0.00" })) }),
    });
    expect(failing.ok).toBe(false);
    expect(await count(t, "select 1 from public.orders where checkout_submission_id = $1", [request.checkoutSubmissionId])).toBe(0);
    expect(await count(t, "select 1 from public.cart_items where id = $1", [request.items[0].cartItemId])).toBe(1);
    const row = (await t.db.query<any>("select status, order_id from public.product_customizations where id = '30000000-0000-4000-8000-0000000000a4'")).rows[0];
    expect(row).toEqual({ status: "draft", order_id: null });

    const retry = await place(request);
    expect(retry.ok).toBe(true);
    expect(await count(t, "select 1 from public.orders where checkout_submission_id = $1", [request.checkoutSubmissionId])).toBe(1);
  });

  it("a partial order left by the OLD non-transactional code is never reported as success", async () => {
    const request = await body();
    await t.db.query(
      `insert into public.orders (id, customer_id, customer_name, customer_email, checkout_submission_id, checkout_state, request_hash, total, subtotal)
       values ('order-orphan-partial', $1, 'A', $2, $3, 'creating', null, 400, 400)`,
      [A.id, A.email, request.checkoutSubmissionId],
    );
    const retry = await place(request);
    expect(retry.ok === false && retry.code).toBe("CHECKOUT_INCOMPLETE");
    const visible = await t.asUser(A.id, A.email, (db) => db.query("select id from public.orders where id = 'order-orphan-partial'"));
    expect(visible.rows).toHaveLength(0);
  });

  it("a snapshot that is not linked to its line is refused before and inside the transaction", async () => {
    await t.db.query(
      "insert into public.product_customizations (id, user_id, product_id, template_id, template_version, status, selected_options) values ('30000000-0000-4000-8000-0000000000a5', $1, 'product-active', $2, 1, 'draft', $3::jsonb)",
      [A.id, IDS.templateActive, JSON.stringify({ ...BASIC_OPTIONS, paper: "Premium" })],
    );
    const deps = createPgliteCheckoutDeps(t);
    const request = await body([design("30000000-0000-4000-8000-0000000000a5")]);
    const unlinked = await place(request, A, {
      verifyCustomization: async (input) => {
        const verified = await deps.verifyCustomization(input);
        return verified.ok ? { ...verified, snapshot: { ...verified.snapshot, line_number: 7 } } : verified;
      },
    });
    expect(unlinked.ok === false && unlinked.code).toBe("SNAPSHOT_UNLINKED");
    // Bypass the application check: the database refuses too.
    const direct = await place(request, A, {
      createOrder: (payload) => deps.createOrder({ ...payload, snapshots: payload.snapshots.map((snapshot) => ({ ...snapshot, line_number: 7 })) }),
    });
    expect(direct.ok).toBe(false);
    expect(await count(t, "select 1 from public.orders where checkout_submission_id = $1", [request.checkoutSubmissionId])).toBe(0);
  });

  it("forced production-queue failure: order stays placed, the worker later creates exactly one render job", async () => {
    let renderDown = true;
    const request = await body([design("30000000-0000-4000-8000-0000000000a5")]);
    const outcome = await place(request, A, {}, { failRender: () => renderDown });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const orderId = outcome.order.id;
    const task = (await t.db.query<any>("select * from public.production_tasks where order_id = $1", [orderId])).rows[0];
    expect(task).toMatchObject({ status: "pending", attempt_count: 1 });
    expect(task.last_error).toContain("render service unavailable");
    expect(await count(t, "select 1 from public.customizer_render_jobs where order_id = $1", [orderId])).toBe(0);

    // The worker runs while the retry is not yet due: nothing happens.
    const early = await processTasks("production", productionStore(t), fakeRenderRunner(t), {});
    expect(early.claimed).toBe(0);

    // Backoff elapses; render service recovered; worker runs twice.
    renderDown = false;
    await t.db.query("update public.production_tasks set next_attempt_at = now() - interval '1 second' where order_id = $1", [orderId]);
    const first = await processTasks("production", productionStore(t), fakeRenderRunner(t), {});
    const second = await processTasks("production", productionStore(t), fakeRenderRunner(t), {});
    expect(first.completed).toBeGreaterThanOrEqual(1);
    expect(second.claimed).toBe(0);
    expect(await count(t, "select 1 from public.customizer_render_jobs where order_id = $1", [orderId])).toBe(1);
    expect((await t.db.query<any>("select status from public.production_tasks where order_id = $1", [orderId])).rows[0].status).toBe("completed");
    expect((await t.db.query<any>("select render_status from public.order_design_snapshots where order_id = $1", [orderId])).rows[0].render_status).toBe("queued");
  });

  it("a crashed worker's lease expires and the task is picked up again", async () => {
    const request = await body([design("30000000-0000-4000-8000-0000000000a6")]);
    await t.db.query(
      "insert into public.product_customizations (id, user_id, product_id, template_id, template_version, status, selected_options) values ('30000000-0000-4000-8000-0000000000a6', $1, 'product-active', $2, 1, 'draft', $3::jsonb)",
      [A.id, IDS.templateActive, JSON.stringify({ ...BASIC_OPTIONS, paper: "Premium" })],
    );
    // Fast path never runs (process died right after commit).
    const outcome = await place(request, A, { afterOrderCreated: async () => undefined });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const claimed = await productionStore(t).claim(10, outcome.order.id);
    expect(claimed).toHaveLength(1); // a worker claims it, then "crashes"
    expect(await productionStore(t).claim(10, outcome.order.id)).toHaveLength(0); // leased
    await t.db.query("update public.production_tasks set locked_until = now() - interval '1 second' where order_id = $1", [outcome.order.id]);
    const recovered = await processTasks("production", productionStore(t), fakeRenderRunner(t), { orderId: outcome.order.id });
    expect(recovered.completed).toBe(1);
    expect(await count(t, "select 1 from public.customizer_render_jobs where order_id = $1", [outcome.order.id])).toBe(1);
  });

  it("email failure never rolls back the order; retry eventually sends exactly once per task", async () => {
    let providerDown = true;
    const { transport, sent } = recordingTransport(() => providerDown);
    const outcome = await place(await body(), A, {}, { transport });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const orderId = outcome.order.id;
    expect((await t.db.query<any>("select checkout_state from public.orders where id = $1", [orderId])).rows[0].checkout_state).toBe("finalized");
    expect((await t.db.query<any>("select status from public.notification_tasks where order_id = $1", [orderId])).rows.every((row) => row.status === "pending")).toBe(true);

    providerDown = false;
    await t.db.query("update public.notification_tasks set next_attempt_at = now() - interval '1 second' where order_id = $1", [orderId]);
    const runner = makeNotificationRunner({ transport, adminRecipient: "orders@husnalogy.test", loadOrder: (id) => loadOrderView(t, id) });
    await processTasks("notification", notificationStore(t), runner, { orderId });
    await processTasks("notification", notificationStore(t), runner, { orderId });
    expect(sent.filter((mail) => mail.text.includes(orderId))).toHaveLength(2);
    expect((await t.db.query<any>("select status from public.notification_tasks where order_id = $1", [orderId])).rows.every((row) => row.status === "sent")).toBe(true);
  });

  it("with no email provider configured, notifications wait without burning attempts", async () => {
    const outcome = await place(await body(), A, {}, { transport: null });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const rows = (await t.db.query<any>("select status, attempt_count, last_error from public.notification_tasks where order_id = $1", [outcome.order.id])).rows;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe("pending");
      expect(row.attempt_count).toBe(0);
      expect(row.last_error).toContain("not configured");
    }
  });

  it("a failed follow-up never turns a placed order into a failure", async () => {
    const outcome = await place(await body(), A, {
      afterOrderCreated: async () => {
        throw new Error("render queue down");
      },
    });
    expect(outcome.ok).toBe(true);
  });

  it("a product edited between pricing and commit aborts with PRICE_CHANGED and keeps the cart", async () => {
    const request = await body();
    const deps = createPgliteCheckoutDeps(t);
    const outcome = await place(request, A, {
      createOrder: async (payload) => {
        await t.db.query("update public.products set updated_at = now() + interval '1 second' where id = 'product-active'");
        return deps.createOrder(payload);
      },
    });
    expect(outcome.ok === false && outcome.code).toBe("PRICE_CHANGED");
    expect(await count(t, "select 1 from public.cart_items where id = $1", [request.items[0].cartItemId])).toBe(1);
  });

  it("unauthenticated or email-less users cannot check out", async () => {
    expect((await place(await body(), { id: "", email: "" })).ok).toBe(false);
    expect((await place(await body(), { id: A.id, email: "" })).ok).toBe(false);
  });
});
