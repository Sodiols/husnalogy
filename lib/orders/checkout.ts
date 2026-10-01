/**
 * The checkout pipeline.
 *
 *   authenticated user + untrusted body
 *     → strict schema (normalized, canonical contact data, stable ids only)
 *     → idempotency pre-check (customer-scoped submission id)
 *     → trusted products (server rows) → purchasability
 *     → trusted options + prices (pricing-resolver, integer minor units)
 *     → personalization / uploads verified against server data
 *     → customizations: strict owner, same product, same options, orderable,
 *       template version of THIS product, server-side design validation,
 *       preflight, immutable snapshot built from the stored row
 *     → ONE database transaction (create_checkout_order): order, items,
 *       snapshots, customization binding, finalization — or nothing
 *     → finalized order returned
 *     → non-critical follow-ups (render queue, cart cleanup), each retry-safe
 *       and unable to change the order's success.
 *
 * All I/O is injected (`CheckoutDeps`) so the whole pipeline — including
 * database failures, lost responses and concurrent submissions — is tested
 * without a live Supabase project.
 */

import { createHash } from "node:crypto";
import { parseCheckoutRequest, type CheckoutItemInput, type CheckoutRequest } from "@/lib/orders/checkout-schema";
import { COD_INITIAL_STATE } from "@/lib/orders/checkout-policy";
import {
  checkProductPurchasable,
  priceLine,
  priceOrder,
  pricingBreakdown,
  resolveSelectedOptions,
  sameCanonicalOptions,
  type CanonicalOptions,
  type TrustedLinePrice,
} from "@/lib/orders/pricing-resolver";
import { resolvePersonalization, type VerifiedUpload } from "@/lib/orders/personalization";
import { minorToDecimalString } from "@/lib/money";
import { logEvent } from "@/lib/observability/logger";
import { PRODUCTION_LIMITS, ProductionAssetBudget, ProductionLimitError, type BudgetUsage } from "@/lib/customizer/production-limits";

export type CheckoutUser = { id: string; email: string };

/**
 * A request that finds another preparation of the same customer in progress
 * waits (polling, doing no expensive work) this long for it to finish.
 */
export const PREPARATION_WAIT_MS = 20_000;

/** A server-loaded product plus the raw `updated_at` used as a price guard. */
export type ProductRecord = { product: Record<string, any>; updatedAt: string };

/**
 * The row stored in `order_design_snapshots` (minus ids the RPC assigns).
 *
 * `line_number` is REQUIRED: it is the trusted order line this design belongs
 * to, and the transaction uses it to link the snapshot to exactly that order
 * item (and refuses the whole order if it cannot).
 */
export type DesignSnapshotPayload = {
  line_number: number;
  customization_id: string;
  product_id: string;
  product_title: string;
  product_sku: string;
  quantity: number;
  selected_options: CanonicalOptions;
  pricing: Record<string, unknown>;
  template_id: string;
  template_version: number;
  template_version_id: string;
  snapshot: Record<string, unknown>;
  preflight: Record<string, unknown>;
  preview_files: Record<string, unknown>;
  integrity_hash: string;
};

export type CustomizationVerification =
  | {
      ok: true;
      snapshot: DesignSnapshotPayload;
      values: Record<string, unknown>;
      uploadedFiles: Record<string, unknown>;
      templateId: string;
      templateVersion: number;
    }
  | { ok: false; code: string; message: string };

export type CreateOrderResult = { status: "created" | "replayed" | "conflict" | "incomplete"; orderId: string };

/** Thrown by `createOrder` for a business-rule refusal inside the transaction. */
export class CheckoutTransactionError extends Error {
  constructor(
    public readonly checkoutCode: string,
    message = checkoutCode,
    /** The RAISE ... DETAIL value (e.g. the order that consumed a cart line). */
    public readonly detail = "",
    /**
     * True when the database itself answered with an error: the transaction
     * was rolled back and can never commit. False when no trustworthy answer
     * arrived (network failure, gateway timeout, malformed result).
     */
    public readonly definitive = false,
  ) {
    super(message);
    this.name = "CheckoutTransactionError";
  }
}

/** Map a Postgres/PostgREST error from the checkout RPC to a checkout code. */
export function transactionErrorFrom(error: { code?: string; message?: string; details?: string } | null): CheckoutTransactionError {
  const message = String(error?.message || "");
  // A SQLSTATE or PGRST code is an answer from the database layer; a network
  // failure has no code and leaves the outcome unknown.
  const definitive = /^(?:[0-9A-Z]{5}|PGRST\d+)$/.test(String(error?.code || ""));
  const match = message.match(/CHECKOUT_[A-Z_]+/);
  if (match) return new CheckoutTransactionError(match[0], message, String(error?.details || ""), true);
  if (error?.code === "23505") {
    const text = `${message} ${error?.details || ""}`;
    if (text.includes("order_items_customization_once")) return new CheckoutTransactionError("CHECKOUT_CUSTOMIZATION_LOCKED", message, "", true);
    if (text.includes("checkout_submission_id")) return new CheckoutTransactionError("CHECKOUT_DUPLICATE_SUBMISSION", message, "", true);
  }
  return new CheckoutTransactionError("CHECKOUT_DATABASE_ERROR", message || "Unknown database error", "", definitive);
}

/** A held checkout preparation lease (see acquire_checkout_preparation). */
export type PreparationLease = { id: string; leaseToken: string; leaseExpiresAt: string };

export type PreparationAttempt =
  | ({ status: "acquired" } & PreparationLease)
  | { status: "busy"; sameSubmission: boolean; sameCart: boolean; retryAfterSeconds: number };

/** Strictly read the acquire_checkout_preparation result (shared by adapters). */
export function parsePreparationAttempt(data: unknown): PreparationAttempt {
  const value = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (value.status === "busy") {
    return {
      status: "busy",
      sameSubmission: value.sameSubmission === true,
      sameCart: value.sameCart === true,
      retryAfterSeconds: Math.max(1, Math.floor(Number(value.retryAfterSeconds) || 1)),
    };
  }
  if (value.status === "acquired" && typeof value.id === "string" && typeof value.leaseToken === "string") {
    return { status: "acquired", id: value.id, leaseToken: value.leaseToken, leaseExpiresAt: String(value.leaseExpiresAt || "") };
  }
  throw new CheckoutTransactionError("CHECKOUT_DATABASE_ERROR", "Unexpected checkout preparation result.");
}

export interface CheckoutDeps {
  freezePersonalization?(input: { orderId: string; product: Record<string, any>; line: TrustedLinePrice; values: Record<string, unknown>; files: Record<string, unknown>; lineNumber: number; budget: ProductionAssetBudget }): Promise<Record<string, unknown>>;
  newOrderId(): string;
  /**
   * Take the customer's single-flight preparation lease BEFORE any expensive
   * production work (downloads, decoding, hashing, storage copies). The order
   * transaction consumes it; a concurrent checkout gets `busy`.
   */
  acquirePreparation(input: { customerId: string; submissionId: string; cartFingerprint: string; orderId: string; leaseSeconds: number }): Promise<PreparationAttempt>;
  /**
   * Record a DEFINITIVE failure (the reserved order id was not and can never
   * be committed) and remove the objects this attempt stored. Never called
   * when the transaction outcome is unknown.
   */
  releasePreparation(lease: PreparationLease, failure: { orderId: string; code: string; usage: BudgetUsage }): Promise<{ removed: number }>;
  /**
   * Cheap pre-check: are these cart lines still the customer's, or already
   * consumed by an order? Lets a second tab fail fast before any expensive
   * work. The transaction re-verifies under lock either way.
   */
  checkCartLines?(customerId: string, cartItemIds: string[]): Promise<{ consumedByOrderId: string | null; missing: boolean }>;
  /** How long a request waits for another preparation of the same customer (default 20 s). */
  preparationWaitMs?: number;
  loadProducts(ids: string[]): Promise<Map<string, ProductRecord>>;
  loadCustomizations(ids: string[]): Promise<Map<string, Record<string, any>>>;
  loadVerifiedUploads(userId: string, paths: string[]): Promise<Map<string, VerifiedUpload>>;
  verifyCustomization(input: {
    orderId: string;
    row: Record<string, any>;
    product: Record<string, any>;
    customerId: string;
    line: TrustedLinePrice;
    /** The trusted order line number the snapshot must be linked to. */
    lineNumber: number;
    /** Order-wide production asset budget shared by every line. */
    budget: ProductionAssetBudget;
  }): Promise<CustomizationVerification>;
  findOrderBySubmission(customerId: string, submissionId: string): Promise<{ id: string; checkoutState: string; requestHash: string | null } | null>;
  createOrder(payload: { order: Record<string, unknown>; items: Record<string, unknown>[]; snapshots: DesignSnapshotPayload[]; guards: Record<string, unknown> }): Promise<CreateOrderResult>;
  loadOrder(orderId: string, customerId: string): Promise<Record<string, any> | null>;
  /**
   * Fast path for the durable production/notification tasks the transaction
   * just committed. Best effort: anything it does not finish, the scheduled
   * worker picks up.
   */
  afterOrderCreated(orderId: string): Promise<void>;
}

export type CheckoutOutcome =
  | { ok: true; httpStatus: 200 | 201; order: Record<string, any>; idempotent: boolean; cartCleared: boolean }
  | { ok: false; httpStatus: 400 | 403 | 404 | 409 | 422 | 500 | 503; code: string; errors: Record<string, string>; orderId?: string };

type Context = { requestId: string; userId: string; submissionId?: string };

function fail(
  httpStatus: 400 | 403 | 404 | 409 | 422 | 500 | 503,
  code: string,
  errors: Record<string, string>,
): CheckoutOutcome {
  return { ok: false, httpStatus, code, errors };
}

/** Deterministic JSON (sorted keys) for hashing. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function checkoutRequestHash(request: CheckoutRequest): string {
  return createHash("sha256").update(stableStringify(request)).digest("hex");
}

/** Customer-facing wording for refusals raised inside the transaction. */
const TRANSACTION_ERRORS: Record<string, { status: 400 | 403 | 404 | 409; field: string; message: string }> = {
  CHECKOUT_PRODUCT_UNAVAILABLE: { status: 409, field: "product", message: "An item in your cart just became unavailable. Please review your cart." },
  CHECKOUT_PRICE_CHANGED: { status: 409, field: "pricing", message: "Prices were just updated. Please review your order total and place the order again." },
  CHECKOUT_CUSTOMIZATION_NOT_FOUND: { status: 404, field: "customization", message: "A personalized design could not be found. Reopen it from your cart and save again." },
  CHECKOUT_CUSTOMIZATION_FORBIDDEN: { status: 404, field: "customization", message: "A personalized design could not be found. Reopen it from your cart and save again." },
  CHECKOUT_CUSTOMIZATION_MISMATCH: { status: 400, field: "customization", message: "A personalized design does not match the product in your cart." },
  CHECKOUT_CUSTOMIZATION_LOCKED: { status: 409, field: "customization", message: "A personalized design in your cart has already been ordered. Duplicate it to order again." },
  CHECKOUT_CUSTOMIZATION_CHANGED: { status: 409, field: "customization", message: "Your design changed while the order was being placed. Please review it and place the order again." },
  CHECKOUT_CART_ITEM_NOT_FOUND: { status: 409, field: "cart", message: "Your cart changed in another tab or device. Please review your cart and try again." },
  CHECKOUT_CART_CHANGED: { status: 409, field: "cart", message: "Your cart changed in another tab or device. Please review your cart and try again." },
  CHECKOUT_CART_REQUIRED: { status: 400, field: "cart", message: "Please place your order from your cart." },
  // The preparation lease expired or was released before the transaction:
  // nothing was ordered and the prepared files are discarded.
  CHECKOUT_PREPARATION_EXPIRED: { status: 409, field: "order", message: "Preparing your order took too long. Nothing was ordered — please press Place order again." },
  CHECKOUT_PREPARATION_REQUIRED: { status: 409, field: "order", message: "Your checkout could not be confirmed. Nothing was ordered — please press Place order again." },
  CHECKOUT_PREPARATION_MISMATCH: { status: 409, field: "order", message: "Your checkout could not be confirmed. Nothing was ordered — please press Place order again." },
};

export async function placeCheckoutOrder(
  input: { user: CheckoutUser; body: unknown; requestId: string },
  deps: CheckoutDeps,
): Promise<CheckoutOutcome> {
  const { user, requestId } = input;
  const ctx: Context = { requestId, userId: user.id };

  if (!user?.id) return fail(403, "AUTH_REQUIRED", { auth: "Please sign in to place an order." });
  if (!user.email) return fail(400, "EMAIL_REQUIRED", { auth: "Your account needs an email address before checkout." });

  /* 1. Strict request schema → trusted internal representation. */
  const parsed = parseCheckoutRequest(input.body);
  if (parsed.ok === false) {
    logEvent("warn", "checkout.validation_failed", { ...ctx, stage: "schema", fields: Object.keys(parsed.errors) });
    return fail(400, "VALIDATION_FAILED", parsed.errors);
  }
  const request = parsed.request;
  ctx.submissionId = request.checkoutSubmissionId;
  const requestHash = checkoutRequestHash(request);

  /* 2. Idempotency pre-check. The transaction repeats this under a lock. */
  const replay = await resolveExistingSubmission(user, request.checkoutSubmissionId, requestHash, deps, ctx);
  if (replay) return replay;

  /* 2b. Fast cart check: a cart another tab or device already turned into an
         order is answered with THAT order here, before any other work. The
         transaction re-verifies every line under lock either way. */
  const cartItemIds = request.items.map((item) => item.cartItemId);
  let cartLineMissing = false;
  if (deps.checkCartLines && cartItemIds.length && cartItemIds.every(Boolean)) {
    let cart: Awaited<ReturnType<NonNullable<CheckoutDeps["checkCartLines"]>>>;
    try {
      cart = await deps.checkCartLines(user.id, cartItemIds.map(String));
    } catch (error) {
      logEvent("error", "checkout.database_failed", { ...ctx, stage: "cart_precheck", error });
      return fail(503, "CART_UNAVAILABLE", { cart: "We could not confirm your cart. Please try again in a moment." });
    }
    if (cart.consumedByOrderId) {
      logEvent("warn", "checkout.duplicate_prevented", { ...ctx, stage: "cart_precheck", orderId: cart.consumedByOrderId });
      return {
        ...fail(409, "CART_ALREADY_ORDERED", { cart: "These items were already ordered. You can find the order in your order history." }),
        orderId: cart.consumedByOrderId,
      } as CheckoutOutcome;
    }
    // Reported after the product/option checks (their reasons are more
    // useful to the customer), but still before any expensive work.
    cartLineMissing = cart.missing;
  }

  /* 3. Trusted products. */
  const productIds = [...new Set(request.items.map((item) => item.productId))];
  let products: Map<string, ProductRecord>;
  try {
    products = await deps.loadProducts(productIds);
  } catch (error) {
    logEvent("error", "checkout.database_failed", { ...ctx, stage: "load_products", error });
    return fail(503, "CATALOGUE_UNAVAILABLE", { pricing: "We could not confirm current prices. Please try again in a moment." });
  }

  /* 4. Price every line from server data. */
  const lines: Array<{ item: CheckoutItemInput; record: ProductRecord; line: TrustedLinePrice }> = [];
  const errors: Record<string, string> = {};
  for (const item of request.items) {
    const record = products.get(item.productId);
    const unavailable = checkProductPurchasable(record?.product);
    if (unavailable) {
      errors[`items.${item.lineNumber - 1}.productId`] = unavailable.message;
      continue;
    }
    const priced = priceLine(record.product, item.selectedOptions, item.quantity);
    if (priced.ok === false) {
      errors[`items.${item.lineNumber - 1}.${priced.errors[0].field || "options"}`] = priced.errors[0].message;
      continue;
    }
    lines.push({ item, record, line: priced.line });
  }
  if (Object.keys(errors).length) {
    logEvent("warn", "checkout.pricing_rejected", { ...ctx, stage: "pricing", fields: Object.keys(errors) });
    return fail(422, "PRICING_REJECTED", errors);
  }

  /* 5. Personalization answers and uploads for non-customizer lines. */
  const uploadPaths = [...new Set(lines.flatMap(({ item }) => Object.values(item.uploads).map((upload) => upload.path)))];
  let verifiedUploads = new Map<string, VerifiedUpload>();
  if (uploadPaths.length) {
    try {
      verifiedUploads = await deps.loadVerifiedUploads(user.id, uploadPaths);
    } catch (error) {
      logEvent("error", "checkout.database_failed", { ...ctx, stage: "load_uploads", error });
      return fail(503, "UPLOADS_UNAVAILABLE", { uploads: "We could not verify your uploaded files. Please try again in a moment." });
    }
  }
  const personalizedLines = new Map<number, { values: Record<string, unknown>; files: Record<string, unknown> }>();
  for (const { item, record } of lines) {
    if (item.customizationId) continue;
    const result = resolvePersonalization(record.product, item.personalization, item.uploads, verifiedUploads);
    if (result.ok === false) {
      errors[`items.${item.lineNumber - 1}.personalization`] = result.errors[0];
      continue;
    }
    personalizedLines.set(item.lineNumber, { values: result.values, files: result.files });
  }
  if (Object.keys(errors).length) {
    logEvent("warn", "checkout.validation_failed", { ...ctx, stage: "personalization", fields: Object.keys(errors) });
    return fail(422, "PERSONALIZATION_REJECTED", errors);
  }

  /* 6. Customizations: identity, ownership and options of EVERY line. Cheap
        checks only — nothing here downloads, decodes or stores anything. */
  const customizationIds = lines.map(({ item }) => item.customizationId).filter(Boolean) as string[];
  let customizationRows = new Map<string, Record<string, any>>();
  if (customizationIds.length) {
    try {
      customizationRows = await deps.loadCustomizations(customizationIds);
    } catch (error) {
      logEvent("error", "checkout.database_failed", { ...ctx, stage: "load_customizations", error });
      return fail(503, "CUSTOMIZATIONS_UNAVAILABLE", { customization: "We could not load your personalized designs. Please try again in a moment." });
    }
  }

  const designLines: Array<{ entry: (typeof lines)[number]; row: Record<string, any> }> = [];
  for (const entry of lines) {
    const { item, record } = entry;
    if (!item.customizationId) continue;
    const field = `items.${item.lineNumber - 1}.customizationId`;
    const row = customizationRows.get(item.customizationId);

    if (!row || !row.user_id || String(row.user_id) !== user.id) {
      // Foreign and missing designs get the same answer: never confirm that
      // somebody else's customization id exists.
      logEvent("warn", row ? "checkout.authorization_failed" : "checkout.validation_failed", {
        ...ctx,
        stage: "customization_owner",
        customizationId: item.customizationId,
        reason: row ? (row.user_id ? "foreign_owner" : "null_owner") : "not_found",
      });
      return fail(404, "CUSTOMIZATION_NOT_FOUND", { [field]: TRANSACTION_ERRORS.CHECKOUT_CUSTOMIZATION_NOT_FOUND.message });
    }
    if (String(row.product_id || "") !== record.product.id) {
      logEvent("warn", "checkout.validation_failed", { ...ctx, stage: "customization_product", customizationId: item.customizationId });
      return fail(400, "CUSTOMIZATION_PRODUCT_MISMATCH", { [field]: TRANSACTION_ERRORS.CHECKOUT_CUSTOMIZATION_MISMATCH.message });
    }
    if (!["draft", "in_cart"].includes(String(row.status)) || row.order_id) {
      logEvent("warn", "checkout.duplicate_prevented", { ...ctx, stage: "customization_locked", customizationId: item.customizationId });
      return fail(409, "CUSTOMIZATION_LOCKED", { [field]: TRANSACTION_ERRORS.CHECKOUT_CUSTOMIZATION_LOCKED.message });
    }

    // The customization is the source of truth for the configuration being
    // produced; the cart line must describe the same one.
    const stored = resolveSelectedOptions(record.product, row.selected_options || {});
    if (stored.ok === false) {
      logEvent("warn", "checkout.pricing_rejected", { ...ctx, stage: "customization_options", customizationId: item.customizationId });
      return fail(422, "CUSTOMIZATION_OPTIONS_INVALID", { [field]: "Your design uses options that are no longer available. Reopen it and choose again." });
    }
    if (!sameCanonicalOptions(stored.options, entry.line.options)) {
      logEvent("warn", "checkout.pricing_rejected", { ...ctx, stage: "customization_options_mismatch", customizationId: item.customizationId });
      return fail(400, "CUSTOMIZATION_OPTIONS_MISMATCH", { [field]: "Your cart item's options differ from your saved design. Reopen the design and add it to your cart again." });
    }
    designLines.push({ entry, row });
  }

  /* 7. Totals. */
  // The same resolver the price quote uses (quote === checkout).
  const totals = priceOrder(lines.map(({ line }) => line), request.deliveryMethod);
  if (totals.ok === false) {
    logEvent("warn", "checkout.pricing_rejected", { ...ctx, stage: "totals", code: totals.error.code });
    return fail(422, totals.error.code, { pricing: totals.error.message });
  }
  const { currency, subtotalMinor, deliveryMinor, totalMinor } = totals.totals;

  // Every order line consumes exactly its own server-side cart line; the
  // transaction locks, verifies and removes them (cross-tab/device safety).
  const cartGuards = lines.map(({ item, line }) => ({
    id: item.cartItemId,
    line_number: item.lineNumber,
    product_id: item.productId,
    quantity: line.quantity,
    customization_id: item.customizationId || "",
  }));

  if (cartLineMissing) {
    logEvent("warn", "checkout.validation_failed", { ...ctx, stage: "cart_precheck", reason: "cart_line_missing" });
    return fail(409, "CART_ITEM_NOT_FOUND", { cart: TRANSACTION_ERRORS.CHECKOUT_CART_ITEM_NOT_FOUND.message });
  }

  /* 8. Preparation lease: at most one expensive preparation per customer.
        A second tab, a double click or a script never downloads, decodes,
        hashes or stores anything: it waits cheaply for the first, then gets
        that order (replay / CART_ALREADY_ORDERED) or 409 CHECKOUT_IN_PROGRESS. */
  const orderId = deps.newOrderId();
  const cartFingerprint = createHash("sha256")
    .update(stableStringify([...cartGuards].sort((a, b) => String(a.id).localeCompare(String(b.id)))))
    .digest("hex");
  const acquire = () => deps.acquirePreparation({
    customerId: user.id,
    submissionId: request.checkoutSubmissionId,
    cartFingerprint,
    orderId,
    leaseSeconds: PRODUCTION_LIMITS.preparationLeaseSeconds,
  });
  let attempt: PreparationAttempt;
  try {
    attempt = await acquire();
    // Another request of this customer is preparing. Wait for it CHEAPLY (no
    // preparation work): once it commits, a retry of the same submission is
    // shown that order and another tab is told its cart was ordered.
    const waitUntil = Date.now() + (deps.preparationWaitMs ?? PREPARATION_WAIT_MS);
    let delay = 250;
    while (attempt.status === "busy" && Date.now() + delay <= waitUntil) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(2_000, delay * 2);
      const replayed = await resolveExistingSubmission(user, request.checkoutSubmissionId, requestHash, deps, ctx);
      if (replayed) return replayed;
      if (deps.checkCartLines && cartItemIds.every(Boolean)) {
        const cart = await deps.checkCartLines(user.id, cartItemIds.map(String));
        if (cart.consumedByOrderId) {
          logEvent("warn", "checkout.duplicate_prevented", { ...ctx, stage: "preparation_wait", orderId: cart.consumedByOrderId });
          return {
            ...fail(409, "CART_ALREADY_ORDERED", { cart: "These items were already ordered. You can find the order in your order history." }),
            orderId: cart.consumedByOrderId,
          } as CheckoutOutcome;
        }
      }
      attempt = await acquire();
    }
  } catch (error) {
    logEvent("error", "checkout.database_failed", { ...ctx, stage: "acquire_preparation", error });
    return fail(503, "CHECKOUT_UNAVAILABLE", { order: "We could not start your checkout. Nothing was ordered — please try again in a moment." });
  }
  if (attempt.status === "busy") {
    logEvent("warn", "checkout.preparation_busy", {
      ...ctx,
      sameSubmission: attempt.sameSubmission,
      sameCart: attempt.sameCart,
      retryAfterSeconds: attempt.retryAfterSeconds,
    });
    return fail(409, "CHECKOUT_IN_PROGRESS", {
      order: "This order is already being placed in another tab or window. Please wait a few seconds, then press Place order again — it will never create a second order.",
    });
  }
  const lease: PreparationLease = { id: attempt.id, leaseToken: attempt.leaseToken, leaseExpiresAt: attempt.leaseExpiresAt };
  const budget = new ProductionAssetBudget();
  const startedAt = Date.now();
  // failed → released now and its bytes removed; committed → the order owns
  // them; uncertain → the lease is left to expire and reconciliation decides.
  const disposition: Disposition = { state: "failed", code: "CHECKOUT_FAILED" };
  logEvent("info", "checkout.preparation_started", { ...ctx, orderId, lines: lines.length, designs: designLines.length });

  const failed = (outcome: CheckoutOutcome): CheckoutOutcome => {
    if (outcome.ok === false) disposition.code = outcome.code;
    return outcome;
  };

  const prepareAndCommit = async (): Promise<CheckoutOutcome> => {
    /* 10. Expensive, bounded preparation: design validation, preflight and
           the immutable snapshot with pinned production assets. */
    const snapshots: DesignSnapshotPayload[] = [];
    const customizationGuards: Array<{ id: string; product_id: string; updated_at: string }> = [];
    const verifiedDesigns = new Map<number, Extract<CustomizationVerification, { ok: true }>>();
    for (const { entry, row } of designLines) {
      const { item, record } = entry;
      const field = `items.${item.lineNumber - 1}.customizationId`;
      let verification: CustomizationVerification;
      try {
        verification = await deps.verifyCustomization({ orderId, row, product: record.product, customerId: user.id, line: entry.line, lineNumber: item.lineNumber, budget });
      } catch (error) {
        if (error instanceof ProductionLimitError) {
          logEvent("warn", "checkout.validation_failed", { ...ctx, stage: "production_limits", limit: error.limit, customizationId: item.customizationId });
          return failed(fail(422, "PRODUCTION_LIMIT_EXCEEDED", { [field]: error.message }));
        }
        logEvent("error", "checkout.snapshot_failed", { ...ctx, stage: "verify_customization", customizationId: item.customizationId, error });
        return failed(fail(503, "SNAPSHOT_FAILED", { [field]: "We could not lock in your personalized design. Nothing was ordered — please try again." }));
      }
      if (verification.ok === false) {
        logEvent("warn", "checkout.validation_failed", { ...ctx, stage: "verify_customization", customizationId: item.customizationId, code: verification.code });
        return failed(fail(422, verification.code, { [field]: verification.message }));
      }
      if (verification.snapshot.line_number !== item.lineNumber || verification.snapshot.customization_id !== String(row.id)) {
        // Defence in depth: the transaction also refuses an unlinked snapshot.
        logEvent("error", "checkout.snapshot_failed", { ...ctx, stage: "snapshot_linkage", customizationId: item.customizationId });
        return failed(fail(500, "SNAPSHOT_UNLINKED", { [field]: "We could not lock in your personalized design. Nothing was ordered — please try again." }));
      }
      verifiedDesigns.set(item.lineNumber, verification);
      snapshots.push({ ...verification.snapshot });
      customizationGuards.push({ id: String(row.id), product_id: record.product.id, updated_at: String(row.updated_at) });
    }

    /* 11. Canonical order payload — every identity/money field from the server. */
    const first = lines[0].record.product;
    const methodLabel = request.deliveryMethod === "store" ? "Store pickup" : "Home delivery";
    const order = {
      id: orderId,
      customer_id: user.id,
      customer_name: request.customerName,
      customer_email: user.email.toLowerCase(),
      customer_phone: request.customerPhone,
      product_id: first.id,
      product_title: lines.length === 1 ? String(first.title || "") : `${first.title || "Order"} + ${lines.length - 1} more`,
      product_slug: String(first.slug || ""),
      subtotal: minorToDecimalString(subtotalMinor),
      delivery_charge: minorToDecimalString(deliveryMinor),
      total: minorToDecimalString(totalMinor),
      currency,
      delivery_method: request.deliveryMethod,
      message: [`Delivery: ${methodLabel}`, request.deliveryNote ? `Note: ${request.deliveryNote}` : ""].filter(Boolean).join(" · "),
      address: request.address ? { ...request.address, deliveryNote: request.deliveryNote } : {},
      checkout_submission_id: request.checkoutSubmissionId,
      request_hash: requestHash,
      terms_version: request.termsVersion,
      metadata: {
        schemaVersion: 2,
        requestId,
        currency,
        deliveryMethod: request.deliveryMethod,
        deliveryChargeConfirmed: request.deliveryMethod === "store",
        deliveryNote: request.deliveryNote,
        paymentMethod: COD_INITIAL_STATE.paymentMethodLabel,
        totalsMinor: { subtotal: subtotalMinor, delivery: deliveryMinor, total: totalMinor },
      },
    };

    const items = lines.map(({ item, record, line }) => {
      const product = record.product;
      const design = verifiedDesigns.get(item.lineNumber);
      const personalized = personalizedLines.get(item.lineNumber);
      return {
        line_number: item.lineNumber,
        product_id: product.id,
        product_slug: String(product.slug || ""),
        product_title: String(product.title || "Order item"),
        product_image: String(product.thumbnail || product.images?.[0] || product.mockups?.[0] || ""),
        product_sku: String(product.sku || product.slug || product.id),
        quantity: line.quantity,
        unit_price: minorToDecimalString(line.unitMinor),
        line_total: minorToDecimalString(line.lineMinor),
        currency: line.currency,
        pricing: pricingBreakdown(line),
        selected_options: line.options,
        customization_values: design ? design.values : personalized?.values || {},
        uploaded_files: design ? design.uploadedFiles : personalized?.files || {},
        preview_data: {},
        customization_id: item.customizationId || null,
        metadata: (design
          ? { customizationId: item.customizationId, templateId: design.templateId, templateVersion: design.templateVersion }
          : {}) as Record<string, unknown>,
      };
    });

    // Products with form-based personalization still need durable manufacturing
    // instructions and uploads, even when they have no graphical customizer.
    if (deps.freezePersonalization) {
      try {
        for (let index = 0; index < lines.length; index++) {
          const { item, record, line } = lines[index];
          const personalized = personalizedLines.get(item.lineNumber);
          if (item.customizationId || !personalized || (!Object.keys(personalized.values).length && !Object.keys(personalized.files).length)) continue;
          const contract = await deps.freezePersonalization({ orderId, product: record.product, line, values: personalized.values, files: personalized.files, lineNumber: item.lineNumber, budget });
          items[index].metadata = { ...items[index].metadata, productionSnapshot: contract };
          items[index].uploaded_files = manualInstructionFiles(contract);
        }
      } catch (error) {
        if (error instanceof ProductionLimitError) {
          logEvent("warn", "checkout.validation_failed", { ...ctx, stage: "production_limits", limit: error.limit });
          return failed(fail(422, "PRODUCTION_LIMIT_EXCEEDED", { uploads: error.message }));
        }
        logEvent("error", "checkout.snapshot_failed", { ...ctx, stage: "manual_personalization", error });
        return failed(fail(503, "SNAPSHOT_FAILED", { uploads: "We could not preserve your production files. Nothing was ordered — please try again." }));
      }
    }
    logEvent("info", "checkout.assets_pinned", { ...ctx, orderId, durationMs: Date.now() - startedAt, ...usageSummary(budget.usage) });

    const productGuards = [...products.entries()]
      .filter(([id]) => productIds.includes(id))
      .map(([id, entry]) => ({ id, updated_at: entry.updatedAt }));

    /* 12. The transaction (consumes the preparation lease when it finalizes). */
    let created: CreateOrderResult;
    try {
      created = await deps.createOrder({
        order,
        items,
        snapshots,
        guards: { products: productGuards, customizations: customizationGuards, cart_items: cartGuards },
      });
    } catch (error) {
      if (error instanceof CheckoutTransactionError && error.checkoutCode === "CHECKOUT_CART_ALREADY_ORDERED") {
        // Another tab/device already turned these cart lines into an order. The
        // order id is the customer's own (the claim is customer scoped).
        logEvent("warn", "checkout.duplicate_prevented", { ...ctx, stage: "cart_consumed", orderId: error.detail });
        return failed({
          ...fail(409, "CART_ALREADY_ORDERED", { cart: "These items were already ordered. You can find the order in your order history." }),
          orderId: error.detail || undefined,
        } as CheckoutOutcome);
      }
      if (error instanceof CheckoutTransactionError && TRANSACTION_ERRORS[error.checkoutCode]) {
        const known = TRANSACTION_ERRORS[error.checkoutCode];
        logEvent("warn", error.checkoutCode === "CHECKOUT_CUSTOMIZATION_LOCKED" ? "checkout.duplicate_prevented" : "checkout.validation_failed", {
          ...ctx,
          stage: "transaction",
          code: error.checkoutCode,
        });
        return failed(fail(known.status, error.checkoutCode.replace(/^CHECKOUT_/, ""), { [known.field]: known.message }));
      }
      // Either the unique index fired (a concurrent twin committed first), or
      // the outcome is unknown: the transaction may have COMMITTED and only the
      // response from the database been lost. Never tell the customer the order
      // failed without checking — a finalized order for this submission is the
      // truth, whatever the transport said.
      logEvent("error", "checkout.database_failed", { ...ctx, stage: "transaction", orderId, error });
      const raced = await resolveExistingSubmission(user, request.checkoutSubmissionId, requestHash, deps, ctx);
      if (raced?.ok && String(raced.order?.id || "") === orderId) {
        disposition.state = "committed";
        return raced;
      }
      if (raced && (raced.ok === true || ["SUBMISSION_REUSED", "CHECKOUT_INCOMPLETE"].includes(raced.code))) {
        // Another order holds this submission, so ours can never commit.
        return failed(raced);
      }
      const notConfirmed = raced || fail(503, "ORDER_NOT_CONFIRMED", {
        order: "We could not confirm your order. Please try again — retrying will never create a duplicate order.",
      });
      // The database answered with an error: the transaction rolled back.
      if (error instanceof CheckoutTransactionError && error.definitive) return failed(notConfirmed);
      // Nothing proves either outcome: keep every byte and let the lease
      // expire; reconciliation then decides from the database alone.
      disposition.state = "uncertain";
      return notConfirmed;
    }

    if (created.status !== "created") {
      // Another request with this submission id won the lock between our
      // pre-check and the transaction; our reserved order id was not used.
      const raced = await resolveExistingSubmission(user, request.checkoutSubmissionId, requestHash, deps, ctx);
      if (raced) return failed(raced);
      logEvent("error", "checkout.unexpected_error", { ...ctx, stage: "transaction_result", status: created.status });
      return failed(fail(409, "CHECKOUT_INCOMPLETE", { checkoutSubmissionId: "This checkout could not be completed. Please start a new checkout." }));
    }
    disposition.state = "committed";

    logEvent("info", "checkout.order_created", {
      ...ctx,
      orderId: created.orderId,
      lines: items.length,
      customizations: customizationGuards.length,
      totalMinor,
      currency,
    });

    /* 13. Follow-ups that can never undo or duplicate the order. */
    // The ordered cart lines were consumed INSIDE the transaction; production
    // and notification tasks were committed with it. This only speeds them up.
    try {
      await deps.afterOrderCreated(created.orderId);
    } catch (error) {
      logEvent("error", "checkout.post_order_task_failed", { ...ctx, orderId: created.orderId, stage: "after_order", error });
    }
    const cartCleared = true;

    let view: Record<string, any> | null = null;
    try {
      view = await deps.loadOrder(created.orderId, user.id);
    } catch (error) {
      logEvent("warn", "checkout.post_order_task_failed", { ...ctx, orderId: created.orderId, stage: "load_order", error });
    }

    return {
      ok: true,
      httpStatus: 201,
      order: view || { id: created.orderId, status: COD_INITIAL_STATE.orderStatus, paymentStatus: COD_INITIAL_STATE.paymentStatus, checkoutState: "finalized" },
      idempotent: false,
      cartCleared,
    };
  };

  try {
    return await prepareAndCommit();
  } catch (error) {
    // Unexpected throw before the transaction was attempted: definitive.
    if (disposition.state === "failed") disposition.code = "UNEXPECTED_ERROR";
    throw error;
  } finally {
    await settlePreparation(deps, lease, orderId, disposition, budget, startedAt, ctx);
  }
}

type Disposition = { state: "failed" | "committed" | "uncertain"; code: string };

function usageSummary(usage: BudgetUsage) {
  return {
    images: usage.images,
    fonts: usage.fonts,
    licenses: usage.licenses,
    documents: usage.documents,
    bytes: usage.bytes,
    pixels: usage.pixels,
    snapshotBytes: usage.snapshotBytes,
    storedObjects: usage.storedPaths.length,
  };
}

/** The durable instruction files of a frozen manual-production contract. */
function manualInstructionFiles(contract: Record<string, unknown>): Record<string, unknown> {
  const production = contract.production as { instructions?: { files?: Record<string, unknown> } } | undefined;
  return production?.instructions?.files || {};
}

/**
 * Close the preparation. Only a DEFINITIVE failure releases the lease and
 * removes the bytes it stored; the database refuses to finalize a released
 * lease, so no committed order can lose an asset. Never throws.
 */
async function settlePreparation(
  deps: CheckoutDeps,
  lease: PreparationLease,
  orderId: string,
  disposition: Disposition,
  budget: ProductionAssetBudget,
  startedAt: number,
  ctx: Context,
): Promise<void> {
  const durationMs = Date.now() - startedAt;
  const usage = usageSummary(budget.usage);
  if (disposition.state === "committed") {
    logEvent("info", "checkout.preparation_completed", { ...ctx, orderId, durationMs, ...usage });
    return;
  }
  if (disposition.state === "uncertain") {
    logEvent("warn", "checkout.preparation_uncertain", { ...ctx, orderId, durationMs, ...usage });
    return;
  }
  logEvent("warn", "checkout.preparation_failed", { ...ctx, orderId, code: disposition.code, durationMs, ...usage });
  try {
    const { removed } = await deps.releasePreparation(lease, { orderId, code: disposition.code, usage: budget.usage });
    logEvent("info", "checkout.cleanup_scheduled", { ...ctx, orderId, storedObjects: usage.storedObjects, removedNow: removed });
  } catch (error) {
    // The lease expires and the worker abandons and cleans it; nothing leaks.
    logEvent("error", "checkout.preparation_release_failed", { ...ctx, orderId, stage: "release_preparation", error });
  }
}

async function resolveExistingSubmission(
  user: CheckoutUser,
  submissionId: string,
  requestHash: string,
  deps: CheckoutDeps,
  ctx: Context,
): Promise<CheckoutOutcome | null> {
  let existing: Awaited<ReturnType<CheckoutDeps["findOrderBySubmission"]>>;
  try {
    existing = await deps.findOrderBySubmission(user.id, submissionId);
  } catch (error) {
    logEvent("error", "checkout.database_failed", { ...ctx, stage: "idempotency_lookup", error });
    return fail(503, "ORDER_LOOKUP_FAILED", { order: "We could not confirm your order status. Please try again in a moment." });
  }
  if (!existing) return null;

  if (existing.checkoutState !== "finalized") {
    // Never report a partial, failed or cancelled attempt as a success.
    logEvent("warn", "checkout.duplicate_prevented", { ...ctx, stage: "idempotency", orderId: existing.id, checkoutState: existing.checkoutState });
    return fail(409, "CHECKOUT_INCOMPLETE", { checkoutSubmissionId: "This checkout could not be completed. Please start a new checkout." });
  }
  if (existing.requestHash && existing.requestHash !== requestHash) {
    logEvent("warn", "checkout.duplicate_prevented", { ...ctx, stage: "idempotency_conflict", orderId: existing.id });
    // The order is the customer's own (the lookup is customer scoped), so its
    // id is returned: the browser can show "already placed" instead of
    // inviting a second order.
    return {
      ...fail(409, "SUBMISSION_REUSED", {
        checkoutSubmissionId: "This order was already placed. You can find it in your order history.",
      }),
      orderId: existing.id,
    } as CheckoutOutcome;
  }

  const order = await deps.loadOrder(existing.id, user.id).catch(() => null);
  logEvent("info", "checkout.idempotent_replay", { ...ctx, orderId: existing.id });
  return {
    ok: true,
    httpStatus: 200,
    order: order || { id: existing.id, checkoutState: "finalized" },
    idempotent: true,
    cartCleared: false,
  };
}
