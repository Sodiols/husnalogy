/**
 * The checkout request contract.
 *
 * Every field the browser may send is listed here, and nothing else is
 * accepted: the schema is STRICT, so a request carrying `price`, `subtotal`,
 * `total`, `deliveryCharge`, `currency`, `paymentStatus`, `status`,
 * `customerId`, `customerEmail`, product titles, images, SKUs or any other
 * server-owned value is rejected outright instead of being silently ignored.
 *
 * The output is a TRUSTED internal representation: contact fields are
 * normalized, the phone number is canonical, and each cart line carries only
 * stable identifiers (product id, customization id) plus the customer's
 * option choices and quantity — which the pricing resolver then checks
 * against server data.
 */

import { z } from "zod";
import {
  ADDRESS_RULE,
  AREA_RULE,
  CITY_RULE,
  NAME_RULE,
  NOTE_RULE,
  POSTCODE_RULE,
  normalizeBangladeshPhone,
  normalizeText,
  type TextRule,
} from "@/lib/orders/bd-contact";
import { CHECKOUT_LIMITS, CURRENT_TERMS_VERSION, DELIVERY_METHODS, type DeliveryMethod } from "@/lib/orders/checkout-policy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCT_ID = /^[A-Za-z0-9_-]{1,100}$/;
const FIELD_NAME = /^[a-z0-9_]{1,60}$/;
const SUBMISSION_ID = new RegExp(
  `^[A-Za-z0-9_-]{${CHECKOUT_LIMITS.submissionIdMinLength},${CHECKOUT_LIMITS.submissionIdMaxLength}}$`,
);

/** Option choices are short scalars keyed by option group. */
const optionValue = z.union([z.string().max(300), z.number(), z.boolean()]);

const checkoutItemSchema = z
  .object({
    productId: z.string().regex(PRODUCT_ID, "Invalid product."),
    quantity: z
      .number({ error: "Quantity must be a whole number." })
      .int("Quantity must be a whole number.")
      .min(1, "Quantity must be at least 1.")
      .max(CHECKOUT_LIMITS.maxLineQuantity, `Quantity cannot exceed ${CHECKOUT_LIMITS.maxLineQuantity}.`),
    selectedOptions: z
      .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,40}$/), optionValue)
      .refine((value) => Object.keys(value).length <= 20, "Too many options.")
      .optional(),
    customizationId: z.string().regex(UUID, "Invalid personalized design.").optional(),
    cartItemId: z.string().regex(UUID, "Invalid cart item.").optional(),
    /** Answers to the product's simple personalization fields (product page flow). */
    personalization: z
      .record(z.string().regex(FIELD_NAME), z.union([z.string().max(1000), z.boolean()]))
      .refine((value) => Object.keys(value).length <= 40, "Too many personalization fields.")
      .optional(),
    /** Storage paths of files the customer uploaded for image/file fields. */
    uploads: z
      .record(z.string().regex(FIELD_NAME), z.object({ path: z.string().min(3).max(500) }).strict())
      .refine((value) => Object.keys(value).length <= 10, "Too many uploaded files.")
      .optional(),
  })
  .strict();

const checkoutRequestSchema = z
  .object({
    checkoutSubmissionId: z.string().regex(SUBMISSION_ID, "Invalid checkout submission."),
    customerName: z.string(),
    customerPhone: z.string(),
    deliveryMethod: z.enum(DELIVERY_METHODS),
    addressLine1: z.string().optional(),
    city: z.string().optional(),
    area: z.string().optional(),
    postalCode: z.string().optional(),
    deliveryNote: z.string().optional(),
    acceptTerms: z.literal(true, { error: "Please accept the terms to place your order." }),
    termsVersion: z.string().max(40),
    items: z
      .array(checkoutItemSchema)
      .min(1, "Your cart is empty.")
      .max(CHECKOUT_LIMITS.maxItems, `A single order can contain at most ${CHECKOUT_LIMITS.maxItems} items.`),
  })
  .strict();

export type CheckoutItemInput = {
  lineNumber: number;
  productId: string;
  quantity: number;
  selectedOptions: Record<string, string | number | boolean>;
  customizationId: string | null;
  cartItemId: string | null;
  personalization: Record<string, string | boolean>;
  uploads: Record<string, { path: string }>;
};

export type CheckoutAddress = {
  addressLine1: string;
  city: string;
  area: string;
  postalCode: string;
  country: "Bangladesh";
};

export type CheckoutRequest = {
  checkoutSubmissionId: string;
  customerName: string;
  customerPhone: string;
  deliveryMethod: DeliveryMethod;
  address: CheckoutAddress | null;
  deliveryNote: string;
  termsVersion: string;
  items: CheckoutItemInput[];
};

export type CheckoutParseResult =
  | { ok: true; request: CheckoutRequest }
  | { ok: false; errors: Record<string, string> };

const FIELD_MESSAGES: Record<string, Record<string, string>> = {
  customerName: {
    required: "Name is required.",
    too_short: "Enter your full name.",
    too_long: "Name is too long.",
    invalid: "Name can contain letters, spaces, dots, apostrophes and hyphens only.",
  },
  addressLine1: {
    required: "Delivery address is required.",
    too_short: "Enter a complete delivery address.",
    too_long: "Delivery address is too long.",
    invalid: "Delivery address contains characters that are not allowed.",
  },
  city: {
    required: "Delivery city is required.",
    too_short: "Enter a valid city.",
    too_long: "City is too long.",
    invalid: "City contains characters that are not allowed.",
  },
  area: { too_long: "Area is too long.", invalid: "Area contains characters that are not allowed." },
  postalCode: { too_long: "Enter a 4-digit postcode.", invalid: "Enter a 4-digit postcode." },
  deliveryNote: { too_long: "Delivery note must be 500 characters or fewer.", invalid: "Delivery note contains characters that are not allowed." },
};

function checkText(errors: Record<string, string>, field: string, value: unknown, rule: TextRule): string {
  const result = normalizeText(value, rule);
  if (result.ok === true) return result.value;
  errors[field] = FIELD_MESSAGES[field]?.[result.reason] || "This field is invalid.";
  return "";
}

/** Turn a zod issue path into the field name the checkout form understands. */
function issueField(path: PropertyKey[]): string {
  if (!path.length) return "request";
  if (path[0] === "items") return path.length > 2 ? `items.${String(path[1])}.${String(path[2])}` : "items";
  return String(path[0]);
}

export function parseCheckoutRequest(body: unknown): CheckoutParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: { request: "The checkout request is invalid." } };
  }

  const parsed = checkoutRequestSchema.safeParse(body);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issueField(issue.path);
      if (errors[field]) continue;
      errors[field] =
        issue.code === "unrecognized_keys"
          ? `Unexpected field${issue.keys.length > 1 ? "s" : ""}: ${issue.keys.slice(0, 5).join(", ")}. Refresh the page and try again.`
          : issue.message;
    }
    return { ok: false, errors };
  }

  const input = parsed.data;
  const errors: Record<string, string> = {};

  if (input.termsVersion !== CURRENT_TERMS_VERSION) {
    errors.acceptTerms = "Our terms have been updated. Please review and accept them again.";
  }

  const customerName = checkText(errors, "customerName", input.customerName, NAME_RULE);
  const customerPhone = normalizeBangladeshPhone(input.customerPhone);
  if (!customerPhone) errors.customerPhone = "Enter a valid Bangladesh mobile number, e.g. 01XXXXXXXXX.";

  const deliveryNote = checkText(errors, "deliveryNote", input.deliveryNote, NOTE_RULE);

  let address: CheckoutAddress | null = null;
  if (input.deliveryMethod === "delivery") {
    address = {
      addressLine1: checkText(errors, "addressLine1", input.addressLine1, ADDRESS_RULE),
      city: checkText(errors, "city", input.city, CITY_RULE),
      area: checkText(errors, "area", input.area, AREA_RULE),
      postalCode: checkText(errors, "postalCode", input.postalCode, POSTCODE_RULE),
      country: "Bangladesh",
    };
  } else if ([input.addressLine1, input.city, input.area, input.postalCode].some((value) => String(value || "").trim())) {
    // Store pickup has no address; a request mixing the two is malformed.
    errors.deliveryMethod = "Store pickup orders do not take a delivery address.";
  }

  const seenCustomizations = new Set<string>();
  input.items.forEach((item, index) => {
    if (item.customizationId) {
      if (seenCustomizations.has(item.customizationId)) {
        errors[`items.${index}.customizationId`] = "The same personalized design appears twice in your cart.";
      }
      seenCustomizations.add(item.customizationId);
      // A personalized design carries its own content; a second, client-side
      // copy of it would be a second (forgeable) source of truth.
      if (Object.keys(item.personalization || {}).length || Object.keys(item.uploads || {}).length) {
        errors[`items.${index}.personalization`] = "A personalized design cannot carry separate personalization fields.";
      }
    }
  });

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    request: {
      checkoutSubmissionId: input.checkoutSubmissionId,
      customerName,
      customerPhone: customerPhone as string,
      deliveryMethod: input.deliveryMethod,
      address,
      deliveryNote,
      termsVersion: input.termsVersion,
      items: input.items.map((item, index) => ({
        lineNumber: index + 1,
        productId: item.productId,
        quantity: item.quantity,
        selectedOptions: item.selectedOptions || {},
        customizationId: item.customizationId || null,
        cartItemId: item.cartItemId || null,
        personalization: item.personalization || {},
        uploads: item.uploads || {},
      })),
    },
  };
}

const quoteRequestSchema = z
  .object({
    items: z
      .array(checkoutItemSchema)
      .min(1, "Your cart is empty.")
      .max(CHECKOUT_LIMITS.maxItems, `A single order can contain at most ${CHECKOUT_LIMITS.maxItems} items.`),
  })
  .strict();

/** The price-quote request: the same cart lines, nothing else. */
export function parseQuoteRequest(body: unknown): { ok: true; items: CheckoutItemInput[] } | { ok: false; errors: Record<string, string> } {
  const parsed = quoteRequestSchema.safeParse(body);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issueField(issue.path);
      if (!errors[field]) errors[field] = issue.code === "unrecognized_keys" ? "Unexpected fields in the request." : issue.message;
    }
    return { ok: false, errors };
  }
  return {
    ok: true,
    items: parsed.data.items.map((item, index) => ({
      lineNumber: index + 1,
      productId: item.productId,
      quantity: item.quantity,
      selectedOptions: item.selectedOptions || {},
      customizationId: item.customizationId || null,
      cartItemId: item.cartItemId || null,
      personalization: item.personalization || {},
      uploads: item.uploads || {},
    })),
  };
}
