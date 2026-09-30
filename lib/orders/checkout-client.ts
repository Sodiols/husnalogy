/**
 * Browser-side checkout helpers (pure; no React, no network).
 *
 * 1. `buildCheckoutItems` turns cart lines into the ONLY shape the order API
 *    accepts: stable identifiers, option choices, quantity and the customer's
 *    own personalization answers. Prices, titles, images, currencies and
 *    totals from the cart are deliberately dropped — the server derives them.
 *
 * 2. The checkout ATTEMPT. One submission id per cart contents, persisted in
 *    sessionStorage, so a refresh, a retry after a lost response, a double
 *    click or a second tab all reuse the same idempotency key. The id rotates
 *    only when the cart itself changes. Once an order is confirmed the attempt
 *    is marked placed, and an unchanged cart (e.g. one whose cleanup failed)
 *    can never be submitted again as a second order.
 */

import { OPTION_GROUPS } from "@/lib/orders/pricing-resolver";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD_NAME = /^[a-z0-9_]{1,60}$/;
const OPTION_KEYS = new Set([...OPTION_GROUPS.map((group) => group.key), "logo"]);

export type CheckoutItemPayload = {
  productId: string;
  quantity: number;
  selectedOptions: Record<string, string | boolean>;
  customizationId?: string;
  cartItemId?: string;
  personalization?: Record<string, string | boolean>;
  uploads?: Record<string, { path: string }>;
};

function pickOptions(source: Record<string, unknown> | undefined): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (!OPTION_KEYS.has(key)) continue;
    if (typeof value === "boolean") out[key] = value;
    else if (typeof value === "string" && value.trim()) out[key] = value.trim().slice(0, 300);
  }
  return out;
}

export function buildCheckoutItems(items: Array<Record<string, any>>): CheckoutItemPayload[] {
  return items.map((item) => {
    const payload: CheckoutItemPayload = {
      productId: String(item.productId || ""),
      quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
      selectedOptions: pickOptions(item.selectedOptions || item.options),
    };
    if (item.customizationId && UUID.test(String(item.customizationId))) payload.customizationId = String(item.customizationId);
    if (item.id && UUID.test(String(item.id))) payload.cartItemId = String(item.id);

    if (!payload.customizationId) {
      const uploaded = item.uploadedFiles && typeof item.uploadedFiles === "object" ? item.uploadedFiles : {};
      const uploads: Record<string, { path: string }> = {};
      for (const [field, file] of Object.entries(uploaded as Record<string, any>)) {
        if (FIELD_NAME.test(field) && file && typeof file.path === "string" && file.path) uploads[field] = { path: file.path };
      }
      const personalization: Record<string, string | boolean> = {};
      const values = item.customizationValues || item.customization || {};
      for (const [field, value] of Object.entries(values as Record<string, unknown>)) {
        if (!FIELD_NAME.test(field) || uploaded[field] !== undefined) continue;
        if (typeof value === "boolean") personalization[field] = value;
        else if (typeof value === "string" && value.trim()) personalization[field] = value.trim().slice(0, 1000);
      }
      if (Object.keys(personalization).length) payload.personalization = personalization;
      if (Object.keys(uploads).length) payload.uploads = uploads;
    }
    return payload;
  });
}

/** A stable description of what is being bought (ids, options, quantities). */
export function cartFingerprint(items: Array<Record<string, any>>): string {
  const lines = buildCheckoutItems(items).map((line) =>
    JSON.stringify([line.cartItemId || "", line.productId, line.quantity, line.customizationId || "", Object.entries(line.selectedOptions).sort()]),
  );
  return lines.sort().join("|");
}

export type CheckoutAttempt = {
  submissionId: string;
  fingerprint: string;
  status: "pending" | "placed";
  orderId?: string;
};

const attemptKey = (userId: string) => `husnalogy_checkout_attempt:${userId}`;

function newSubmissionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function readAttempt(storage: Storage | null, userId: string): CheckoutAttempt | null {
  if (!storage || !userId) return null;
  try {
    const parsed = JSON.parse(storage.getItem(attemptKey(userId)) || "null");
    return parsed && typeof parsed.submissionId === "string" && typeof parsed.fingerprint === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeAttempt(storage: Storage | null, userId: string, attempt: CheckoutAttempt): void {
  if (!storage || !userId) return;
  try {
    storage.setItem(attemptKey(userId), JSON.stringify(attempt));
  } catch {
    // Private mode / quota: the in-memory attempt still protects this page.
  }
}

/**
 * The attempt to submit for the current cart:
 *   * a placed attempt for the SAME cart → no new submission is allowed;
 *   * a pending attempt for the same cart → reuse its id (safe retry);
 *   * anything else → a fresh id for this cart.
 */
export function attemptForCart(previous: CheckoutAttempt | null, fingerprint: string): { attempt: CheckoutAttempt; alreadyPlaced: boolean } {
  if (previous && previous.fingerprint === fingerprint) {
    return { attempt: previous, alreadyPlaced: previous.status === "placed" };
  }
  return { attempt: { submissionId: newSubmissionId(), fingerprint, status: "pending" }, alreadyPlaced: false };
}
