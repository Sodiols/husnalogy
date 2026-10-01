/**
 * Seed data and RPC helpers for the database integration suites. Test-only.
 * Everything is written as the database owner, exactly like a migration or
 * the SQL editor would, and then exercised through the PostgREST roles.
 */

import { randomUUID } from "node:crypto";
import { makeProductionInput, productionIntegrityHash } from "@/lib/customizer/production-input";

/**
 * Any Postgres the fixtures can drive: the PGlite TestDatabase or a real
 * multi-connection server (lib/testing/postgres-server.ts).
 */
export interface SqlConnection {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface SqlDatabase {
  db: SqlConnection;
  asService<T>(work: (db: SqlConnection) => Promise<T>): Promise<T>;
}

export const USERS = {
  customerA: { id: "00000000-0000-4000-8000-00000000000a", email: "customer.a@example.com" },
  customerB: { id: "00000000-0000-4000-8000-00000000000b", email: "customer.b@example.com" },
  customerC: { id: "00000000-0000-4000-8000-00000000000c", email: "customer.c@example.com" },
  designer: { id: "00000000-0000-4000-8000-0000000000d1", email: "designer@example.com" },
  admin: { id: "00000000-0000-4000-8000-0000000000ad", email: "admin@example.com" },
} as const;

export const IDS = {
  templateActive: "10000000-0000-4000-8000-000000000001",
  templateDraft: "10000000-0000-4000-8000-000000000002",
  templateSecond: "10000000-0000-4000-8000-000000000003",
  versionActive: "20000000-0000-4000-8000-000000000001",
  versionDraft: "20000000-0000-4000-8000-000000000002",
  versionSecond: "20000000-0000-4000-8000-000000000003",
  customizationA: "30000000-0000-4000-8000-00000000000a",
  customizationA2: "30000000-0000-4000-8000-0000000000a2",
  customizationA3: "30000000-0000-4000-8000-0000000000a3",
  customizationB: "30000000-0000-4000-8000-00000000000b",
  customizationDraftProduct: "30000000-0000-4000-8000-0000000000d0",
  cartItemA: "40000000-0000-4000-8000-00000000000a",
  cartItemA2: "40000000-0000-4000-8000-0000000000a2",
} as const;

export const PRODUCT_DATA = {
  currency: "BDT",
  formatOptions: [],
  sizeOptions: ['5" x 7"'],
  paperStyleOptions: [],
  paperOptions: ["Signature Matte", { label: "Premium", surcharge: 100 }],
  envelopeOptions: ["No Envelopes"],
  cornerOptions: ["Squared"],
  printingOptions: ["Standard"],
  customizationFields: [
    { name: "bride_name", label: "Bride name", type: "text", required: false },
    { name: "photo_upload", label: "Photo upload", type: "image", required: false },
  ],
};

export const BASIC_OPTIONS = {
  format: "Printed Flat Card",
  size: '5" x 7"',
  paper: "Signature Matte",
  envelope: "No Envelopes",
  corner: "Squared",
  printing: "Standard",
};

/** A real (small) published template document, as the admin builder publishes. */
export const VERSION_DOCUMENT = {
  canvas: { widthPx: 1500, heightPx: 2100, widthIn: 5, heightIn: 7, dpi: 300, orientation: "portrait" },
  pages: [{ id: "front", name: "Front", enabled: true, backgroundColor: "#ffffff" }],
  fields: [{ id: "names", label: "Names", type: "text", required: false }],
  layers: [
    {
      id: "names_layer",
      name: "Names",
      pageId: "front",
      type: "text",
      fieldId: "names",
      customerEditable: true,
      x: 750,
      y: 300,
      width: 900,
      height: 120,
      text: "",
      textStyle: { fontFamily: "Cormorant Garamond", fontSize: 48 },
    },
  ],
  settings: { featureFlags: { customizer_v2_server_rendering: true } },
};

export async function seedCheckoutFixtures(t: SqlDatabase): Promise<void> {
  const { db } = t;
  for (const user of Object.values(USERS)) {
    await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [user.id, user.email]);
  }
  await db.query("update public.profiles set role = 'designer' where id = $1", [USERS.designer.id]);
  await db.query("update public.profiles set role = 'admin' where id = $1", [USERS.admin.id]);

  const data = JSON.stringify(PRODUCT_DATA);
  await db.query(
    `insert into public.products (id, slug, title, status, visibility, price, sale_price, data) values
      ('product-active', 'pearl-invitation', 'Pearl Invitation', 'active', 'public', 120, 100, $1::jsonb),
      ('product-second', 'linen-menu', 'Linen Menu Card', 'active', 'public', 80, null, $1::jsonb),
      ('product-draft', 'draft-card', 'Draft Card', 'draft', 'public', 50, null, $1::jsonb),
      ('product-hidden', 'hidden-card', 'Hidden Card', 'active', 'hidden', 50, null, $1::jsonb),
      ('product-soldout', 'soldout-card', 'Sold Out Card', 'active', 'public', 50, null, $1::jsonb)`,
    [data],
  );
  await db.query("update public.products set is_stock_out = true where id = 'product-soldout'");

  await db.query(
    `insert into public.product_customizer_templates (id, product_id, enabled) values
      ($1, 'product-active', true), ($2, 'product-draft', true), ($3, 'product-second', true)`,
    [IDS.templateActive, IDS.templateDraft, IDS.templateSecond],
  );
  const documentJson = JSON.stringify(VERSION_DOCUMENT);
  await db.query(
    `insert into public.customizer_template_versions (id, template_id, product_id, version, document) values
      ($1, $2, 'product-active', 1, $7::jsonb),
      ($3, $4, 'product-draft', 1, $7::jsonb),
      ($5, $6, 'product-second', 1, $7::jsonb)`,
    [IDS.versionActive, IDS.templateActive, IDS.versionDraft, IDS.templateDraft, IDS.versionSecond, IDS.templateSecond, documentJson],
  );

  await db.query(
    `insert into public.cart_items (id, user_id, product_id, product_slug, product_title, quantity, unit_price, metadata) values
      ($1, $2, 'product-active', 'pearl-invitation', 'Pearl Invitation', 2, 0.01, $4::jsonb),
      ($3, $2, 'product-active', 'pearl-invitation', 'Pearl Invitation', 1, 0.01, '{}'::jsonb)`,
    [IDS.cartItemA, USERS.customerA.id, IDS.cartItemA2, JSON.stringify({ customizationId: IDS.customizationA })],
  );

  const options = JSON.stringify({ ...BASIC_OPTIONS, paper: "Premium +$100.00" });
  await db.query(
    `insert into public.product_customizations
       (id, user_id, product_id, template_id, template_version, status, cart_item_id, selected_options, values) values
      ($1, $2, 'product-active', $3, 1, 'in_cart', $4, $5::jsonb, '{"names":"A & B"}'::jsonb),
      ($6, $2, 'product-active', $3, 1, 'draft', null, $5::jsonb, '{}'::jsonb),
      ($7, $8, 'product-active', $3, 1, 'in_cart', null, $5::jsonb, '{}'::jsonb),
      ($9, $2, 'product-draft', $10, 1, 'draft', null, $5::jsonb, '{}'::jsonb),
      ($11, $2, 'product-second', $12, 1, 'draft', null, $5::jsonb, '{"names":"Menu"}'::jsonb)`,
    [
      IDS.customizationA, USERS.customerA.id, IDS.templateActive, IDS.cartItemA, options,
      IDS.customizationA2,
      IDS.customizationB, USERS.customerB.id,
      IDS.customizationDraftProduct, IDS.templateDraft,
      IDS.customizationA3, IDS.templateSecond,
    ],
  );
}

/** A server-side cart line, as the storefront creates one. */
export async function addCartLine(
  t: SqlDatabase,
  options: { user?: { id: string }; productId?: string; quantity?: number; customizationId?: string | null } = {},
): Promise<string> {
  const id = randomUUID();
  await t.db.query(
    "insert into public.cart_items (id, user_id, product_id, product_title, quantity, unit_price, metadata) values ($1, $2, $3, 'Cart line', $4, 0.01, $5::jsonb)",
    [
      id,
      (options.user || USERS.customerA).id,
      options.productId || "product-active",
      options.quantity ?? 1,
      JSON.stringify(options.customizationId ? { customizationId: options.customizationId } : {}),
    ],
  );
  return id;
}

export async function updatedAt(t: SqlDatabase, table: string, id: string): Promise<string> {
  const result = await t.db.query<{ at: string }>(`select updated_at::text as at from public.${table} where id = $1`, [id]);
  return result.rows[0]?.at;
}

let orderSequence = 0;

/**
 * A consistent, server-shaped payload for create_checkout_order (one line).
 * Used by the SQL-level tests; the pipeline tests build payloads with the real
 * TypeScript pipeline instead.
 */
export async function orderPayload(
  t: SqlDatabase,
  options: {
    customer?: { id: string; email: string };
    submissionId?: string;
    requestHash?: string;
    customizationId?: string | null;
    productId?: string;
    unitPrice?: string;
    quantity?: number;
    cartItemId?: string;
  } = {},
) {
  orderSequence += 1;
  const customer = options.customer || USERS.customerA;
  const productId = options.productId || "product-active";
  const quantity = options.quantity ?? 2;
  const unitPrice = options.unitPrice || "200.00";
  const lineTotal = (Number(unitPrice) * quantity).toFixed(2);
  const customizationId = options.customizationId === undefined ? IDS.customizationA : options.customizationId;
  const cartItemId = options.cartItemId || (await addCartLine(t, { user: customer, productId, quantity, customizationId }));

  const order = {
    id: `order-test-${orderSequence}`,
    customer_id: customer.id,
    customer_name: "Ayesha Rahman",
    customer_email: customer.email,
    customer_phone: "+8801712345678",
    product_id: productId,
    product_title: "Pearl Invitation",
    product_slug: "pearl-invitation",
    subtotal: lineTotal,
    delivery_charge: "0.00",
    total: lineTotal,
    currency: "BDT",
    delivery_method: "delivery",
    message: "Delivery: Home delivery",
    address: { addressLine1: "House 12", city: "Sylhet", country: "Bangladesh" },
    checkout_submission_id: options.submissionId || `submission-${orderSequence}-aaaaaaaaaaaa`,
    request_hash: options.requestHash || `hash-${orderSequence}`,
    terms_version: "2026-09-30",
    metadata: { schemaVersion: 2 },
    // Hostile extras that the transaction must ignore:
    payment_status: "paid",
    status: "delivered",
    checkout_state: "finalized",
  };
  const items = [
    {
      line_number: 1,
      product_id: productId,
      product_slug: "pearl-invitation",
      product_title: "Pearl Invitation",
      product_image: "/images/pearl.png",
      product_sku: "pearl-invitation",
      quantity,
      unit_price: unitPrice,
      line_total: lineTotal,
      currency: "BDT",
      pricing: { unitPrice: Number(unitPrice) },
      selected_options: { ...BASIC_OPTIONS, paper: "Premium" },
      customization_values: {},
      uploaded_files: {},
      preview_data: {},
      customization_id: customizationId,
      metadata: {},
    },
  ];
  const templateId: string = productId === "product-second" ? IDS.templateSecond : IDS.templateActive;
  const versionId: string = productId === "product-second" ? IDS.versionSecond : IDS.versionActive;
  const snapshots = customizationId
    ? [
        {
          line_number: 1 as number | null,
          customization_id: customizationId,
          product_id: productId,
          product_title: "Pearl Invitation",
          product_sku: "pearl-invitation",
          quantity,
          selected_options: { ...BASIC_OPTIONS, paper: "Premium" },
          pricing: { unitPrice: Number(unitPrice) },
          template_id: templateId,
          template_version: 1,
          template_version_id: versionId,
          snapshot: {
            snapshotSchemaVersion: 1,
            document: { pages: [] },
            production: makeProductionInput({ canvasWidthPx: 120, canvasHeightPx: 160, cardWidthIn: 5, cardHeightIn: 7, dpi: 300, pages: [{ id: "front", enabled: true }], layers: [], featureFlags: { customizer_v2_server_rendering: true } }, {}, null),
          },
          preflight: { ok: true, blocking: false, issues: [] },
          preview_files: {},
          integrity_hash: "hash",
        },
      ]
    : [];
  const guards = {
    products: [{ id: productId, updated_at: await updatedAt(t, "products", productId) }],
    customizations: customizationId
      ? [{ id: customizationId, product_id: productId, updated_at: await updatedAt(t, "product_customizations", customizationId) }]
      : [],
    cart_items: [{ id: cartItemId, line_number: 1, product_id: productId, quantity, customization_id: customizationId || "" }],
  };
  for (const snapshot of snapshots) snapshot.integrity_hash = productionIntegrityHash(snapshot.snapshot);
  return { order, items, snapshots, guards, cartItemId };
}

type OrderIdentity = { id: string; customer_id: string; checkout_submission_id: string };

/**
 * Take the checkout preparation lease for an order payload, exactly as the
 * application does before any expensive work. Returns null when this order id
 * already has a lease (a test replaying the same payload).
 */
export async function acquirePreparation(t: SqlDatabase, order: OrderIdentity, leaseSeconds = 300): Promise<{ id: string; leaseToken: string } | null> {
  // Databases migrated only up to an older version have no leases yet.
  const table = await t.db.query<{ exists: boolean }>("select to_regclass('public.checkout_preparations') is not null as exists");
  if (!table.rows[0]?.exists) return null;
  const existing = await t.db.query("select 1 from public.checkout_preparations where order_id = $1", [order.id]);
  if (existing.rows.length) return null;
  const result = await t.asService((db) =>
    db.query<{ r: { status: string; id?: string; leaseToken?: string } }>(
      "select public.acquire_checkout_preparation($1::uuid, $2, $3, $4, $5) as r",
      [order.customer_id, order.checkout_submission_id, "0".repeat(64), order.id, leaseSeconds],
    ),
  );
  const attempt = result.rows[0].r;
  if (attempt.status !== "acquired" || !attempt.id || !attempt.leaseToken) throw new Error(`CHECKOUT_PREPARATION_BUSY: ${JSON.stringify(attempt)}`);
  return { id: attempt.id, leaseToken: attempt.leaseToken };
}

export async function releasePreparation(t: SqlDatabase, lease: { id: string; leaseToken: string }, code = "TEST_FAILED") {
  const result = await t.asService((db) => db.query<{ s: string | null }>("select public.release_checkout_preparation($1::uuid, $2::uuid, $3) as s", [lease.id, lease.leaseToken, code]));
  return result.rows[0]?.s ?? null;
}

/** The checkout transaction, called like the application: under a lease. */
export async function callCheckoutRpc(t: SqlDatabase, payload: { order: unknown; items: unknown; snapshots: unknown; guards: unknown }) {
  const lease = await acquirePreparation(t, payload.order as OrderIdentity);
  try {
    const r = await t.asService(async (db) => {
      const result = await db.query<{ r: { status: string; order_id: string } }>(
        "select public.create_checkout_order($1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb) as r",
        [JSON.stringify(payload.order), JSON.stringify(payload.items), JSON.stringify(payload.snapshots), JSON.stringify(payload.guards)],
      );
      return result.rows[0].r;
    });
    if (lease && r.status !== "created") await releasePreparation(t, lease, `NOT_CREATED_${r.status}`);
    return r;
  } catch (error) {
    if (lease) await releasePreparation(t, lease).catch(() => undefined);
    throw error;
  }
}

export async function count(t: SqlDatabase, sql: string, params: unknown[] = []): Promise<number> {
  const result = await t.db.query<{ n: number }>(`select count(*)::int as n from (${sql}) q`, params);
  return result.rows[0].n;
}
