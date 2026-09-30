import { expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

function readSeedManifest(): Record<string, any> {
  const path = join(process.cwd(), ".customizer-e2e.json");
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return {}; }
}

export const seedManifest = readSeedManifest();

export function requireSeededAcceptance(fields: Array<[string, unknown]>) {
  const missing = fields.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    throw new Error(`Seeded Customizer V2 acceptance cannot run. Missing ${missing.join(", ")}. Run npm run seed:customizer:test against the dedicated local/staging project.`);
  }
}

export async function login(page: Page, email: string, password: string, next = "/") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.locator('input[autocomplete="email"]').fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 30_000 });
}

export const customerCredentials = {
  email: process.env.E2E_CUSTOMER_EMAIL || seedManifest.customerAEmail || "",
  password: process.env.E2E_CUSTOMER_PASSWORD || seedManifest.password || "",
};

export const adminCredentials = {
  email: process.env.E2E_ADMIN_EMAIL || seedManifest.adminEmail || "",
  password: process.env.E2E_ADMIN_PASSWORD || seedManifest.password || "",
};

/**
 * The seeded fixture product uses the default option lists, so these are the
 * valid identities. The order API accepts ONLY identifiers, choices and
 * contact details — never prices, titles, currencies or statuses.
 */
export const SEEDED_OPTIONS = {
  format: "Printed Flat Card",
  size: '5" x 7"',
  paper: "Signature Matte",
  envelope: "No Envelopes",
  corner: "Squared",
  printing: "Standard",
};

export const TERMS_VERSION = "2026-09-30";

export function checkoutBody(overrides: Record<string, unknown> = {}) {
  return {
    checkoutSubmissionId: `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
    customerName: "E2E Customer",
    customerPhone: "01711000001",
    deliveryMethod: "store",
    deliveryNote: "",
    acceptTerms: true,
    termsVersion: TERMS_VERSION,
    items: [{ productId: seedManifest.productId, quantity: 1, selectedOptions: { ...SEEDED_OPTIONS } }],
    ...overrides,
  };
}

/* ------------------------------------------------------------------------ */
/* Server-side cart lines                                                    */
/* ------------------------------------------------------------------------ */

// Public values (the same ones shipped to every browser). Required only for
// the seeded suites that create cart lines through Supabase REST.
export const supabaseUrl = (process.env.E2E_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
export const supabaseAnonKey =
  process.env.E2E_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

/** The signed-in user's access token, read from the Supabase SSR auth cookie. */
export async function sessionAccessToken(page: Page): Promise<string> {
  const cookies = (await page.context().cookies()).filter((cookie) => /^sb-.+-auth-token(\.\d+)?$/.test(cookie.name));
  const joined = cookies
    .sort((a, b) => Number(a.name.split(".").pop()) - Number(b.name.split(".").pop()))
    .map((cookie) => decodeURIComponent(cookie.value))
    .join("");
  const raw = joined.startsWith("base64-") ? Buffer.from(joined.slice(7), "base64").toString("utf8") : joined;
  try {
    return String(JSON.parse(raw)?.access_token || "");
  } catch {
    return "";
  }
}

/**
 * Create a server-side cart line exactly as the storefront does (Supabase
 * REST, customer session, RLS). Returns its id.
 */
export async function createCartLine(page: Page, line: { productId: string; quantity?: number; customizationId?: string }): Promise<string> {
  const token = await sessionAccessToken(page);
  if (!supabaseUrl || !supabaseAnonKey || !token) throw new Error("Set E2E_SUPABASE_URL and E2E_SUPABASE_ANON_KEY and sign in before creating cart lines.");
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  const response = await fetch(`${supabaseUrl}/rest/v1/cart_items`, {
    method: "POST",
    headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: payload.sub,
      product_id: line.productId,
      product_title: "E2E cart line",
      quantity: line.quantity ?? 1,
      unit_price: 0.01, // never trusted
      metadata: line.customizationId ? { customizationId: line.customizationId } : {},
    }),
  });
  const rows = await response.json();
  if (!response.ok || !rows?.[0]?.id) throw new Error(`Could not create a cart line: ${response.status} ${JSON.stringify(rows).slice(0, 200)}`);
  return String(rows[0].id);
}

/** A valid order body whose single line consumes a fresh server-side cart line. */
export async function checkoutBodyWithCart(page: Page, overrides: Record<string, unknown> = {}, line: Record<string, unknown> = {}) {
  const quantity = Number(line.quantity ?? 1);
  const cartItemId = await createCartLine(page, { productId: seedManifest.productId, quantity, customizationId: line.customizationId as string | undefined });
  return checkoutBody({ items: [{ productId: seedManifest.productId, quantity, selectedOptions: { ...SEEDED_OPTIONS }, cartItemId, ...line }], ...overrides });
}
