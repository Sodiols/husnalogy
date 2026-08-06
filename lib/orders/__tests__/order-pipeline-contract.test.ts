import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Contract guards for the order pipeline. The pure maths is covered in
// trusted-order.test.ts; these assertions pin the WIRING, because every defect
// they guard against was a fail-open path that looked harmless in isolation.

const orders = readFileSync(join(process.cwd(), "lib/orders/index.ts"), "utf8");
const snapshots = readFileSync(join(process.cwd(), "lib/customizer/order-snapshots.ts"), "utf8");

describe("trusted pricing wiring", () => {
  it("routes every order through the trusted repricer", () => {
    expect(orders).toContain("applyTrustedOrderPricing");
    expect(orders).toContain("if (!priced.ok) return { ok: false, errors: priced.errors }");
  });

  it("never keeps submitted prices when the catalogue fails to load", () => {
    expect(orders).not.toContain("keeping submitted prices");
    // The old fail-open shape ("could not load products -> return the order
    // untouched") is gone: the catalogue failure is handed to the repricer,
    // which rejects the order.
    expect(orders).toContain("products = null;");
    expect(orders).toContain("return applyTrustedOrderPricing(order, products);");
  });

  it("does not price line items inline any more", () => {
    // calculateCustomizationPrice must only be reached through trusted-order.ts
    // so option validation can never be bypassed.
    expect(orders).not.toContain("calculateCustomizationPrice");
  });
});

describe("order design snapshot atomicity", () => {
  it("treats a snapshot failure as fatal for the order", () => {
    expect(orders).toContain("evaluateSnapshotOutcome");
    expect(orders).toContain("ORDER_SNAPSHOT_FAILED");
    // Compensating rollback: the half-created order is removed.
    expect(orders).toContain('await supabase.from("orders").delete().eq("id", data.id)');
  });

  it("marks customizations ordered only after the snapshot exists", () => {
    const snapshotIndex = orders.indexOf("createOrderDesignSnapshots(order");
    const orderedIndex = orders.indexOf('status: "ordered"');
    expect(snapshotIndex).toBeGreaterThan(-1);
    expect(orderedIndex).toBeGreaterThan(snapshotIndex);
  });

  it("no longer swallows snapshot failures", () => {
    expect(orders).not.toContain("Could not create order design snapshots:\", snapshotError);\n    }\n  }\n\n  return order;");
    expect(snapshots).toContain("failures.push(");
    expect(snapshots).toContain("return { created, failures }");
  });

  it("points order_item_id at the inserted order item, not the cart item", () => {
    // order_design_snapshots.order_item_id is a FK to order_items(id); writing
    // the cart item id there violated the constraint on every insert.
    expect(snapshots).toContain("orderItemIdByCustomizationId[String(customization.id)] || null");
    expect(snapshots).not.toContain("order_item_id: item.id || null");
    expect(orders).toContain('.select("id,metadata")');
    expect(orders).toContain("orderItemIdByCustomizationId[String(customizationId)]");
  });
});

describe("delivery charge", () => {
  it("is decided server side", () => {
    expect(orders).toContain("applyTrustedOrderPricing");
    // The submitted deliveryCharge never survives into the persisted total.
    const trusted = readFileSync(join(process.cwd(), "lib/orders/trusted-order.ts"), "utf8");
    expect(trusted).toContain("resolveDeliveryCharge");
    expect(trusted).toContain("deliveryCharge = resolveDeliveryCharge(order)");
  });
});
