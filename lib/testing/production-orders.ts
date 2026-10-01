/**
 * Places real finalized personalized orders for worker tests (test-only): a
 * fresh product, template version and design; production inputs pinned with
 * the PRODUCTION pinning code (image + Inter font + licence); and the real
 * checkout transaction under a preparation lease.
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { TestDatabase } from "@/lib/testing/pglite-supabase";
import { callCheckoutRpc, orderPayload, USERS } from "@/lib/testing/checkout-fixtures";
import type { createProductionTestClient } from "@/lib/testing/pglite-production-client";
import { makeProductionInput, productionIntegrityHash } from "@/lib/customizer/production-input";
import { pinProductionInput, productionStorage } from "@/lib/customizer/server/production-assets";

type Storage = ReturnType<typeof createProductionTestClient>;

export const TEST_FONT_URL = "https://fonts.gstatic.com/immutable-test/inter.ttf";

export async function placeAutomaticOrder(t: TestDatabase, storage: Storage, options: { customer?: { id: string; email: string }; color?: string } = {}) {
  const query = async (sql: string, values: unknown[] = []) => (await t.db.query<Record<string, any>>(sql, values)).rows;
  const productId = `worker-product-${randomUUID()}`;
  const template = randomUUID();
  const version = randomUUID();
  const customization = randomUUID();
  const customer = options.customer || USERS.customerA;
  await t.db.query("insert into public.products(id,slug,title,status,visibility,price,data) values($1,$1,'Worker product','active','public',200,'{}')", [productId]);
  await t.db.query("insert into public.product_customizer_templates(id,product_id,enabled) values($1,$2,true)", [template, productId]);
  await t.db.query("insert into public.customizer_template_versions(id,template_id,product_id,version,document) values($1,$2,$3,1,'{}')", [version, template, productId]);
  await t.db.query("insert into public.product_customizations(id,user_id,product_id,template_id,template_version,status) values($1,$2,$3,$4,1,'draft')", [customization, customer.id, productId, template]);
  const payload = await orderPayload(t, { customer, customizationId: customization, productId });
  payload.snapshots[0].template_id = template;
  payload.snapshots[0].template_version_id = version;
  const image = await sharp({ create: { width: 40, height: 40, channels: 4, background: options.color || "#b21c40" } }).png().toBuffer();
  const rendererTemplate = {
    canvasWidthPx: 120, canvasHeightPx: 160, cardWidthIn: 1.2, cardHeightIn: 1.6, dpi: 100,
    bleed: { top: 2, right: 2, bottom: 2, left: 2 }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    pages: [{ id: "front", enabled: true, backgroundColor: "#f2efe4" }], fields: [],
    layers: [
      { id: "name", page: "front", type: "text", text: "Approved", x: 60, y: 30, width: 100, height: 24, textStyle: { fontFamily: "Inter", fontWeight: "400", fontSize: 12, textAlign: "center", color: "#000000" } },
      { id: "image", page: "front", type: "image", src: "temporary-upload", x: 40, y: 60, width: 40, height: 40, zIndex: 2 },
    ],
    featureFlags: { customizer_v2_server_rendering: true },
  };
  const input = await pinProductionInput(payload.order.id, makeProductionInput(rendererTemplate, {}, null), productionStorage(storage.client), {
    loadImage: async () => image,
    catalog: async () => [{ family: "Inter", category: "sans-serif", weights: ["400"], variants: [{ key: "regular", weight: "400", style: "normal", url: TEST_FONT_URL }], hasItalic: false, subsets: ["latin"], version: "test-version-A", lastModified: "2026-09-01" }],
    loadFont: async () => readFileSync("app/brand-fonts/Inter-400.ttf"),
    loadLicense: async () => Buffer.from("SIL OPEN FONT LICENSE Version 1.1 - test license fixture"),
  });
  const snapshot = { snapshotSchemaVersion: 1, production: input, document: { approved: true } };
  (payload.snapshots[0] as { snapshot: unknown }).snapshot = snapshot;
  payload.snapshots[0].integrity_hash = productionIntegrityHash(snapshot);
  const created = await callCheckoutRpc(t, payload);
  if (created.status !== "created") throw new Error(`order not created: ${created.status}`);
  const row = (await query("select * from public.order_design_snapshots where order_id=$1", [created.order_id]))[0];
  return { orderId: created.order_id, snapshot: row, customization, productId, template };
}
