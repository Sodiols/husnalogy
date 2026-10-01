/**
 * Checkout preparation: single-flight leases, aggregate production limits,
 * deterministic cleanup of abandoned preparation bytes, crash recovery.
 * Real pipeline + real SQL (PGlite with every migration) + the production
 * pinning code writing into a storage stand-in.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { placeCheckoutOrder, type CheckoutDeps } from "@/lib/orders/checkout";
import { CURRENT_TERMS_VERSION } from "@/lib/orders/checkout-policy";
import { createTestDatabase, type TestDatabase } from "@/lib/testing/pglite-supabase";
import { BASIC_OPTIONS, IDS, USERS, addCartLine, count, seedCheckoutFixtures } from "@/lib/testing/checkout-fixtures";
import { createPgliteCheckoutDeps } from "@/lib/testing/pglite-checkout-deps";
import { createProductionTestClient } from "@/lib/testing/pglite-production-client";
import { placeAutomaticOrder } from "@/lib/testing/production-orders";
import { makeProductionInput, productionIntegrityHash } from "@/lib/customizer/production-input";
import { pinProductionInput, productionStorage, type ProductionStorage } from "@/lib/customizer/server/production-assets";
import { PRODUCTION_LIMITS, ProductionAssetBudget, ProductionLimitError } from "@/lib/customizer/production-limits";
import { productionWorkerSubsystems } from "@/lib/outbox/supabase-tasks";
import { runWorkerPass } from "@/lib/worker/production-worker";

vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => { throw new Error("Preparation test requires its injected SQL client"); } }));

const A = USERS.customerA;
const PREMIUM = { ...BASIC_OPTIONS, paper: "Premium +$100.00" };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("checkout preparation is single-flight, bounded and cleaned deterministically", () => {
  let t: TestDatabase;
  let storage: ReturnType<typeof createProductionTestClient>;
  let submission = 0;
  const query = async (sql: string, values: unknown[] = []) => (await t.db.query<Record<string, any>>(sql, values)).rows;

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedCheckoutFixtures(t);
    storage = createProductionTestClient(t);
  }, 120_000);
  afterAll(() => t?.close());

  /** A fresh saved design for customer A, already in a server-side cart line. */
  async function designInCart() {
    const id = randomUUID();
    await t.db.query(
      "insert into public.product_customizations (id, user_id, product_id, template_id, template_version, status, selected_options, values) values ($1, $2, 'product-active', $3, 1, 'draft', $4::jsonb, '{\"names\":\"A & B\"}'::jsonb)",
      [id, A.id, IDS.templateActive, JSON.stringify({ ...BASIC_OPTIONS, paper: "Premium" })],
    );
    const cartItemId = await addCartLine(t, { user: A, productId: "product-active", quantity: 2, customizationId: id });
    return { id, cartItemId };
  }
  const request = (line: { id: string; cartItemId: string }, tag = "") => ({
    checkoutSubmissionId: `prep-${tag}-${(submission += 1)}-${Date.now()}`,
    customerName: "Ayesha Rahman",
    customerPhone: "01712345678",
    deliveryMethod: "store",
    acceptTerms: true,
    termsVersion: CURRENT_TERMS_VERSION,
    items: [{ productId: "product-active", quantity: 2, selectedOptions: PREMIUM, customizationId: line.id, cartItemId: line.cartItemId }],
  });

  /**
   * Deps whose design verification does REAL expensive production work: it
   * pins an image with the production pinning code and the shared budget,
   * and puts the pinned manifest into the snapshot (so a committed order owns
   * registered assets).
   */
  function preparingDeps(counter: { preparations: number; orderIds: string[] }, extra: Partial<CheckoutDeps> = {}): CheckoutDeps {
    const base = createPgliteCheckoutDeps(t);
    return {
      ...base,
      newOrderId: () => {
        const id = base.newOrderId();
        counter.orderIds.push(id);
        return id;
      },
      async verifyCustomization(input) {
        counter.preparations += 1;
        const verified = await base.verifyCustomization(input);
        if (!verified.ok) return verified;
        await pause(40); // hold the lease long enough for a competing tab to arrive
        const image = await sharp({ create: { width: 8, height: 8, channels: 4, background: `#${(counter.preparations * 40).toString(16).padStart(2, "0")}3355` } }).png().toBuffer();
        const template = { canvasWidthPx: 120, canvasHeightPx: 160, cardWidthIn: 1.2, cardHeightIn: 1.6, dpi: 100, pages: [{ id: "front", enabled: true }], layers: [{ id: "photo", page: "front", type: "image", src: "upload", x: 0, y: 0, width: 8, height: 8 }], featureFlags: { customizer_v2_server_rendering: true } };
        const production = await pinProductionInput(input.orderId, makeProductionInput(template, {}, null), productionStorage(storage.client), { loadImage: async () => image, budget: input.budget });
        const snapshot = { ...verified.snapshot.snapshot, production };
        return { ...verified, snapshot: { ...verified.snapshot, snapshot, integrity_hash: productionIntegrityHash(snapshot) } };
      },
      ...extra,
    };
  }
  const objectsUnder = (orderId: string) => count(t, "select 1 from storage.objects where bucket_id='order-production' and starts_with(name, $1)", [`orders/${orderId}/`]);

  it("MANDATORY: two tabs, same customer and cart, different submission ids → one preparation, one order, no stray assets", async () => {
    const line = await designInCart();
    const counter = { preparations: 0, orderIds: [] as string[] };
    const tabA = request(line, "tab-a");
    const tabB = request(line, "tab-b");
    const [a, b] = await Promise.all([
      placeCheckoutOrder({ user: A, body: tabA, requestId: "tab-a" }, preparingDeps(counter)),
      placeCheckoutOrder({ user: A, body: tabB, requestId: "tab-b" }, preparingDeps(counter)),
    ]);
    const outcomes = [a, b];
    const created = outcomes.filter((outcome) => outcome.ok);
    const refused = outcomes.filter((outcome) => !outcome.ok);
    expect(created).toHaveLength(1);
    expect(refused).toHaveLength(1);
    // Only ONE request ran the expensive preparation pipeline.
    expect(counter.preparations).toBe(1);
    const orderId = created[0].ok ? String(created[0].order.id) : "";
    // The other tab waited (cheaply) and was told which order took its cart.
    expect(refused[0].ok === false && refused[0].code).toBe("CART_ALREADY_ORDERED");
    expect(refused[0].ok === false && refused[0].orderId).toBe(orderId);
    expect(await count(t, "select 1 from public.orders where checkout_submission_id in ($1,$2)", [tabA.checkoutSubmissionId, tabB.checkoutSubmissionId])).toBe(1);
    expect(await count(t, "select 1 from public.order_design_snapshots where order_id=$1", [orderId])).toBe(1);
    expect(await count(t, "select 1 from public.production_tasks where order_id=$1", [orderId])).toBe(1);
    expect(await count(t, "select 1 from public.notification_tasks where order_id=$1", [orderId])).toBe(2);
    // Stored bytes exist ONLY for the committed order, and they are registered.
    for (const reserved of counter.orderIds.filter((id) => id !== orderId)) expect(await objectsUnder(reserved)).toBe(0);
    expect(await objectsUnder(orderId)).toBe(1);
    expect(await count(t, "select 1 from public.order_production_assets where order_id=$1", [orderId])).toBe(1);
    expect((await query("select status from public.checkout_preparations where order_id=$1", [orderId]))[0].status).toBe("committed");

    // The refused tab presses Place order again: shown the winner, no new work.
    const retried = await placeCheckoutOrder({ user: A, body: tabB, requestId: "tab-b-retry" }, preparingDeps(counter));
    expect(retried.ok === false && retried.code).toBe("CART_ALREADY_ORDERED");
    expect(retried.ok === false && retried.orderId).toBe(orderId);
    expect(counter.preparations).toBe(1);

    // A worker pass never removes the committed order's assets.
    await runWorkerPass(productionWorkerSubsystems({ renderLimit: 1, supabase: storage.client, notifications: { transport: null } }).filter((entry) => ["lease_recovery", "storage_cleanup"].includes(entry.name)));
    expect(await objectsUnder(orderId)).toBe(1);
  }, 120_000);

  it("a double click (same submission, concurrent) returns the SAME order to both requests with one preparation", async () => {
    const line = await designInCart();
    const counter = { preparations: 0, orderIds: [] as string[] };
    const body = request(line, "double");
    const [first, second] = await Promise.all([
      placeCheckoutOrder({ user: A, body, requestId: "click-1" }, preparingDeps(counter)),
      placeCheckoutOrder({ user: A, body, requestId: "click-2" }, preparingDeps(counter)),
    ]);
    expect(first.ok && second.ok).toBe(true);
    expect(first.ok && second.ok && first.order.id === second.order.id).toBe(true);
    expect([first, second].map((outcome) => outcome.ok && outcome.httpStatus).sort()).toEqual([200, 201]);
    expect(counter.preparations).toBe(1);
  }, 120_000);

  it("a request that cannot get the lease in time is refused with 409 and does no work", async () => {
    const line = await designInCart();
    const holder = `order-holder-${randomUUID()}`;
    await t.asService((db) => db.query("select public.acquire_checkout_preparation($1::uuid,'holder-submission-01',$2,$3,300)", [A.id, "9".repeat(64), holder]));
    const counter = { preparations: 0, orderIds: [] as string[] };
    const outcome = await placeCheckoutOrder({ user: A, body: request(line, "blocked"), requestId: "blocked" }, { ...preparingDeps(counter), preparationWaitMs: 600 });
    expect(outcome.ok === false && outcome.code).toBe("CHECKOUT_IN_PROGRESS");
    expect(outcome.ok === false && outcome.httpStatus).toBe(409);
    expect(counter.preparations).toBe(0);
    await t.db.query("update public.checkout_preparations set status='failed' where order_id=$1", [holder]);
  }, 60_000);

  it("a definitive failure after pinning releases the lease and removes its bytes immediately", async () => {
    const line = await designInCart();
    const counter = { preparations: 0, orderIds: [] as string[] };
    const base = createPgliteCheckoutDeps(t);
    const outcome = await placeCheckoutOrder({ user: A, body: request(line, "price"), requestId: "price" }, preparingDeps(counter, {
      // The product changes between pricing and commit: the transaction refuses.
      async createOrder(payload) {
        await t.db.query("update public.products set updated_at = now() + interval '1 second' where id='product-active'");
        return base.createOrder(payload);
      },
    }));
    expect(outcome.ok === false && outcome.code).toBe("PRICE_CHANGED");
    const reserved = counter.orderIds[0];
    expect(counter.preparations).toBe(1);
    expect((await query("select status,failure_code,cleanup_status from public.checkout_preparations where order_id=$1", [reserved]))[0]).toEqual({ status: "failed", failure_code: "PRICE_CHANGED", cleanup_status: "pending" });
    expect(await objectsUnder(reserved)).toBe(0);
    expect(await count(t, "select 1 from public.orders where id=$1", [reserved])).toBe(0);
    // The worker confirms nothing is left and closes the preparation.
    expect((await storage.client.rpc("complete_checkout_preparation_cleanup", { p_limit: 200 })).error).toBeNull();
    expect((await query("select cleanup_status from public.checkout_preparations where order_id=$1", [reserved]))[0].cleanup_status).toBe("done");
    // The cart line was not consumed: the customer can simply try again.
    const retry = await placeCheckoutOrder({ user: A, body: request(line, "price-retry"), requestId: "price-retry" }, preparingDeps(counter));
    expect(retry.ok).toBe(true);
  }, 120_000);

  it("MANDATORY: a preparation that crashes midway is abandoned after its lease and its bytes are removed; committed assets stay", async () => {
    const committed = await placeAutomaticOrder(t, storage, { customer: USERS.customerB });
    const committedObjects = await objectsUnder(committed.orderId);
    expect(committedObjects).toBeGreaterThan(0);

    // A "crashed" checkout: lease taken, bytes pinned, then the process died.
    const orderId = `order-crashed-${randomUUID()}`;
    const lease = (await query("select public.acquire_checkout_preparation($1::uuid,$2,$3,$4,300) as r", [USERS.customerC.id, `crash-${orderId}`, "f".repeat(64), orderId]))[0].r;
    expect(lease.status).toBe("acquired");
    const image = await sharp({ create: { width: 4, height: 4, channels: 4, background: "#aa0000" } }).png().toBuffer();
    await pinProductionInput(orderId, makeProductionInput({ pages: [{ id: "front", enabled: true }], layers: [{ id: "i", page: "front", type: "image", src: "x", x: 0, y: 0, width: 1, height: 1 }] }, {}, null), productionStorage(storage.client), { loadImage: async () => image });
    expect(await objectsUnder(orderId)).toBe(1);
    // While the lease is valid the bytes are protected (the attempt may still commit).
    const early = await runWorkerPass(productionWorkerSubsystems({ renderLimit: 1, supabase: storage.client, notifications: { transport: null } }).filter((entry) => ["lease_recovery", "storage_cleanup"].includes(entry.name)));
    expect(early.status).toBe("ok");
    expect(await objectsUnder(orderId)).toBe(1);
    // The customer's next attempt is refused until the lease expires.
    const blocked = await t.asService((db) => db.query<{ r: { status: string } }>("select public.acquire_checkout_preparation($1::uuid,'next-attempt-000001',$2,'order-next-attempt',300) as r", [USERS.customerC.id, "e".repeat(64)]));
    expect(blocked.rows[0].r.status).toBe("busy");

    await t.db.query("update public.checkout_preparations set lease_expires_at = now() - interval '1 second' where order_id=$1", [orderId]);
    const recovery = await runWorkerPass(productionWorkerSubsystems({ renderLimit: 1, supabase: storage.client, notifications: { transport: null } }).filter((entry) => ["lease_recovery", "storage_cleanup"].includes(entry.name)));
    expect(recovery.subsystems[0].result).toMatchObject({ checkoutPreparationsExpired: 1 });
    expect((await query("select status,failure_code,cleanup_status from public.checkout_preparations where order_id=$1", [orderId]))[0]).toEqual({ status: "abandoned", failure_code: "LEASE_EXPIRED", cleanup_status: "done" });
    expect(await objectsUnder(orderId)).toBe(0);
    expect(await objectsUnder(committed.orderId)).toBe(committedObjects);
    // An abandoned attempt can never be committed afterwards.
    const late = await t.asService((db) => db.query("update public.orders set checkout_state='finalized' where id=$1", [orderId]));
    expect(late.affectedRows ?? 0).toBe(0);
  }, 120_000);

  it("an expired lease is refused by the transaction itself, so cleanup can never race a commit", async () => {
    const line = await designInCart();
    const counter = { preparations: 0, orderIds: [] as string[] };
    const base = createPgliteCheckoutDeps(t);
    const outcome = await placeCheckoutOrder({ user: A, body: request(line, "expired"), requestId: "expired" }, preparingDeps(counter, {
      async createOrder(payload) {
        // The worker abandoned the lease while this request was slow.
        await t.db.query("update public.checkout_preparations set lease_expires_at = now() - interval '1 second' where order_id=$1", [counter.orderIds[0]]);
        await t.asService((db) => db.query("select public.expire_checkout_preparations(10)"));
        return base.createOrder(payload);
      },
    }));
    expect(outcome.ok === false && outcome.code).toBe("PREPARATION_EXPIRED");
    expect(await count(t, "select 1 from public.orders where id=$1", [counter.orderIds[0]])).toBe(0);
    expect(await count(t, "select 1 from public.cart_items where id=$1", [line.cartItemId])).toBe(1);
  }, 120_000);

  it("an unknown transaction outcome keeps every byte until the database decides", async () => {
    const line = await designInCart();
    const counter = { preparations: 0, orderIds: [] as string[] };
    const outcome = await placeCheckoutOrder({ user: A, body: request(line, "lost"), requestId: "lost" }, preparingDeps(counter, {
      async createOrder() {
        throw new Error("fetch failed: socket hang up"); // no database answer at all
      },
    }));
    expect(outcome.ok === false && outcome.code).toBe("ORDER_NOT_CONFIRMED");
    const reserved = counter.orderIds[0];
    expect((await query("select status from public.checkout_preparations where order_id=$1", [reserved]))[0].status).toBe("preparing");
    expect(await objectsUnder(reserved)).toBe(1);
    // After the lease the worker abandons it and removes the unused bytes.
    await t.db.query("update public.checkout_preparations set lease_expires_at = now() - interval '1 second' where order_id=$1", [reserved]);
    await runWorkerPass(productionWorkerSubsystems({ renderLimit: 1, supabase: storage.client, notifications: { transport: null } }).filter((entry) => ["lease_recovery", "storage_cleanup"].includes(entry.name)));
    expect(await objectsUnder(reserved)).toBe(0);
  }, 120_000);

  it("a production limit refusal is a 422 that releases the lease and removes what was stored", async () => {
    const line = await designInCart();
    const counter = { preparations: 0, orderIds: [] as string[] };
    const base = preparingDeps(counter);
    const outcome = await placeCheckoutOrder({ user: A, body: request(line, "limit"), requestId: "limit" }, {
      ...base,
      async verifyCustomization(input) {
        const verified = await base.verifyCustomization(input);
        input.budget.reserveAsset("f".repeat(64), PRODUCTION_LIMITS.maxAssetBytesPerOrder, "image"); // exhausts the order budget
        return verified;
      },
    });
    expect(outcome.ok === false && outcome.code).toBe("PRODUCTION_LIMIT_EXCEEDED");
    expect(outcome.ok === false && outcome.httpStatus).toBe(422);
    expect((await query("select status from public.checkout_preparations where order_id=$1", [counter.orderIds[0]]))[0].status).toBe("failed");
    expect(await objectsUnder(counter.orderIds[0])).toBe(0);
  }, 120_000);
});

describe("aggregate production limits are enforced before expensive work", () => {
  const image = () => sharp({ create: { width: 4, height: 4, channels: 4, background: "#00aa00" } }).png().toBuffer();
  const refusingStorage = (): ProductionStorage & { puts: number } => {
    const state = { puts: 0 };
    return Object.assign(state, {
      async put() { state.puts += 1; },
      async get() { throw new Error("not stored"); },
    });
  };
  const templateWith = (images: number) => ({
    pages: [{ id: "front", enabled: true }],
    layers: Array.from({ length: images }, (_, index) => ({ id: `i${index}`, page: "front", type: "image", src: `source-${index}`, x: 0, y: 0, width: 1, height: 1 })),
  });

  it("refuses too many images in one design before downloading any", async () => {
    let downloads = 0;
    await expect(pinProductionInput("order-limit-1", makeProductionInput(templateWith(PRODUCTION_LIMITS.maxImagesPerDesign + 1), {}, null), refusingStorage(), {
      loadImage: async () => { downloads += 1; return image(); },
    })).rejects.toThrow(ProductionLimitError);
    expect(downloads).toBe(0);
  });

  it("refuses an image whose decoded size is too large using its header only", async () => {
    const huge = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20000" height="20000" viewBox="0 0 20000 20000"><rect width="20000" height="20000" fill="#000"/></svg>');
    const store = refusingStorage();
    await expect(pinProductionInput("order-limit-2", makeProductionInput(templateWith(1), {}, null), store, { loadImage: async () => huge })).rejects.toThrow(/too large to print/);
    expect(store.puts).toBe(0);
  });

  it("shares ONE byte/count budget across every line of an order", async () => {
    const png = await image();
    // Room for exactly this first image and nothing more.
    const budget = new ProductionAssetBudget({ ...PRODUCTION_LIMITS, maxAssetBytesPerOrder: png.length + 1 });
    const store = { puts: 0, blobs: new Map<string, Buffer>() };
    const storage: ProductionStorage = {
      async put(path, bytes) { store.puts += 1; store.blobs.set(path, bytes); },
      async get(path) { const bytes = store.blobs.get(path); if (!bytes) throw new Error("missing"); return bytes; },
    };
    await pinProductionInput("order-limit-3", makeProductionInput(templateWith(1), {}, null), storage, { loadImage: async () => png, budget });
    const other = await sharp({ create: { width: 5, height: 5, channels: 4, background: "#0000aa" } }).png().toBuffer();
    await expect(pinProductionInput("order-limit-3", makeProductionInput(templateWith(1), {}, null), storage, { loadImage: async () => other, budget })).rejects.toThrow(/too large in total/);
    expect(store.puts).toBe(1);
    // The same bytes in a second line are one stored object, not a new charge.
    await pinProductionInput("order-limit-3", makeProductionInput(templateWith(1), {}, null), storage, { loadImage: async () => png, budget });
    expect(budget.usage.images).toBe(1);
  });

  it("stops at the preparation deadline and bounds snapshot size", () => {
    const expired = new ProductionAssetBudget(PRODUCTION_LIMITS, Date.now() - 1);
    expect(() => expired.assertTime()).toThrow(ProductionLimitError);
    const budget = new ProductionAssetBudget();
    expect(() => budget.reserveSnapshot(PRODUCTION_LIMITS.maxSnapshotBytes + 1)).toThrow(/too large to store/);
    for (let index = 0; index < 4; index++) budget.reserveSnapshot(PRODUCTION_LIMITS.maxSnapshotBytes);
    expect(() => budget.reserveSnapshot(1)).toThrow(/too large to store together/);
    expect(() => budget.reservePixels(PRODUCTION_LIMITS.maxImagePixels + 1)).toThrow(/too large to print/);
  });

  it("refuses print canvases beyond the render bounds before any download", async () => {
    let downloads = 0;
    const giant = { ...templateWith(1), canvasWidthPx: 20000, canvasHeightPx: 20000, cardWidthIn: 5, cardHeightIn: 5, dpi: 300, featureFlags: { customizer_v2_server_rendering: true } };
    await expect(pinProductionInput("order-limit-4", makeProductionInput(giant, {}, null), refusingStorage(), { loadImage: async () => { downloads += 1; return image(); } })).rejects.toThrow(ProductionLimitError);
    expect(downloads).toBe(0);
  });
});

describe("database backstops for aggregate production size", () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await createTestDatabase();
    await seedCheckoutFixtures(t);
  }, 120_000);
  afterAll(() => t?.close());

  it("refuses more than 512 MiB of pinned assets for one order, counting shared bytes once", async () => {
    const storage = createProductionTestClient(t);
    const order = await placeAutomaticOrder(t, storage);
    const size = 30 * 1024 * 1024;
    const insert = (index: number) => {
      const checksum = index.toString(16).padStart(64, "0");
      return t.db.query(
        "insert into public.order_production_assets(snapshot_id,order_id,asset_key,bucket,path,checksum,size_bytes,mime_type,kind) values($1,$2,$3,'order-production',$4,$3,$5,'image/png','image')",
        [order.snapshot.id, order.orderId, checksum, `orders/${order.orderId}/assets/${checksum}`, size],
      );
    };
    for (let index = 1; index <= 17; index++) await insert(index);
    await expect(insert(18)).rejects.toThrow(/ORDER_PRODUCTION_ASSET_BUDGET_EXCEEDED/);
  }, 120_000);

  it("refuses a manufacturing snapshot larger than 8 MiB", async () => {
    const storage = createProductionTestClient(t);
    const order = await placeAutomaticOrder(t, storage);
    const item = (await t.db.query<{ id: string }>("select id from public.order_items where order_id=$1", [order.orderId])).rows[0];
    await expect(
      t.db.query(
        "insert into public.order_design_snapshots(order_id,order_item_id,product_id,product_title,quantity,snapshot,integrity_hash) values($1,$2,'product-active','Big',1,$3::jsonb,'x')",
        [order.orderId, item.id, JSON.stringify({ padding: "x".repeat(8 * 1024 * 1024 + 10) })],
      ),
    ).rejects.toThrow(/order_design_snapshots_serialized_size|duplicate key/);
  }, 120_000);
});
