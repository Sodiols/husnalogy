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
