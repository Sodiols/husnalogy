/**
 * `CheckoutDeps` backed by the PGlite test database (test-only).
 *
 * Every dependency the production pipeline uses is implemented with real SQL
 * against the real schema and the real `create_checkout_order` transaction.
 * `verifyCustomization` performs the production template-identity checks in
 * SQL and builds the snapshot with the PRODUCTION composer
 * (`composeOrderDesignSnapshot`) from the stored published version — only the
 * private-asset URL signing (Supabase Storage) is skipped. `afterOrderCreated`
 * runs the PRODUCTION outbox processor against the real task tables.
 */

import { CheckoutTransactionError, parsePreparationAttempt, transactionErrorFrom, type CheckoutDeps } from "@/lib/orders/checkout";
import { pricingBreakdown } from "@/lib/orders/pricing-resolver";
import { orderFromRow, toCustomerOrderView } from "@/lib/orders/order-view";
import { composeOrderDesignSnapshot } from "@/lib/customizer/snapshot-compose";
import { templateFromVersionSnapshot } from "@/lib/customizer/versions";
import { processTasks } from "@/lib/outbox/processor";
import { makeNotificationRunner } from "@/lib/notifications/notification-runner";
import type { EmailTransport } from "@/lib/notifications/email-provider";
import { fakeRenderRunner, notificationStore, productionStore } from "@/lib/testing/pglite-outbox";
import type { TestDatabase } from "@/lib/testing/pglite-supabase";
import { personalizationFreezer } from "@/lib/orders/personalization-production";
import { createProductionTestClient } from "@/lib/testing/pglite-production-client";
import sharp from "sharp";

let sequence = 0;

function productFromTestRow(row: any) {
  const data = row.data || {};
  return {
    ...data,
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    visibility: row.visibility,
    price: row.price === null ? null : Number(row.price),
    salePrice: row.sale_price === null ? (row.price === null ? null : Number(row.price)) : Number(row.sale_price),
    currency: data.currency || "BDT",
    isStockOut: Boolean(row.is_stock_out),
    deletedAt: row.deleted_at,
    thumbnail: data.thumbnail || "",
    images: data.images || [],
  };
}

export async function loadOrderView(t: TestDatabase, orderId: string) {
  const order = await t.asService((db) => db.query<any>("select * from public.orders where id = $1", [orderId]));
  if (!order.rows[0]) return null;
  const items = await t.asService((db) => db.query<any>("select * from public.order_items where order_id = $1", [orderId]));
  return orderFromRow({ ...order.rows[0], order_items: items.rows });
}

export type PgliteDepsOptions = {
  /** Sends email; `null` = no provider configured. */
  transport?: EmailTransport | null;
  /** Makes the render enqueue fail (forced production-queue failure). */
  failRender?: () => boolean;
  /** Observes every preparation lease request. */
  onAcquire?: () => void;
};

export function createPgliteCheckoutDeps(t: TestDatabase, options: PgliteDepsOptions = {}): CheckoutDeps {
  const service = <T>(work: (db: TestDatabase["db"]) => Promise<T>) => t.asService(work);
  const storage = createProductionTestClient(t);
  const download = storage.client.storage.from.bind(storage.client.storage);
  const fixtureImage = sharp({ create: { width: 1, height: 1, channels: 4, background: "#ff0000" } }).png().toBuffer();
  storage.client.storage.from = (bucket: string) => bucket === "customer-uploads" ? { download: async () => ({ data: new Blob([new Uint8Array(await fixtureImage)]), error: null }) } : download(bucket);

  return {
    freezePersonalization: personalizationFreezer(storage.client),
    newOrderId: () => `order-pipeline-${Date.now()}-${(sequence += 1)}`,

    async loadProducts(ids) {
      const result = await service((db) =>
        db.query<any>(
          "select id, slug, title, status, visibility, price::text as price, sale_price::text as sale_price, is_stock_out, deleted_at, data, updated_at::text as updated_at from public.products where id = any($1::text[])",
          [ids],
        ),
      );
      return new Map(result.rows.map((row) => [row.id, { product: productFromTestRow(row), updatedAt: row.updated_at }]));
    },

    async loadCustomizations(ids) {
      const result = await service((db) =>
        db.query<any>("select *, updated_at::text as updated_at from public.product_customizations where id = any($1::uuid[])", [ids]),
      );
      return new Map(result.rows.map((row) => [String(row.id), row]));
    },

    async loadVerifiedUploads(userId, paths) {
      const result = await service((db) =>
        db.query<any>(
          "select bucket, path, file_name, mime_type, size_bytes from public.customer_uploads where user_id = $1 and path = any($2::text[])",
          [userId, paths],
        ),
      );
      return new Map(
        result.rows
          .filter((row) => String(row.path).startsWith(`${userId}/`))
          .map((row) => [row.path, { bucket: row.bucket, path: row.path, name: row.file_name || "", mimeType: row.mime_type || "", size: Number(row.size_bytes) || 0 }]),
      );
    },

    async verifyCustomization({ row, product, line, lineNumber }) {
      const version = await service((db) =>
        db.query<any>(
          `select v.* from public.customizer_template_versions v
             join public.product_customizer_templates tpl on tpl.id = v.template_id
            where v.template_id = $1 and v.version = $2 and v.product_id = $3 and tpl.product_id = $3`,
          [row.template_id, row.template_version, product.id],
        ),
      );
      const versionRow = version.rows[0];
      if (!versionRow) {
        return { ok: false, code: "CUSTOMIZATION_TEMPLATE_VERSION_INVALID", message: "This design's template version is no longer available." };
      }
      const template = templateFromVersionSnapshot({
        id: versionRow.id,
        templateId: versionRow.template_id,
        productId: versionRow.product_id,
        version: versionRow.version,
        majorVersion: versionRow.major_version,
        minorRevision: versionRow.minor_revision,
        displayVersion: `${versionRow.major_version}.${versionRow.minor_revision}`,
        schemaVersion: versionRow.schema_version,
        engineVersion: versionRow.engine_version,
        document: versionRow.document,
        fontDependencies: versionRow.font_dependencies || [],
        publishedBy: null,
        notes: "",
        createdAt: String(versionRow.created_at),
      });
      const snapshot = composeOrderDesignSnapshot({
        lineNumber,
        row,
        product,
        template,
        templateSource: "version",
        templateVersionId: versionRow.id,
        selectedOptions: line.options,
        quantity: line.quantity,
        pricing: pricingBreakdown(line),
      });
      return {
        ok: true,
        snapshot,
        values: snapshot.snapshot.values as Record<string, unknown>,
        uploadedFiles: snapshot.snapshot.uploadedFiles as Record<string, unknown>,
        templateId: String(row.template_id),
        templateVersion: Number(row.template_version),
      };
    },

    async checkCartLines(customerId, cartItemIds) {
      const lines = await service((db) => db.query<{ id: string }>("select id from public.cart_items where user_id = $1 and id = any($2::uuid[])", [customerId, cartItemIds]));
      const claims = await service((db) =>
        db.query<{ order_id: string }>("select order_id from public.checkout_cart_claims where customer_id = $1 and cart_item_id = any($2::uuid[])", [customerId, cartItemIds]),
      );
      const present = new Set(lines.rows.map((row) => String(row.id)));
      return { consumedByOrderId: claims.rows[0]?.order_id ?? null, missing: cartItemIds.some((id) => !present.has(id)) };
    },

    async acquirePreparation({ customerId, submissionId, cartFingerprint, orderId, leaseSeconds }) {
      options.onAcquire?.();
      const result = await service((db) =>
        db.query<{ r: unknown }>("select public.acquire_checkout_preparation($1::uuid, $2, $3, $4, $5) as r", [customerId, submissionId, cartFingerprint, orderId, leaseSeconds]),
      );
      return parsePreparationAttempt(result.rows[0]?.r);
    },

    async releasePreparation(lease, { orderId, code, usage }) {
      const result = await service((db) =>
        db.query<{ s: string | null }>("select public.release_checkout_preparation($1::uuid, $2::uuid, $3, $4, $5) as s", [lease.id, lease.leaseToken, code, usage.storedPaths.length, usage.bytes]),
      );
      const status = result.rows[0]?.s;
      if (status !== "failed" && status !== "abandoned") return { removed: 0 };
      const paths = usage.storedPaths.filter((path) => path.startsWith(`orders/${orderId}/`));
      const bucket = storage.client.storage.from("order-production");
      await bucket.remove(paths);
      return { removed: paths.length };
    },

    async findOrderBySubmission(customerId, submissionId) {
      const result = await service((db) =>
        db.query<any>("select id, checkout_state, request_hash from public.orders where customer_id = $1 and checkout_submission_id = $2", [customerId, submissionId]),
      );
      const row = result.rows[0];
      return row ? { id: row.id, checkoutState: row.checkout_state, requestHash: row.request_hash } : null;
    },

    async createOrder({ order, items, snapshots, guards }) {
      try {
        const result = await service((db) =>
          db.query<any>("select public.create_checkout_order($1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb) as r", [
            JSON.stringify(order),
            JSON.stringify(items),
            JSON.stringify(snapshots),
            JSON.stringify(guards),
          ]),
        );
        const r = result.rows[0].r;
        return { status: r.status, orderId: r.order_id };
      } catch (error: any) {
        if (error instanceof CheckoutTransactionError) throw error;
        throw transactionErrorFrom({ code: error?.code, message: error?.message, details: error?.detail });
      }
    },

    async loadOrder(orderId, customerId) {
      const view = await loadOrderView(t, orderId);
      return view && view.customerId === customerId && view.checkoutState === "finalized" ? toCustomerOrderView(view) : null;
    },

    async afterOrderCreated(orderId) {
      await processTasks("production", productionStore(t), fakeRenderRunner(t, options.failRender), { orderId, limit: 20 });
      await processTasks(
        "notification",
        notificationStore(t),
        makeNotificationRunner({ transport: options.transport ?? null, adminRecipient: "orders@husnalogy.test", loadOrder: (id) => loadOrderView(t, id) }),
        { orderId, limit: 5 },
      );
    },
  };
}
