/**
 * Database integration tests for cart consumption, snapshot linkage, identity
 * immutability, the production/notification outbox and failure atomicity —
 * against the real schema + migrations in PGlite.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/testing/pglite-supabase";
import { IDS, USERS, addCartLine, callCheckoutRpc, count, orderPayload, seedCheckoutFixtures } from "@/lib/testing/checkout-fixtures";
import { makeNotificationRunner } from "@/lib/notifications/notification-runner";
import { orderFromRow } from "@/lib/orders/order-view";
import type { EmailMessage } from "@/lib/notifications/order-email";

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

async function newDesign(t: TestDatabase, productId = "product-active") {
  const id = (await t.db.query<{ id: string }>("select gen_random_uuid()::text as id")).rows[0].id;
  const template = productId === "product-second" ? IDS.templateSecond : IDS.templateActive;
  await t.db.query(
    "insert into public.product_customizations (id, user_id, product_id, template_id, template_version, status) values ($1, $2, $3, $4, 1, 'draft')",
    [id, A.id, productId, template],
  );
  return id;
}

describe("cart consumption inside the checkout transaction", () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await freshDatabase();
  }, 120_000);
  afterAll(() => t?.close());

  it("claims and removes the cart line together with the order", async () => {
    const payload = await orderPayload(t, { customizationId: null });
    const result = await callCheckoutRpc(t, payload);
    expect(result.status).toBe("created");
    expect(await count(t, "select 1 from public.cart_items where id = $1", [payload.cartItemId])).toBe(0);
    const claim = (await t.db.query<any>("select * from public.checkout_cart_claims where cart_item_id = $1", [payload.cartItemId])).rows[0];
    expect(claim).toMatchObject({ order_id: result.order_id, customer_id: A.id, line_number: 1 });
  });

  it("a second checkout of the same cart line with a NEW submission id is refused with the first order's id", async () => {
    const first = await orderPayload(t, { customizationId: null });
    const created = await callCheckoutRpc(t, first);
    const second = await orderPayload(t, { customizationId: null, cartItemId: first.cartItemId });
    await expectDbError(callCheckoutRpc(t, second), /CHECKOUT_CART_ALREADY_ORDERED/);
    let detail = "";
    try {
      await callCheckoutRpc(t, second);
    } catch (error: any) {
      detail = error.detail;
    }
    expect(detail).toBe(created.order_id);
    expect(await count(t, "select 1 from public.orders where id = $1", [second.order.id])).toBe(0);
  });

  it("the same submission replayed still replays (idempotency is checked before the cart)", async () => {
    const payload = await orderPayload(t, { customizationId: null });
    const created = await callCheckoutRpc(t, payload);
    expect(await callCheckoutRpc(t, payload)).toEqual({ status: "replayed", order_id: created.order_id });
  });

  it("refuses another customer's cart line without revealing it", async () => {
    const foreign = await addCartLine(t, { user: B });
    const payload = await orderPayload(t, { customizationId: null, cartItemId: foreign, quantity: 1 });
    await expectDbError(callCheckoutRpc(t, payload), /CHECKOUT_CART_ITEM_NOT_FOUND/);
    expect(await count(t, "select 1 from public.cart_items where id = $1", [foreign])).toBe(1);
  });

  it("refuses a cart line whose product, quantity or design differs from the order line", async () => {
    const line = await addCartLine(t, { quantity: 1 });
    const quantity = await orderPayload(t, { customizationId: null, cartItemId: line, quantity: 3 });
    await expectDbError(callCheckoutRpc(t, quantity), /CHECKOUT_CART_CHANGED/);
    const product = await orderPayload(t, { customizationId: null, cartItemId: line, productId: "product-second", quantity: 1 });
    await expectDbError(callCheckoutRpc(t, product), /CHECKOUT_CART_CHANGED/);
  });

  it("refuses orders without cart lines, missing lines and the same line twice", async () => {
    const payload = await orderPayload(t, { customizationId: null });
    await expectDbError(callCheckoutRpc(t, { ...payload, guards: { ...payload.guards, cart_items: [] } }), /CHECKOUT_CART_REQUIRED/);
    const missing = await orderPayload(t, { customizationId: null, cartItemId: "8f14e45f-ceea-4f67-9b1a-2a3c4d5e6f72" });
    await expectDbError(callCheckoutRpc(t, missing), /CHECKOUT_CART_ITEM_NOT_FOUND/);

    const twice = await orderPayload(t, { customizationId: null, quantity: 1 });
    const doubled = {
      ...twice,
      order: { ...twice.order, subtotal: "400.00", total: "400.00" },
      items: [twice.items[0], { ...twice.items[0], line_number: 2 }],
      guards: { ...twice.guards, cart_items: [twice.guards.cart_items[0], { ...twice.guards.cart_items[0], line_number: 2 }] },
    };
    await expectDbError(callCheckoutRpc(t, doubled), /CHECKOUT_CART_CHANGED/);
  });

  it("a new cart line for the same product is a new, independent purchase", async () => {
    const first = await callCheckoutRpc(t, await orderPayload(t, { customizationId: null }));
    const second = await callCheckoutRpc(t, await orderPayload(t, { customizationId: null }));
    expect(first.status).toBe("created");
    expect(second.status).toBe("created");
    expect(first.order_id).not.toBe(second.order_id);
  });

  it("customers cannot read or forge cart claims", async () => {
    expect((await t.asUser(A.id, A.email, (db) => db.query("select * from public.checkout_cart_claims"))).rows).toHaveLength(0);
    await expectDbError(
      t.asUser(A.id, A.email, (db) =>
        db.query("insert into public.checkout_cart_claims (cart_item_id, customer_id, order_id, line_number) values (gen_random_uuid(), $1, 'x', 1)", [A.id]),
      ),
      /permission denied|row-level security/i,
    );
  });
});

describe("snapshot ↔ order item linkage is mandatory and exact", () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await freshDatabase();
  }, 120_000);
  afterAll(() => t?.close());

  it("refuses a snapshot without a line number", async () => {
    const payload = await orderPayload(t, { customizationId: await newDesign(t) });
    payload.snapshots[0].line_number = null;
    await expectDbError(callCheckoutRpc(t, payload), /CHECKOUT_SNAPSHOT_UNLINKED/);
    expect(await count(t, "select 1 from public.orders where id = $1", [payload.order.id])).toBe(0);
  });

  it("refuses a line number that does not exist on the order", async () => {
    const payload = await orderPayload(t, { customizationId: await newDesign(t) });
    payload.snapshots[0].line_number = 9;
    await expectDbError(callCheckoutRpc(t, payload), /CHECKOUT_SNAPSHOT_UNLINKED/);
  });

  it("refuses a snapshot pointed at ANOTHER line of the same order (swapped linkage)", async () => {
    const designA = await newDesign(t);
    const designB = await newDesign(t, "product-second");
    const a = await orderPayload(t, { customizationId: designA, quantity: 1 });
    const b = await orderPayload(t, { customizationId: designB, productId: "product-second", quantity: 1 });
    const itemB = { ...b.items[0], line_number: 2 };
    const combined = {
      order: { ...a.order, subtotal: "400.00", total: "400.00" },
      items: [a.items[0], itemB],
      // Swapped: design A's snapshot claims line 2, design B's claims line 1.
      snapshots: [
        { ...a.snapshots[0], line_number: 2 },
        { ...b.snapshots[0], line_number: 1 },
      ],
      guards: {
        products: [...a.guards.products, ...b.guards.products],
        customizations: [...a.guards.customizations, ...b.guards.customizations],
        cart_items: [a.guards.cart_items[0], { ...b.guards.cart_items[0], line_number: 2 }],
      },
    };
    await expectDbError(callCheckoutRpc(t, combined), /CHECKOUT_SNAPSHOT_MISMATCH/);

    const correct = { ...combined, snapshots: [{ ...a.snapshots[0], line_number: 1 }, { ...b.snapshots[0], line_number: 2 }] };
    const created = await callCheckoutRpc(t, correct);
    const links = (
      await t.db.query<any>(
        "select i.line_number, s.customization_id from public.order_design_snapshots s join public.order_items i on i.id = s.order_item_id where s.order_id = $1 order by i.line_number",
        [created.order_id],
      )
    ).rows;
    expect(links).toEqual([
      { line_number: 1, customization_id: designA },
      { line_number: 2, customization_id: designB },
    ]);
  });

  it("refuses a template version that belongs to another product", async () => {
    const payload = await orderPayload(t, { customizationId: await newDesign(t) });
    payload.snapshots[0].template_version_id = IDS.versionSecond;
    await expectDbError(callCheckoutRpc(t, payload), /CHECKOUT_SNAPSHOT_TEMPLATE_MISMATCH/);
    const noVersion = await orderPayload(t, { customizationId: await newDesign(t) });
    noVersion.snapshots[0].template_version_id = "";
    await expectDbError(callCheckoutRpc(t, noVersion), /CHECKOUT_SNAPSHOT_TEMPLATE_MISMATCH/);
  });

  it("a snapshot can never be stored without its order item", async () => {
    const created = await callCheckoutRpc(t, await orderPayload(t, { customizationId: await newDesign(t) }));
    await expectDbError(
      t.asService((db) =>
        db.query("insert into public.order_design_snapshots (order_id, order_item_id, quantity) values ($1, null, 1)", [created.order_id]),
      ),
      /order_item_required/,
    );
  });
});

describe("identity immutability of finalized history", () => {
  let t: TestDatabase;
  let orderId = "";
  let otherItemId = "";
  let otherDesign = "";
  beforeAll(async () => {
    t = await freshDatabase();
    orderId = (await callCheckoutRpc(t, await orderPayload(t, { customizationId: await newDesign(t) }))).order_id;
    otherDesign = await newDesign(t);
    const other = (await callCheckoutRpc(t, await orderPayload(t, { customizationId: otherDesign }))).order_id;
    otherItemId = (await t.db.query<{ id: string }>("select id from public.order_items where order_id = $1", [other])).rows[0].id;
  }, 120_000);
  afterAll(() => t?.close());

  const service = (sql: string, params: unknown[] = []) => t.asService((db) => db.query(sql, params));

  it.each([
    ["order item product A → B", "update public.order_items set product_id = 'product-second' where order_id = $1"],
    ["order item design A → B", "update public.order_items set customization_id = $2 where order_id = $1"],
    ["snapshot order item A → B", "update public.order_design_snapshots set order_item_id = $2::uuid where order_id = $1"],
    ["snapshot design A → B", "update public.order_design_snapshots set customization_id = $2 where order_id = $1"],
    ["snapshot template version A → B", `update public.order_design_snapshots set template_version_id = '${IDS.versionSecond}' where order_id = $1`],
  ])("refuses %s", async (_label, sql) => {
    const params = sql.includes("order_item_id = $2") ? [orderId, otherItemId] : sql.includes("$2") ? [orderId, otherDesign] : [orderId];
    await expectDbError(service(sql, params), /re-assigned|immutable/);
  });

  it("still allows legitimate ON DELETE SET NULL (identity cleared, not re-pointed)", async () => {
    expect((await service("update public.order_design_snapshots set template_version_id = null where order_id = $1", [orderId])).affectedRows).toBe(1);
    // Deleting the ordered design (e.g. account erasure by an owner session) clears the references.
    const designId = (await t.db.query<{ c: string }>("select customization_id as c from public.order_items where order_id = $1", [orderId])).rows[0].c;
    await t.db.query("delete from public.product_customizations where id = $1", [designId]);
    const row = (await t.db.query<any>("select i.customization_id as item, s.customization_id as snap from public.order_items i join public.order_design_snapshots s on s.order_item_id = i.id where i.order_id = $1", [orderId])).rows[0];
    expect(row).toEqual({ item: null, snap: null });
  });
});

describe("production and notification outbox", () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await freshDatabase();
  }, 120_000);
  afterAll(() => t?.close());

  it("the order transaction writes one production task per snapshot and one of each notification", async () => {
    const created = await callCheckoutRpc(t, await orderPayload(t, { customizationId: await newDesign(t) }));
    const task = (await t.db.query<any>("select * from public.production_tasks where order_id = $1", [created.order_id])).rows;
    expect(task).toHaveLength(1);
    expect(task[0]).toMatchObject({ status: "pending", source: "checkout", attempt_count: 0 });
    expect(task[0].order_item_id).toBeTruthy();
    const kinds = (await t.db.query<any>("select kind, recipient from public.notification_tasks where order_id = $1 order by kind", [created.order_id])).rows;
    expect(kinds).toEqual([
      { kind: "order_confirmation_customer", recipient: A.email },
      { kind: "order_notification_admin", recipient: null },
    ]);
  });

  it("a non-personalized order has notifications but no production task", async () => {
    const created = await callCheckoutRpc(t, await orderPayload(t, { customizationId: null }));
    expect(await count(t, "select 1 from public.production_tasks where order_id = $1", [created.order_id])).toBe(0);
    expect(await count(t, "select 1 from public.notification_tasks where order_id = $1", [created.order_id])).toBe(2);
  });

  it("leases tasks exclusively, backs off on failure, and fails permanently after the ceiling", async () => {
    const created = await callCheckoutRpc(t, await orderPayload(t, { customizationId: await newDesign(t) }));
    const claim = () => t.asService((db) => db.query<any>("select * from public.claim_production_tasks(10, 300, $1)", [created.order_id]));
    const first = (await claim()).rows;
    expect(first).toHaveLength(1);
    expect((await claim()).rows).toHaveLength(0); // leased
    const status = (await t.asService((db) => db.query<any>("select public.finish_production_task($1, $2, 'boom', 2) as s", [first[0].id, first[0].lock_token]))).rows[0].s;
    expect(status).toBe("pending");
    expect((await claim()).rows).toHaveLength(0); // backoff not elapsed
    await t.db.query("update public.production_tasks set next_attempt_at = now() where id = $1", [first[0].id]);
    const second = (await claim()).rows[0];
    expect(second.attempt_count).toBe(2);
    // A stale lock token cannot finish a task.
    expect((await t.asService((db) => db.query<any>("select public.finish_production_task($1, $2, null) as s", [second.id, first[0].lock_token]))).rows[0].s).toBeNull();
    const final = (await t.asService((db) => db.query<any>("select public.finish_production_task($1, $2, 'boom', 2) as s", [second.id, second.lock_token]))).rows[0].s;
    expect(final).toBe("failed");
  });

  it("recovers finalized snapshots that never got production work, exactly once", async () => {
    const created = await callCheckoutRpc(t, await orderPayload(t, { customizationId: await newDesign(t) }));
    // Simulate a pre-outbox order: its task never existed.
    await t.db.query("delete from public.production_tasks where order_id = $1", [created.order_id]);
    await t.db.query("update public.order_design_snapshots set created_at = now() - interval '1 hour' where order_id = $1", [created.order_id]);
    const health = (await t.asService((db) => db.query<any>("select public.production_health() as h"))).rows[0].h;
    expect(health.unscheduledSnapshots).toBeGreaterThanOrEqual(1);
    const recover = () => t.asService((db) => db.query<any>("select public.enqueue_missing_production_tasks(600) as n"));
    expect((await recover()).rows[0].n).toBeGreaterThanOrEqual(1);
    expect((await recover()).rows[0].n).toBe(0);
    const task = (await t.db.query<any>("select source from public.production_tasks where order_id = $1", [created.order_id])).rows;
    expect(task).toEqual([{ source: "recovery" }]);
  });

  it("notification tasks can be deferred without spending attempts", async () => {
    const created = await callCheckoutRpc(t, await orderPayload(t, { customizationId: null }));
    const claimed = (await t.asService((db) => db.query<any>("select * from public.claim_notification_tasks(5, 120, $1)", [created.order_id]))).rows;
    expect(claimed).toHaveLength(2);
    for (const task of claimed) {
      await t.asService((db) => db.query("select public.defer_notification_task($1, $2, 'not configured', 60)", [task.id, task.lock_token]));
    }
    const rows = (await t.db.query<any>("select status, attempt_count from public.notification_tasks where order_id = $1", [created.order_id])).rows;
    expect(rows.every((row) => row.status === "pending" && row.attempt_count === 0)).toBe(true);
  });

  it("worker heartbeat and health are recorded", async () => {
    await t.asService((db) => db.query("select public.record_worker_run('render', 'start')"));
    await t.asService((db) => db.query("select public.record_worker_run('render', 'finish', 'ok', '{\"processed\":1}'::jsonb)"));
    const health = (await t.asService((db) => db.query<any>("select public.production_health() as h"))).rows[0].h;
    expect(health.worker.last_status).toBe("ok");
    expect(health.worker.run_count).toBe(1);
    expect(health.productionTasks).toHaveProperty("pending");
    expect(health.notificationTasks).toHaveProperty("failed");
  });

  it("records provider success durably before a lost task acknowledgement, without sending twice", async () => {
    const created = await callCheckoutRpc(t, await orderPayload(t, { customizationId: null }));
    const task = (await t.asService(db => db.query<any>("select * from public.claim_notification_tasks(1,120,$1)", [created.order_id]))).rows[0];
    let sends = 0;
    const run = makeNotificationRunner({
      transport: { send: async () => { sends++; return { id: "provider-confirmed-1" }; } }, adminRecipient: "orders@husnalogy.test",
      loadOrder: async () => orderFromRow((await t.db.query<any>("select * from public.orders where id=$1", [created.order_id])).rows[0]),
      prepareDelivery: async (work, message) => (await t.asService(db => db.query<any>("select public.prepare_notification_delivery($1,$2,$3) as p", [work.id, work.lock_token, JSON.stringify(message)]))).rows[0].p,
      recordDelivery: async (work, id) => {
        expect((await t.asService(db => db.query<any>("select public.record_notification_delivery($1,$2,$3) as ok", [work.id, work.lock_token, id]))).rows[0].ok).toBe(true);
        throw new Error("Acknowledgement lost after database commit");
      },
    });
    await expect(run(task)).rejects.toThrow(/Acknowledgement lost/);
    const stored = (await t.db.query<any>("select * from public.notification_tasks where id=$1", [task.id])).rows[0];
    expect(stored).toMatchObject({ status: "sent", provider_message_id: "provider-confirmed-1" });
    expect(await run(stored)).toEqual({ kind: "done", reference: "provider-confirmed-1" });
    expect(sends).toBe(1);
  });

  it("freezes email payload across an uncertain send and refuses a blind retry beyond the provider window", async () => {
    const created = await callCheckoutRpc(t, await orderPayload(t, { customizationId: null }));
    const claim = async () => (await t.asService(db => db.query<any>("select * from public.claim_notification_tasks(5,120,$1)", [created.order_id]))).rows[0];
    const task = await claim();
    const first: EmailMessage = { to: "orders@husnalogy.test", subject: "Approved order", text: "Frozen", html: "<p>Frozen</p>", delivery: { from: "original@husnalogy.test", replyTo: "" } };
    const prepare = async (token: string, message: EmailMessage) => (await t.asService(db => db.query<any>("select public.prepare_notification_delivery($1,$2,$3) as p", [task.id, token, JSON.stringify(message)]))).rows[0].p;
    expect((await prepare(task.lock_token, first)).message).toEqual(first);
    await t.asService(db => db.query("select public.finish_notification_task($1,$2,'provider response lost')", [task.id, task.lock_token]));
    await t.db.query("update public.notification_tasks set next_attempt_at=now() where id=$1", [task.id]);
    const retry = await claim();
    expect((await prepare(retry.lock_token, { ...first, text: "Changed live email", delivery: { from: "changed@husnalogy.test", replyTo: "" } })).message).toEqual(first);
    await t.db.query("update public.notification_tasks set first_delivery_attempt_at=now()-interval '25 hours' where id=$1", [task.id]);
    let sends = 0;
    const run = makeNotificationRunner({ transport: { send: async () => { sends++; return { id: "unsafe" }; } }, adminRecipient: "orders@husnalogy.test",
      loadOrder: async () => orderFromRow((await t.db.query<any>("select * from public.orders where id=$1", [created.order_id])).rows[0]),
      prepareDelivery: async (work, message) => prepare(work.lock_token, message),
    });
    await expect(run(retry)).rejects.toThrow(/DELIVERY_UNCERTAIN/); expect(sends).toBe(0);
    await t.db.query("update public.notification_tasks set status='failed',last_error='DELIVERY_UNCERTAIN: verify provider',lock_token=null,locked_until=null where id=$1", [task.id]);
    await expect(t.asService(db => db.query("select public.retry_production_work('notification',$1,$2,'Blind retry is unsafe')", [task.id, USERS.admin.id]))).rejects.toThrow(/VERIFY_PROVIDER_DELIVERY/);
    await t.asService(db => db.query("select public.resolve_notification_delivery($1,$2,false,null,'Provider activity checked: email was not accepted')", [task.id, USERS.admin.id]));
    expect((await t.db.query<any>("select status,first_delivery_attempt_at,delivery_payload,delivery_generation from public.notification_tasks where id=$1", [task.id])).rows[0]).toMatchObject({ status: "pending", first_delivery_attempt_at: null, delivery_payload: null, delivery_generation: 1 });
    expect(await count(t, "select 1 from public.production_recovery_audit where target_id=$1", [task.id])).toBe(1);
  });

  it("customers cannot see or drive the outbox", async () => {
    expect((await t.asUser(A.id, A.email, (db) => db.query("select * from public.production_tasks"))).rows).toHaveLength(0);
    expect((await t.asUser(A.id, A.email, (db) => db.query("select * from public.notification_tasks"))).rows).toHaveLength(0);
    for (const sql of [
      "select * from public.claim_production_tasks(10, 300, null)",
      "select * from public.claim_notification_tasks(10, 120, null)",
      "select public.enqueue_missing_production_tasks(600)",
      "select public.production_health()",
    ]) {
      await expectDbError(t.asUser(A.id, A.email, (db) => db.query(sql)), /permission denied/i);
    }
  });
});

describe("a failure at ANY write stage rolls back the whole checkout", () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await freshDatabase();
    await t.db.exec(`
      create or replace function public.test_fail_insert() returns trigger language plpgsql as $$
      begin raise exception 'INJECTED_FAILURE %', tg_table_name; end; $$;
    `);
  }, 120_000);
  afterAll(() => t?.close());

  it.each([
    ["order insert", "orders", "before insert"],
    ["order item insert", "order_items", "before insert"],
    ["snapshot insert", "order_design_snapshots", "before insert"],
    ["customization binding", "product_customizations", "before update"],
    ["cart claim", "checkout_cart_claims", "before insert"],
    ["production task insert", "production_tasks", "before insert"],
    ["notification task insert", "notification_tasks", "before insert"],
  ])("%s", async (_label, table, timing) => {
    const design = await newDesign(t);
    const payload = await orderPayload(t, { customizationId: design });
    await t.db.exec(`create trigger test_fail before ${timing.split(" ")[1]} on public.${table} for each row execute function public.test_fail_insert()`);
    try {
      await expectDbError(callCheckoutRpc(t, payload), /INJECTED_FAILURE/);
    } finally {
      await t.db.exec(`drop trigger test_fail on public.${table}`);
    }
    expect(await count(t, "select 1 from public.orders where id = $1", [payload.order.id])).toBe(0);
    expect(await count(t, "select 1 from public.order_items where order_id = $1", [payload.order.id])).toBe(0);
    expect(await count(t, "select 1 from public.order_design_snapshots where order_id = $1", [payload.order.id])).toBe(0);
    expect(await count(t, "select 1 from public.production_tasks where order_id = $1", [payload.order.id])).toBe(0);
    expect(await count(t, "select 1 from public.notification_tasks where order_id = $1", [payload.order.id])).toBe(0);
    expect(await count(t, "select 1 from public.checkout_cart_claims where order_id = $1", [payload.order.id])).toBe(0);
    expect(await count(t, "select 1 from public.cart_items where id = $1", [payload.cartItemId])).toBe(1);
    expect((await t.db.query<any>("select status, order_id from public.product_customizations where id = $1", [design])).rows[0]).toEqual({ status: "draft", order_id: null });

    // And the retry after the fault is gone succeeds exactly once.
    expect((await callCheckoutRpc(t, payload)).status).toBe("created");
    expect((await callCheckoutRpc(t, payload)).status).toBe("replayed");
  });
});
