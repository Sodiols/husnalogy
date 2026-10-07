/**
 * POST /api/customizations — a design queued on another account's screen is
 * never CREATED in the signed-in account (shared browser, session changed
 * underneath an open editor). Refused before any product, template or table
 * is touched.
 */
import { describe, expect, it, vi } from "vitest";
import { rejectAccountMismatch } from "@/lib/customizer/customization-write";

const SIGNED_IN = "11111111-1111-4111-8111-111111111111";
const touched: string[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: SIGNED_IN } } }) } }),
  createServiceRoleClient: () => ({ from: (name: string) => (touched.push(name), { insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }),
}));
vi.mock("@/lib/products", async (importOriginal) => {
  const original: any = await importOriginal();
  return { ...original, getProductRecordsForCheckout: async () => (touched.push("products"), new Map()) };
});
vi.mock("@/lib/security/rate-limit", () => ({ rateLimit: () => null }));

const { POST } = await import("@/app/api/customizations/route");

const post = (body: Record<string, unknown>) =>
  POST(new Request("http://localhost/api/customizations", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" }, body: JSON.stringify(body) }));

describe("the account precondition", () => {
  it("a new design from another account's screen is refused with account-changed", async () => {
    const response = await post({ expectedUserId: "22222222-2222-4222-8222-222222222222", productId: "p", templateId: "t", templateVersion: 1, values: { couple: "A's private names" } });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("account-changed");
    expect(touched).toEqual([]);
  });

  it("matching and absent preconditions pass through (ownership still comes from the session)", () => {
    expect(rejectAccountMismatch({ expectedUserId: SIGNED_IN }, SIGNED_IN)).toBeNull();
    expect(rejectAccountMismatch({}, SIGNED_IN)).toBeNull();
    expect(rejectAccountMismatch({ expectedUserId: "" }, SIGNED_IN)).toBeNull();
    expect(rejectAccountMismatch({ expectedUserId: "someone-else" }, SIGNED_IN)?.status).toBe(409);
  });
});
