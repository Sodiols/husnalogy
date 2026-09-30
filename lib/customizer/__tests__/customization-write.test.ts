import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareCustomerWrite, sanitizeSelectedOptionsShape } from "@/lib/customizer/customization-write";

const existing = { productId: "product-a", templateId: "template-a", templateVersion: 3 };

describe("what a customer may write to a customization", () => {
  it.each([
    ["userId", { userId: "someone-else" }],
    ["orderId", { orderId: "order-1" }],
    ["status ordered", { status: "ordered" }],
    ["status unknown", { status: "approved" }],
    ["printFiles", { printFiles: { front: { path: "x" } } }],
    ["previewImages", { previewImages: { front: "https://evil.example" } }],
  ])("rejects %s", (_label, body) => {
    expect(prepareCustomerWrite(body, existing).ok).toBe(false);
    expect(prepareCustomerWrite(body, null).ok).toBe(false);
  });

  it.each([
    ["productId", { productId: "product-b" }],
    ["templateId", { templateId: "template-b" }],
    ["templateVersion", { templateVersion: 1 }],
  ])("cannot move an existing design by changing %s", (_label, body) => {
    const result = prepareCustomerWrite(body, existing);
    expect(result.ok).toBe(false);
  });

  it("accepts the unchanged identity the editor re-sends with every autosave", () => {
    const result = prepareCustomerWrite({ productId: "product-a", templateId: "template-a", templateVersion: 3, values: { names: "A" }, previewImages: {} }, existing);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toEqual({ values: { names: "A" } });
    }
  });

  it("never lets an update carry identity fields forward (validation uses the stored ones)", () => {
    const result = prepareCustomerWrite({ values: {}, cartItemId: "x", status: "in_cart" }, existing);
    expect(result.ok && "productId" in result.body).toBe(false);
  });

  it("keeps create identity for the server to verify", () => {
    const result = prepareCustomerWrite({ productId: "product-a", templateId: "template-a", templateVersion: 3, values: {} }, null);
    expect(result.ok && result.body.productId).toBe("product-a");
  });

  it("stores option choices with a safe shape only", () => {
    expect(sanitizeSelectedOptionsShape({ paper: "Premium +$0", logo: true, quantity: 10, nested: { a: 1 }, evil: "x", size: { label: "x" } })).toEqual({
      paper: "Premium +$0",
      logo: true,
      quantity: 10,
    });
  });
});

describe("the save validator fails closed (no 'nothing to validate' bypass)", () => {
  const source = readFileSync(join(process.cwd(), "lib/customizer/save-validation.ts"), "utf8");

  it("rejects a design whose template cannot be resolved", () => {
    expect(source).not.toContain("nothing to validate against");
    expect(source).toContain('code: "template-unavailable"');
  });

  it("gives the stored identity precedence over the request body", () => {
    expect(source).toContain("existing.productId || body.productId");
    expect(source).toContain("existing.templateId || body.templateId");
  });

  it("POST only creates; PATCH derives context from the stored row", () => {
    const post = readFileSync(join(process.cwd(), "app/api/customizations/route.ts"), "utf8");
    const patch = readFileSync(join(process.cwd(), "app/api/customizations/[id]/route.ts"), "utf8");
    expect(post).toContain("Use PATCH /api/customizations/{id} to update an existing design.");
    expect(post).not.toContain(".update(");
    expect(patch).toContain("productId: String(existingRow.product_id");
    expect(patch).toContain("prepareCustomerWrite(rawBody, context)");
  });
});
