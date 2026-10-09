/**
 * Database integration tests against the REAL schema + every migration,
 * running in a disposable in-process Postgres (PGlite). Nothing here touches
 * a Supabase project or customer data.
 *
 * Covers: RLS row isolation, column-level write guards, the checkout
 * transaction (atomicity, rollback, idempotency, guards), immutability
 * triggers, integrity constraints and the storage IDOR fix.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/testing/pglite-supabase";
import { BASIC_OPTIONS, IDS, USERS, callCheckoutRpc, count, orderPayload, seedCheckoutFixtures, updatedAt } from "@/lib/testing/checkout-fixtures";

const A = USERS.customerA;
const B = USERS.customerB;

async function freshDatabase(): Promise<TestDatabase> {
  const t = await createTestDatabase();
  await seedCheckoutFixtures(t);
  return t;
}

async function expectDbError(work: Promise<unknown>, pattern: RegExp) {
  let caught: unknown = null;
  try {
    await work;
  } catch (error) {
    caught = error;
  }
  expect(caught, "expected the database to refuse").toBeTruthy();
  expect(String((caught as Error)?.message || caught)).toMatch(pattern);
}

describe("checkout transaction: success, atomicity and fixed initial state", () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await freshDatabase();
  }, 120_000);
  afterAll(() => t?.close());

  it("creates a finalized order, its items and snapshot, and binds the design, in one call", async () => {
    const payload = await orderPayload(t);
    const result = await callCheckoutRpc(t, payload);
    expect(result).toEqual({ status: "created", order_id: payload.order.id });

    const order = (await t.db.query<any>("select * from public.orders where id = $1", [payload.order.id])).rows[0];
    expect(order.checkout_state).toBe("finalized");
    expect(order.finalized_at).toBeTruthy();
    // Hostile values in the payload were ignored: COD orders start unpaid/pending.
    expect(order.payment_status).toBe("unpaid");
    expect(order.status).toBe("pending");
    expect(order.payment_method).toBe("cash_on_delivery");
    expect(order.terms_accepted_by_user_id).toBe(A.id);
    expect(order.terms_version).toBe("2026-09-30");
    expect(Number(order.total)).toBe(400);

    expect(await count(t, "select 1 from public.order_items where order_id = $1", [payload.order.id])).toBe(1);
    const snapshot = (await t.db.query<any>("select * from public.order_design_snapshots where order_id = $1", [payload.order.id])).rows[0];
    const item = (await t.db.query<any>("select id from public.order_items where order_id = $1", [payload.order.id])).rows[0];
    expect(snapshot.order_item_id).toBe(item.id);

    const customization = (await t.db.query<any>("select status, order_id, cart_item_id from public.product_customizations where id = $1", [IDS.customizationA])).rows[0];
    expect(customization).toEqual({ status: "ordered", order_id: payload.order.id, cart_item_id: null });
  });

  it("rolls back EVERYTHING when an order item fails (no partial order can exist)", async () => {
    const payload = await orderPayload(t, { customizationId: IDS.customizationA2 });
    payload.items[0].quantity = 0; // violates the quantity CHECK
    payload.items[0].line_total = "0.00";
    payload.order.subtotal = "0.00";
    payload.order.total = "0.00";
    await expectDbError(callCheckoutRpc(t, payload), /check|quantity/i);

    expect(await count(t, "select 1 from public.orders where id = $1", [payload.order.id])).toBe(0);
    expect(await count(t, "select 1 from public.order_items where order_id = $1", [payload.order.id])).toBe(0);
    expect(await count(t, "select 1 from public.order_design_snapshots where order_id = $1", [payload.order.id])).toBe(0);
    const customization = (await t.db.query<any>("select status, order_id from public.product_customizations where id = $1", [IDS.customizationA2])).rows[0];
    expect(customization).toEqual({ status: "draft", order_id: null });
  });

  it("rolls back when a snapshot does not belong to the guarded designs", async () => {
    const payload = await orderPayload(t, { customizationId: IDS.customizationA2 });
    payload.snapshots[0].customization_id = IDS.customizationB;
    await expectDbError(callCheckoutRpc(t, payload), /CHECKOUT_SNAPSHOT_MISMATCH/);
    expect(await count(t, "select 1 from public.orders where id = $1", [payload.order.id])).toBe(0);
  });

  it("rolls back when a customized line has no frozen snapshot", async () => {
    const payload = await orderPayload(t, { customizationId: IDS.customizationA2 });
    payload.snapshots = [];
    await expectDbError(callCheckoutRpc(t, payload), /CHECKOUT_SNAPSHOT_MISSING/);
    expect(await count(t, "select 1 from public.orders where id = $1", [payload.order.id])).toBe(0);
  });

  it("re-verifies the arithmetic inside the transaction", async () => {
    const payload = await orderPayload(t, { customizationId: IDS.customizationA2 });
    payload.order.total = "1.00";
    await expectDbError(callCheckoutRpc(t, payload), /CHECKOUT_ARITHMETIC_MISMATCH|total_arithmetic/);
    const lineMismatch = await orderPayload(t, { customizationId: IDS.customizationA2 });
    lineMismatch.items[0].line_total = "1.00";
    await expectDbError(callCheckoutRpc(t, lineMismatch), /CHECKOUT_ARITHMETIC_MISMATCH/);
    expect(await count(t, "select 1 from public.orders where customer_id = $1 and checkout_state = 'finalized'", [A.id])).toBe(1);
  });

  it("refuses a currency mismatch between the order and a line", async () => {
    const payload = await orderPayload(t, { customizationId: IDS.customizationA2 });
    payload.items[0].currency = "USD";
    await expectDbError(callCheckoutRpc(t, payload), /CHECKOUT_CURRENCY_MISMATCH/);
  });
});

describe("checkout transaction: idempotency and duplicate prevention", () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await freshDatabase();
  }, 120_000);
  afterAll(() => t?.close());

  it("replays the same submission id + payload instead of creating a second order", async () => {
    const payload = await orderPayload(t, { submissionId: "retry-submission-0001", requestHash: "same-hash" });
    const first = await callCheckoutRpc(t, payload);
    const retry = await callCheckoutRpc(t, { ...payload, order: { ...payload.order, id: "order-should-not-exist" } });
    expect(first.status).toBe("created");
    expect(retry).toEqual({ status: "replayed", order_id: payload.order.id });
    expect(await count(t, "select 1 from public.orders where checkout_submission_id = 'retry-submission-0001'")).toBe(1);
    expect(await count(t, "select 1 from public.orders where id = 'order-should-not-exist'")).toBe(0);
  });

  it("reports a conflict when the same submission id carries a different payload", async () => {
    const payload = await orderPayload(t, { submissionId: "retry-submission-0001", requestHash: "different-hash", customizationId: null });
    const result = await callCheckoutRpc(t, payload);
    expect(result.status).toBe("conflict");
  });

  it("serializes simultaneous submissions: exactly one order; the rest replay or are refused while it is prepared", async () => {
    const payload = await orderPayload(t, { submissionId: "parallel-submission-01", requestHash: "p-hash", customizationId: null });
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        callCheckoutRpc(t, { ...payload, order: { ...payload.order, id: `order-parallel-${index}` } }).catch((error: Error) => ({ status: "busy", order_id: "", error: error.message })),
      ),
    );
    expect(results.filter((result) => result.status === "created")).toHaveLength(1);
    // A concurrent twin either waits out the first (replay) or is refused by
    // the preparation lease before doing any work; it never creates an order.
    expect(results.every((result) => ["created", "replayed", "busy"].includes(result.status))).toBe(true);
    for (const result of results.filter((entry) => entry.status === "busy")) expect((result as { error: string }).error).toMatch(/CHECKOUT_PREPARATION_BUSY/);
    expect(new Set(results.filter((result) => result.order_id).map((result) => result.order_id)).size).toBe(1);
    expect(await count(t, "select 1 from public.orders where checkout_submission_id = 'parallel-submission-01'")).toBe(1);
    // After the first commits, every retry of the same submission replays it.
    const retry = await callCheckoutRpc(t, { ...payload, order: { ...payload.order, id: "order-parallel-retry" } });
    expect(retry).toEqual({ status: "replayed", order_id: results.find((result) => result.status === "created")!.order_id });
  });

  it("scopes the key per customer: B reusing A's submission id gets an independent order", async () => {
    const payload = await orderPayload(t, { customer: B, submissionId: "retry-submission-0001", requestHash: "same-hash", customizationId: null });
    const result = await callCheckoutRpc(t, payload);
    expect(result).toEqual({ status: "created", order_id: payload.order.id });
  });

  it("never returns an incomplete (non-finalized) order as a success", async () => {
    await t.db.query(
      `insert into public.orders (id, customer_id, customer_name, customer_email, checkout_submission_id, checkout_state, request_hash)
       values ('order-partial-legacy', $1, 'A', $2, 'partial-submission-01', 'creating', 'h')`,
      [A.id, A.email],
    );
    const payload = await orderPayload(t, { submissionId: "partial-submission-01", requestHash: "h", customizationId: null });
    expect(await callCheckoutRpc(t, payload)).toEqual({ status: "incomplete", order_id: "order-partial-legacy" });
  });

  it("a failed checkout can never be promoted to a finalized order", async () => {
    await t.db.query("update public.orders set checkout_state = 'failed' where id = 'order-partial-legacy'");
    await expectDbError(
      t.asService((db) => db.query("update public.orders set checkout_state = 'finalized' where id = 'order-partial-legacy'")),
      /cannot become a finalized order/,
    );
  });

  it("the unique index is a backstop even outside the RPC", async () => {
    await expectDbError(
      t.asService((db) =>
        db.query(
          `insert into public.orders (id, customer_id, customer_name, customer_email, checkout_submission_id)
           values ('order-dup', $1, 'A', $2, 'parallel-submission-01')`,
          [A.id, A.email],
        ),
      ),
      /duplicate key|unique/i,
    );
  });

  it("a personalized design can be ordered only once, even under a new submission id", async () => {
    const first = await orderPayload(t, { customizationId: IDS.customizationA2 });
    expect((await callCheckoutRpc(t, first)).status).toBe("created");
    const second = await orderPayload(t, { customizationId: IDS.customizationA2 });
    // The guard reads a fresh updated_at, so only the status check can stop it.
    await expectDbError(callCheckoutRpc(t, second), /CHECKOUT_CUSTOMIZATION_LOCKED/);
  });
});

describe("checkout transaction: trusted guards", () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await freshDatabase();
  }, 120_000);
  afterAll(() => t?.close());

  it("aborts when the product changed after it was priced", async () => {
    const payload = await orderPayload(t, { customizationId: null });
    await t.db.query("update public.products set sale_price = 1 where id = 'product-active'");
    await expectDbError(callCheckoutRpc(t, payload), /CHECKOUT_PRICE_CHANGED/);
  });

  it.each([
    ["draft", "product-draft"],
    ["hidden", "product-hidden"],
    ["sold out", "product-soldout"],
    ["non-existent", "product-missing"],
  ])("refuses a %s product", async (_label, productId) => {
    const payload = await orderPayload(t, { customizationId: null, productId: "product-active" });
    payload.guards.products = [{ id: productId, updated_at: (await updatedAt(t, "products", productId)) || "2026-01-01" }];
    await expectDbError(callCheckoutRpc(t, payload), /CHECKOUT_PRODUCT_UNAVAILABLE/);
  });

  it("refuses another customer's design", async () => {
    const payload = await orderPayload(t, { customizationId: IDS.customizationB });
    await expectDbError(callCheckoutRpc(t, payload), /CHECKOUT_CUSTOMIZATION_FORBIDDEN/);
  });

  it("refuses a design made for a different product", async () => {
    const payload = await orderPayload(t, { customizationId: IDS.customizationDraftProduct });
    await expectDbError(callCheckoutRpc(t, payload), /CHECKOUT_CUSTOMIZATION_MISMATCH/);
  });

  it("refuses a design that changed after it was validated", async () => {
    const payload = await orderPayload(t, { customizationId: IDS.customizationA2 });
    await t.db.query("update public.product_customizations set values = '{\"names\":\"edited in another tab\"}'::jsonb where id = $1", [IDS.customizationA2]);
    await expectDbError(callCheckoutRpc(t, payload), /CHECKOUT_CUSTOMIZATION_CHANGED/);
  });

  it("refuses an ownerless (legacy) design", async () => {
    await t.db.query("alter table public.product_customizations drop constraint product_customizations_owner_required");
    await t.db.query("update public.product_customizations set user_id = null where id = $1", [IDS.customizationA]);
    const payload = await orderPayload(t, { customizationId: IDS.customizationA });
    await expectDbError(callCheckoutRpc(t, payload), /CHECKOUT_CUSTOMIZATION_FORBIDDEN/);
  });

  it("refuses a deleted design", async () => {
    const payload = await orderPayload(t, { customizationId: "30000000-0000-4000-8000-00000000dead" });
    payload.guards.customizations[0].updated_at = "2026-01-01";
    await expectDbError(callCheckoutRpc(t, payload), /CHECKOUT_CUSTOMIZATION_NOT_FOUND/);
  });

  it("is not callable by customers or anonymous users", async () => {
    const payload = await orderPayload(t, { customizationId: null });
    const call = (role: "user" | "anon") => {
      const work = (db: any) =>
        db.query("select public.create_checkout_order($1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb)", [
          JSON.stringify(payload.order),
          JSON.stringify(payload.items),
          JSON.stringify(payload.snapshots),
          JSON.stringify(payload.guards),
        ]);
      return role === "user" ? t.asUser(A.id, A.email, work) : t.asAnon(work);
    };
    await expectDbError(call("user"), /permission denied/i);
    await expectDbError(call("anon"), /permission denied/i);
  });
});

describe("RLS and column authorization for customers", () => {
  let t: TestDatabase;
  let orderId = "";
  beforeAll(async () => {
    t = await freshDatabase();
    const payload = await orderPayload(t, { customizationId: IDS.customizationA2 });
    orderId = (await callCheckoutRpc(t, payload)).order_id;
  }, 120_000);
  afterAll(() => t?.close());

  it("customers cannot write product_customizations directly (any column)", async () => {
    for (const statement of [
      "update public.product_customizations set status = 'ordered' where id = $1",
      "update public.product_customizations set print_files = '{\"front\":{\"path\":\"x\"}}'::jsonb where id = $1",
      "update public.product_customizations set template_version = 99 where id = $1",
      "update public.product_customizations set product_id = 'product-draft' where id = $1",
      "update public.product_customizations set selected_options = '{\"paper\":\"Premium +$0\"}'::jsonb where id = $1",
      "delete from public.product_customizations where id = $1",
    ]) {
      await expectDbError(t.asUser(A.id, A.email, (db) => db.query(statement, [IDS.customizationA])), /permission denied|through the Husnalogy API/i);
    }
    await expectDbError(
      t.asUser(A.id, A.email, (db) =>
        db.query("insert into public.product_customizations (user_id, product_id, status) values ($1, 'product-active', 'ordered')", [A.id]),
      ),
      /permission denied|through the Husnalogy API/i,
    );
  });

  it("the guard trigger holds even if table grants are re-added later", async () => {
    await t.db.query("grant insert, update, delete on public.product_customizations to authenticated");
    await expectDbError(
      t.asUser(A.id, A.email, (db) => db.query("update public.product_customizations set status = 'draft' where id = $1", [IDS.customizationA])),
      /through the Husnalogy API/,
    );
    await t.db.query("revoke insert, update, delete on public.product_customizations from authenticated");
  });

  it("customers read only their own customizations", async () => {
    const own = await t.asUser(A.id, A.email, (db) => db.query("select id from public.product_customizations where id = $1", [IDS.customizationA]));
    const foreign = await t.asUser(A.id, A.email, (db) => db.query("select id from public.product_customizations where id = $1", [IDS.customizationB]));
    expect(own.rows).toHaveLength(1);
    expect(foreign.rows).toHaveLength(0);
  });

  it("customers see only their own FINALIZED orders and order items", async () => {
    await t.db.query(
      `insert into public.orders (id, customer_id, customer_name, customer_email, checkout_state) values ('order-hidden-failed', $1, 'A', $2, 'failed')`,
      [A.id, A.email],
    );
    const aOrders = await t.asUser(A.id, A.email, (db) => db.query<any>("select id from public.orders"));
    expect(aOrders.rows.map((row) => row.id)).toEqual([orderId]);
    const bOrders = await t.asUser(B.id, B.email, (db) => db.query("select id from public.orders"));
    expect(bOrders.rows).toHaveLength(0);
    const bItems = await t.asUser(B.id, B.email, (db) => db.query("select id from public.order_items"));
    expect(bItems.rows).toHaveLength(0);
  });

  it("an email claim alone no longer grants access to an order", async () => {
    await t.db.query(
      `insert into public.orders (id, customer_id, customer_name, customer_email) values ('order-guest-legacy', null, 'Guest', $1)`,
      [B.email],
    );
    const rows = await t.asUser(B.id, B.email, (db) => db.query("select id from public.orders where id = 'order-guest-legacy'"));
    expect(rows.rows).toHaveLength(0);
  });

  it("customers cannot create or modify orders, items or snapshots", async () => {
    await expectDbError(
      t.asUser(A.id, A.email, (db) =>
        db.query("insert into public.orders (id, customer_id, customer_name, customer_email, total) values ('forged', $1, 'A', $2, 0)", [A.id, A.email]),
      ),
      /row-level security|permission denied/i,
    );
    const paid = await t.asUser(A.id, A.email, (db) => db.query("update public.orders set payment_status = 'paid', status = 'delivered' where id = $1", [orderId]));
    expect(paid.affectedRows ?? 0).toBe(0);
    const row = (await t.db.query<any>("select payment_status, status from public.orders where id = $1", [orderId])).rows[0];
    expect(row).toEqual({ payment_status: "unpaid", status: "pending" });

    const snapshots = await t.asUser(A.id, A.email, (db) => db.query("select id from public.order_design_snapshots"));
    expect(snapshots.rows).toHaveLength(0);
  });

  it("customers cannot escalate their role or rewrite their profile email", async () => {
    await expectDbError(
      t.asUser(A.id, A.email, (db) => db.query("update public.profiles set role = 'admin' where id = $1", [A.id])),
      /administrator/i,
    );
    await expectDbError(
      t.asUser(A.id, A.email, (db) => db.query("update public.profiles set email = $2 where id = $1", [A.id, B.email])),
      /managed by Husnalogy/,
    );
    const ok = await t.asUser(A.id, A.email, (db) => db.query("update public.profiles set full_name = 'Ayesha R.' where id = $1", [A.id]));
    expect(ok.affectedRows).toBe(1);
  });

  it("customers can still manage their own cart, and cannot touch another customer's", async () => {
    const foreign = await t.asUser(B.id, B.email, (db) => db.query("delete from public.cart_items where id = $1", [IDS.cartItemA2]));
    expect(foreign.affectedRows ?? 0).toBe(0);
    const own = await t.asUser(A.id, A.email, (db) => db.query("delete from public.cart_items where id = $1", [IDS.cartItemA2]));
    expect(own.affectedRows).toBe(1);
  });

  it("deleting the cart line of an ORDERED design succeeds (FK set-null is allowed)", async () => {
    // Legacy shape: ordered before the RPC detached cart lines.
    await t.db.query("update public.product_customizations set cart_item_id = $2 where id = $1", [IDS.customizationA2, IDS.cartItemA]);
    const result = await t.asUser(A.id, A.email, (db) => db.query("delete from public.cart_items where id = $1", [IDS.cartItemA]));
    expect(result.affectedRows).toBe(1);
    const row = (await t.db.query<any>("select status, cart_item_id from public.product_customizations where id = $1", [IDS.customizationA2])).rows[0];
    expect(row).toEqual({ status: "ordered", cart_item_id: null });
  });
});

describe("immutability of finalized orders, snapshots and published templates", () => {
  let t: TestDatabase;
  let orderId = "";
  beforeAll(async () => {
    t = await freshDatabase();
    orderId = (await callCheckoutRpc(t, await orderPayload(t))).order_id;
  }, 120_000);
  afterAll(() => t?.close());

  it("the server can change fulfilment/payment status and the delivery quote of a finalized order", async () => {
    const result = await t.asService((db) =>
      db.query("update public.orders set status = 'confirmed', payment_status = 'paid', delivery_charge = 60, total = subtotal + 60 where id = $1", [orderId]),
    );
    expect(result.affectedRows).toBe(1);
  });

  it("the priced subtotal, owner and identity of a finalized order are immutable", async () => {
    await expectDbError(t.asService((db) => db.query("update public.orders set subtotal = 1, total = 61 where id = $1", [orderId])), /cannot be changed/);
    await expectDbError(t.asService((db) => db.query("update public.orders set customer_id = $2 where id = $1", [orderId, B.id])), /cannot be reassigned/);
    await expectDbError(t.asService((db) => db.query("update public.orders set checkout_submission_id = 'x' where id = $1", [orderId])), /cannot be changed/);
  });

  it("the total must equal subtotal + delivery", async () => {
    await expectDbError(t.asService((db) => db.query("update public.orders set total = 1 where id = $1", [orderId])), /total_arithmetic/);
  });

  it("order item pricing is immutable", async () => {
    await expectDbError(t.asService((db) => db.query("update public.order_items set unit_price = 0, line_total = 0 where order_id = $1", [orderId])), /immutable/);
  });

  it("snapshots accept render progress but never content changes", async () => {
    const progress = await t.asService((db) =>
      db.query("update public.order_design_snapshots set render_status = 'queued', print_files = '{\"front\":{}}'::jsonb where order_id = $1", [orderId]),
    );
    expect(progress.affectedRows).toBe(1);
    for (const column of ["snapshot = '{}'::jsonb", "pricing = '{}'::jsonb", "selected_options = '{}'::jsonb", "quantity = 1", "integrity_hash = 'forged'"]) {
      await expectDbError(t.asService((db) => db.query(`update public.order_design_snapshots set ${column} where order_id = $1`, [orderId])), /immutable/);
    }
  });

  it("an ordered design cannot be unlocked, re-bound or edited", async () => {
    for (const statement of [
      "update public.product_customizations set status = 'draft' where id = $1",
      "update public.product_customizations set order_id = 'other-order' where id = $1",
      "update public.product_customizations set values = '{}'::jsonb where id = $1",
    ]) {
      await expectDbError(t.asService((db) => db.query(statement, [IDS.customizationA])), /immutable/);
    }
  });

  it("published template versions are immutable", async () => {
    for (const column of ["document = '{}'::jsonb", "product_id = 'product-draft'", "version = 7"]) {
      await expectDbError(
        t.asService((db) => db.query(`update public.customizer_template_versions set ${column} where id = $1`, [IDS.versionActive])),
        /immutable/,
      );
    }
  });

  it("new order rows must satisfy the money constraints", async () => {
    await expectDbError(
      t.asService((db) =>
        db.query("insert into public.orders (id, customer_id, customer_name, customer_email, subtotal, delivery_charge, total) values ('neg', $1, 'A', $2, -1, 0, -1)", [A.id, A.email]),
      ),
      /money_non_negative|check/i,
    );
    await expectDbError(
      t.asService((db) =>
        db.query("insert into public.orders (id, customer_id, customer_name, customer_email, payment_status) values ('bad-status', $1, 'A', $2, 'verified')", [A.id, A.email]),
      ),
      /payment_status/,
    );
  });
});

describe("customer uploads: no cross-customer file access", () => {
  let t: TestDatabase;
  const bPath = `${B.id}/customizer/photo/original.jpg`;
  beforeAll(async () => {
    t = await freshDatabase();
    await t.db.query("insert into storage.objects (bucket_id, name) values ('customer-uploads', $1)", [bPath]);
    await t.db.query("insert into public.customer_uploads (user_id, bucket, path) values ($1, 'customer-uploads', $2)", [B.id, bPath]);
  }, 120_000);
  afterAll(() => t?.close());

  const readB = (user: { id: string; email: string }) =>
    t.asUser(user.id, user.email, (db) => db.query("select name from storage.objects where bucket_id = 'customer-uploads' and name = $1", [bPath]));

  it("the owner can read their file; another customer cannot", async () => {
    expect((await readB(B)).rows).toHaveLength(1);
    expect((await readB(A)).rows).toHaveLength(0);
  });

  it("a customer cannot forge an upload row that assigns themselves to someone else's file", async () => {
    await expectDbError(
      t.asUser(USERS.customerC.id, USERS.customerC.email, (db) =>
        db.query("insert into public.customer_uploads (user_id, bucket, path, assigned_designer_id) values ($1, 'customer-uploads', $2, $1)", [USERS.customerC.id, bPath]),
      ),
      /managed by Husnalogy|owner/i,
    );
    await expectDbError(
      t.asUser(USERS.customerC.id, USERS.customerC.email, (db) =>
        db.query("insert into public.customer_uploads (user_id, bucket, path) values ($1, 'customer-uploads', $2)", [USERS.customerC.id, bPath]),
      ),
      /own folder/,
    );
    expect((await readB(USERS.customerC)).rows).toHaveLength(0);
  });

  it("a designer cannot self-assign; an admin-assigned designer can read", async () => {
    const designer = USERS.designer;
    await expectDbError(
      t.asUser(designer.id, designer.email, (db) =>
        db.query("insert into public.customer_uploads (user_id, bucket, path, assigned_designer_id) values ($1, 'customer-uploads', $2, $1)", [designer.id, bPath]),
      ),
      /managed by Husnalogy|own folder/,
    );
    expect((await readB(designer)).rows).toHaveLength(0);
    await t.db.query("update public.customer_uploads set assigned_designer_id = $1 where path = $2 and user_id = $3", [designer.id, bPath, B.id]);
    expect((await readB(designer)).rows).toHaveLength(1);
  });

  it("customers can no longer write into the uploads bucket directly", async () => {
    await expectDbError(
      t.asUser(A.id, A.email, (db) => db.query("insert into storage.objects (bucket_id, name) values ('customer-uploads', $1)", [`${A.id}/x/evil.html`])),
      /row-level security/i,
    );
  });

  it("the asset library can only describe files in the owner's own folder", async () => {
    await expectDbError(
      t.asUser(A.id, A.email, (db) =>
        db.query("insert into public.customer_asset_library (user_id, bucket, path, file_name, mime_type) values ($1, 'customer-uploads', $2, 'x.jpg', 'image/jpeg')", [A.id, bPath]),
      ),
      /customer_asset_library_owner_paths/,
    );
  });
});

describe("option data used by the fixtures", () => {
  it("keeps the basic option set in sync with the seeded product", () => {
    expect(Object.keys(BASIC_OPTIONS).sort()).toEqual(["corner", "envelope", "format", "paper", "printing", "size"]);
  });
});

describe("the documented deployment verification query", () => {
  it("reports the checkout hardening as applied", async () => {
    const { readFileSync } = await import("node:fs");
    const doc = readFileSync("docs/HOSTINGER_DEPLOYMENT.md", "utf8");
    const sql = doc.split("```sql")[1].split("```")[0];
    const t = await createTestDatabase();
    try {
      const rows = (await t.db.query<{ migration: string; applied: boolean }>(sql)).rows;
      const mine = rows.filter((row) =>
        [
          "checkout transaction", "durable order state", "one order per design", "customization writes guarded", "snapshots immutable",
          "upload storage IDOR closed", "profile role protected", "no direct order inserts", "cart consumption", "snapshot linkage required",
          "production outbox", "notification outbox", "worker health", "one snapshot guard", "outbox not customer callable",
        ].includes(row.migration),
      );
      expect(mine).toHaveLength(15);
      expect(mine.filter((row) => !row.applied)).toEqual([]);
    } finally {
      await t.close();
    }
  }, 120_000);
});
