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
